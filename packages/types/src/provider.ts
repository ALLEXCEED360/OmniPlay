import type {
  AccountStatus,
  ActivityType,
  Confidence,
  OwnershipType,
  ProviderId,
} from './domain.js';

/* ------------------------------------------------------------------ *
 * Normalised provider payloads
 *
 * A provider adapter's only job is to produce these shapes. Everything
 * downstream - matching, statistics, UI - consumes only these.
 * ------------------------------------------------------------------ */

/** The provider's notion of "who this user is". */
export interface ExternalAccount {
  /** Stable provider-side id: SteamID64, XUID, PSN account id. */
  providerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  /** Anything provider-shaped worth keeping but not worth a column. */
  raw?: Record<string, unknown>;
}

export interface ExternalProfile extends ExternalAccount {
  /** Provider-native score, e.g. Xbox Gamerscore. Not comparable across providers. */
  score?: number | null;
  createdAt?: Date | null;
  countryCode?: string | null;
}

/** One game as a provider describes it, before canonical resolution. */
export interface ExternalGame {
  /** Provider's id for the title: Steam appid, Xbox titleId, PSN npCommunicationId. */
  externalId: string;
  name: string;
  /** Provider's platform label, if it distinguishes (e.g. "PS4" vs "PS5"). */
  platformHint?: string | null;
  iconUrl?: string | null;
  coverUrl?: string | null;
  ownership?: {
    type: OwnershipType;
    acquiredAt?: Date | null;
  };
  /**
   * Lifetime minutes as reported by the provider. Deliberately separate from
   * PlayActivity: this is a running total the provider overwrites, not an event.
   */
  minutesPlayedTotal?: number | null;
  lastPlayedAt?: Date | null;
  /**
   * Per-game achievement progress, when the provider includes it with the
   * library for free.
   *
   * Xbox does; Steam does not. Carrying it here means a library can show
   * progress for every title straight away, instead of waiting on the
   * one-request-per-game sweep that fetches individual achievements.
   */
  achievementSummary?: {
    unlocked: number;
    /** Null when the provider's total is missing or known to be unreliable. */
    total?: number | null;
    points?: number | null;
    totalPoints?: number | null;
  };
  confidence: Confidence;
  raw?: Record<string, unknown>;
}

export interface ExternalAchievement {
  externalId: string;
  /** Provider id of the game this belongs to. */
  externalGameId: string;
  name: string;
  description: string | null;
  /** Gamerscore / trophy weight. Steam has no equivalent. */
  points?: number | null;
  hidden?: boolean;
  iconUrl?: string | null;
  /** Fraction of all players who have it, 0..1, when the provider reports it. */
  globalUnlockRate?: number | null;
  unlocked: boolean;
  unlockedAt?: Date | null;
}

export interface ExternalPlayEvent {
  externalGameId: string;
  activityType: ActivityType;
  minutesPlayed?: number | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  confidence: Confidence;
}

/* ------------------------------------------------------------------ *
 * Capabilities
 * ------------------------------------------------------------------ */

/**
 * A provider declares what it can actually deliver. The settings screen's
 * privacy matrix (spec 24) and the sync planner both read this instead of
 * branching on provider name.
 *
 * "partial" means supported, but the provider does not promise completeness -
 * the honest answer for Xbox title history.
 */
export type CapabilityLevel = 'none' | 'partial' | 'full';

export interface ProviderCapabilities {
  library: CapabilityLevel;
  playtime: CapabilityLevel;
  achievements: CapabilityLevel;
  playHistory: CapabilityLevel;
  profile: CapabilityLevel;
  /** Provider can be re-synced incrementally rather than in full. */
  incrementalSync: boolean;
  /**
   * How many games' achievements one sync may fetch, when each costs a
   * request. Omit for providers where the sweep is cheap.
   *
   * OpenXBL's free tier allows 150 requests an hour — about one every 24
   * seconds — so sweeping a 37-game library in a single run takes a quarter of
   * an hour and consumes the entire budget. Capping it lets each sync top up
   * the next few games and finish over several runs, while a re-sync of an
   * already-complete library costs almost nothing.
   */
  achievementSweepBudget?: number;
  /** Data arrives by user-supplied file rather than an API. */
  importOnly: boolean;
}

/* ------------------------------------------------------------------ *
 * Credentials and sessions
 * ------------------------------------------------------------------ */

/**
 * Provider credentials as the core understands them. Persisted encrypted and
 * never sent to the browser (spec 23).
 *
 * Steam's OpenID flow yields no token at all - only a verified SteamID - so
 * every field here is optional by design.
 */
export interface ProviderCredentials {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
  /** Provider-specific extras (Xbox userhash, XSTS token, ...). */
  extra?: Record<string, unknown>;
}

/** Everything an adapter needs to make an authenticated call. */
export interface ProviderSession {
  providerUserId: string;
  credentials: ProviderCredentials;
}

export interface AuthStartResult {
  /** Where to send the user's browser. */
  redirectUrl: string;
  /** Opaque value the callback must echo back; we persist and compare it. */
  state: string;
  /** PKCE verifier or OpenID nonce, kept server-side for the callback. */
  verifier?: string;
}

export interface AuthCompleteResult {
  account: ExternalAccount;
  credentials: ProviderCredentials;
  status: AccountStatus;
}

/* ------------------------------------------------------------------ *
 * The contract
 * ------------------------------------------------------------------ */

/**
 * The single interface every data source implements (spec 6).
 *
 * This deviates from the spec sketch in three deliberate ways:
 *
 *  1. Auth is split into beginAuth/completeAuth. A single authenticate()
 *     cannot express a browser redirect round-trip, which is what all three
 *     launch providers actually require.
 *  2. Methods take an explicit ProviderSession instead of the adapter holding
 *     per-user state. Adapters stay singletons and the worker can run many
 *     users concurrently through one instance.
 *  3. Collection methods return AsyncIterable, so a 5,000-game library streams
 *     and upserts page by page instead of buffering in memory.
 */
export interface GamingProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  beginAuth(input: { redirectUri: string }): Promise<AuthStartResult>;

  completeAuth(input: {
    /** Raw callback query parameters. */
    params: Record<string, string>;
    state: string;
    verifier?: string;
    redirectUri: string;
  }): Promise<AuthCompleteResult>;

  /**
   * Connects without a browser round-trip.
   *
   * Present when the provider is reached through a key the *instance* holds
   * rather than a per-user authorisation — OpenXBL works this way, where the
   * API key already identifies exactly one account. The connect flow calls
   * this instead of beginAuth when it exists, so the UI needs no special case
   * beyond skipping the redirect.
   */
  connectDirect?(): Promise<AuthCompleteResult>;

  /**
   * Refresh an expiring credential. Resolve to null when the provider has no
   * refresh concept (Steam) so callers need not special-case it.
   */
  refreshCredentials?(session: ProviderSession): Promise<ProviderCredentials | null>;

  getProfile?(session: ProviderSession): Promise<ExternalProfile>;

  getLibrary(session: ProviderSession, opts?: SyncOptions): AsyncIterable<ExternalGame>;

  getAchievements?(
    session: ProviderSession,
    externalGameId: string,
  ): AsyncIterable<ExternalAchievement>;

  getPlayHistory?(session: ProviderSession, opts?: SyncOptions): AsyncIterable<ExternalPlayEvent>;

  /** Best-effort revocation at the provider. Local deletion happens regardless. */
  disconnect?(session: ProviderSession): Promise<void>;
}

export interface SyncOptions {
  /**
   * Provider ids to fetch *detailed* per-game data for.
   *
   * Some providers report a cheap summary for the whole library and charge a
   * request per game for the rest — Xbox gives playtime only through a
   * per-title stats call. The runner decides which games are worth spending
   * on, since only it knows the budget and what has already been fetched.
   */
  detailFor?: string[];
  /** Opaque provider cursor from the last successful sync. */
  cursor?: string | null;
  /** Only return records changed after this instant, when supported. */
  since?: Date | null;
  /** Ignore cursors and re-read everything. */
  full?: boolean;
  signal?: AbortSignal;
}

/** Lets the worker decide retry vs. re-auth vs. give up. */
export type ProviderErrorKind =
  | 'AUTH_EXPIRED'
  | 'AUTH_INVALID'
  | 'FORBIDDEN'
  | 'PRIVATE_PROFILE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE'
  | 'UNKNOWN';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly options: {
      provider?: ProviderId;
      /** Honour a provider's Retry-After before trying again. */
      retryAfterMs?: number;
      status?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
  }

  /** Retrying the same call unchanged could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === 'RATE_LIMITED' || this.kind === 'UNAVAILABLE' || this.kind === 'TIMEOUT';
  }

  /** The user must re-authorise; no amount of retrying will help. */
  get needsReauth(): boolean {
    return this.kind === 'AUTH_EXPIRED' || this.kind === 'AUTH_INVALID';
  }
}

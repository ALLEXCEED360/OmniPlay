import { z } from 'zod';
import {
  ProviderError,
  type AuthCompleteResult,
  type AuthStartResult,
  type ExternalAchievement,
  type ExternalGame,
  type ExternalPlayEvent,
  type ExternalProfile,
  type GamingProvider,
  type ProviderCapabilities,
  type ProviderSession,
  type SyncOptions,
} from '@omniplay/types';
import { ProviderHttpClient } from '../http/client.js';

/**
 * Xbox via OpenXBL (https://xbl.io).
 *
 * The alternative to a first-party Azure app registration, which a personal
 * Microsoft account cannot create — the portal drops such accounts into a
 * restricted "Microsoft Services" tenant where app registration is refused.
 *
 * OpenXBL is a thin proxy over the real Xbox Live services: the payloads below
 * are the genuine Xbox shapes wrapped in a `{ content, code }` envelope, which
 * is why this shares its mapping with the direct adapter. Swapping between the
 * two changes the transport and nothing else.
 *
 * Three things about it drive the design:
 *
 *  1. **One key, one account.** The API key *is* the identity — there is no
 *     per-user OAuth. So this cannot serve a multi-user deployment, and it
 *     connects without a browser round-trip at all.
 *  2. **150 requests an hour** on the free tier. That is roughly one every 24
 *     seconds, against Steam's ~100k/day. The sync strategy below is shaped
 *     entirely by that ceiling.
 *  3. **Xbox rejects a wildcard locale.** Node's fetch sends no
 *     `Accept-Language`, and the upstream returns 400 with
 *     "invalid locale value: *" unless one is set explicitly.
 */

const OPENXBL_BASE = 'https://xbl.io/api/v2/';

export interface OpenXblConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/* ------------------------------------------------------------------ *
 * Wire schemas
 *
 * Captured from live responses rather than written from memory - the last
 * integration built on a remembered schema failed on every record because a
 * field had been renamed, and hand-written fixtures agreed with the mistake.
 * ------------------------------------------------------------------ */

/** Everything OpenXBL returns is wrapped like this. */
function envelope<T extends z.ZodTypeAny>(inner: T) {
  return z.object({ content: inner, code: z.number().optional() });
}

const profileSchema = envelope(
  z.object({
    profileUsers: z.array(
      z.object({
        id: z.string(),
        settings: z.array(z.object({ id: z.string(), value: z.string() })),
      }),
    ),
  }),
);

const titleSchema = z.object({
  titleId: z.string(),
  name: z.string(),
  type: z.string().optional(),
  devices: z.array(z.string()).optional(),
  displayImage: z.string().optional().nullable(),
  /** Present and true when the title is held through Game Pass. */
  gamePass: z.object({ isGamePass: z.boolean().optional() }).optional().nullable(),
  achievement: z
    .object({
      currentAchievements: z.number().optional(),
      totalAchievements: z.number().optional(),
      currentGamerscore: z.number().optional(),
      totalGamerscore: z.number().optional(),
      progressPercentage: z.number().optional(),
    })
    .optional()
    .nullable(),
  titleHistory: z
    .object({ lastTimePlayed: z.string().optional() })
    .optional()
    .nullable(),
});

const titlesSchema = envelope(
  z.object({ xuid: z.string().optional(), titles: z.array(titleSchema) }),
);

const titleAchievementsSchema = envelope(
  z.object({
    achievements: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional().nullable(),
        lockedDescription: z.string().optional().nullable(),
        /** "Achieved" once unlocked; "NotStarted"/"InProgress" otherwise. */
        progressState: z.string().optional(),
        isSecret: z.boolean().optional(),
        progression: z
          .object({ timeUnlocked: z.string().optional() })
          .optional()
          .nullable(),
        mediaAssets: z
          .array(z.object({ type: z.string().optional(), url: z.string().optional() }))
          .optional()
          .nullable(),
        rewards: z
          .array(z.object({ value: z.string().optional().nullable(), type: z.string().optional() }))
          .optional()
          .nullable(),
      }),
    ),
  }),
);

/** Per-title stats, which is where Xbox keeps MinutesPlayed. */
const titleStatsSchema = envelope(
  z.object({
    statlistscollection: z
      .array(
        z.object({
          stats: z
            .array(z.object({ name: z.string(), value: z.string().optional() }))
            .optional()
            .nullable(),
        }),
      )
      .optional()
      .nullable(),
  }),
);

export type OpenXblTitle = z.infer<typeof titleSchema>;

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

export class OpenXblProvider implements GamingProvider {
  readonly id = 'xbox';
  readonly displayName = 'Xbox';

  readonly capabilities: ProviderCapabilities = {
    // Title history is achievement-derived: it lists what you have earned
    // achievements in, not what you own. The one exception is Game Pass, which
    // the payload does flag - see getLibrary.
    library: 'partial',
    // Playtime exists, but only per title and only through a separate stats
    // call — so a library's hours arrive a few games at a time rather than
    // with the library itself.
    playtime: 'partial',
    achievements: 'full',
    playHistory: 'partial',
    profile: 'full',
    incrementalSync: false,
    importOnly: false,
    // A game costs one request per kind of detail still missing — its
    // achievements, its MinutesPlayed, or both. Catching up on a single kind
    // therefore costs half what a first pass does, so 12 games is 12 requests
    // while topping up and 24 on a full refresh: both inside the 150/hour tier,
    // and at one request per 30s a refresh run still finishes in ~12 minutes.
    achievementSweepBudget: 12,
  };

  private readonly http: ProviderHttpClient;

  constructor(private readonly config: OpenXblConfig) {
    if (!config.apiKey) {
      throw new Error('OpenXblProvider requires an API key (OPENXBL_API_KEY).');
    }

    this.http = new ProviderHttpClient({
      provider: 'xbox',
      baseUrl: OPENXBL_BASE,
      // The free tier allows 150 requests/hour. 1 every 30s sits just inside
      // it with room for a retry, and the burst lets a sync's opening calls
      // (profile, then titles) go straight through.
      requestsPerSecond: 1 / 30,
      burst: 3,
      timeoutMs: 20_000,
      defaultHeaders: {
        'X-Authorization': config.apiKey,
        // Without this the upstream returns 400: "Request contains
        // Accept-Language header with invalid locale value: *".
        'accept-language': 'en-US',
      },
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    });
  }

  get health() {
    return this.http.health;
  }

  /**
   * OpenXBL has no browser sign-in: the API key already identifies exactly one
   * account. `connectDirect` below is what the connect flow uses instead, and
   * this exists only so a caller reaching for the OAuth path gets a sentence
   * that explains itself rather than a type error.
   */
  async beginAuth(): Promise<AuthStartResult> {
    throw new ProviderError(
      'UNAVAILABLE',
      'Xbox is connected with an API key rather than a sign-in. Use Connect on the settings screen.',
      { provider: this.id },
    );
  }

  async completeAuth(): Promise<AuthCompleteResult> {
    throw new ProviderError(
      'UNAVAILABLE',
      'Xbox is connected with an API key rather than a sign-in.',
      { provider: this.id },
    );
  }

  /**
   * Connects without a browser round-trip.
   *
   * The key is the credential and it belongs to the instance, not to a user —
   * exactly like Steam's publisher key. So connecting is just discovering
   * which account the key speaks for.
   */
  async connectDirect(): Promise<AuthCompleteResult> {
    const profile = await this.getProfile({ providerUserId: 'me', credentials: {} });

    return {
      account: {
        providerUserId: profile.providerUserId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        profileUrl: null,
      },
      // Nothing user-specific to store: access is via our configured key.
      credentials: {},
      status: 'ACTIVE',
    };
  }

  async getProfile(_session: ProviderSession): Promise<ExternalProfile> {
    const parsed = profileSchema.safeParse(
      await this.http.requestJson<unknown>({ path: 'account' }),
    );

    if (!parsed.success || !parsed.data.content.profileUsers[0]) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected OpenXBL account response.', {
        provider: this.id,
        ...(parsed.success ? {} : { cause: parsed.error }),
      });
    }

    const user = parsed.data.content.profileUsers[0];
    const settings = new Map(user.settings.map((setting) => [setting.id, setting.value]));
    const gamerscore = Number(settings.get('Gamerscore'));

    return {
      providerUserId: user.id,
      displayName: settings.get('Gamertag') ?? null,
      avatarUrl: settings.get('GameDisplayPicRaw') ?? null,
      profileUrl: null,
      score: Number.isFinite(gamerscore) ? gamerscore : null,
    };
  }

  /**
   * Titles the user has achievement activity for.
   *
   * Emitted with `DETECTED` confidence and, in general, no ownership block:
   * activity is not entitlement, and presenting it as a library would put
   * games the user never bought into their collection.
   *
   * Game Pass is the exception the payload actually supports. `isGamePass`
   * states that the title is held through a subscription, which is a real
   * entitlement — recorded as SUBSCRIPTION so it reads as access rather than
   * as a purchase.
   */
  async *getLibrary(session: ProviderSession): AsyncIterable<ExternalGame> {
    for (const title of await this.fetchTitles(session)) {
      // Apps and demos share the endpoint with games.
      if (title.type && title.type !== 'Game') continue;

      const onGamePass = title.gamePass?.isGamePass === true;
      const summary = toAchievementSummary(title);

      yield {
        externalId: title.titleId,
        name: title.name,
        platformHint: title.devices?.[0] ?? 'Xbox',
        coverUrl: title.displayImage ?? null,
        ...(onGamePass
          ? { ownership: { type: 'SUBSCRIPTION' as const, acquiredAt: null } }
          : {}),
        minutesPlayedTotal: null,
        lastPlayedAt: parseXboxDate(title.titleHistory?.lastTimePlayed),
        ...(summary ? { achievementSummary: summary } : {}),
        confidence: onGamePass ? 'VERIFIED' : 'DETECTED',
        raw: {
          currentGamerscore: title.achievement?.currentGamerscore,
          totalGamerscore: title.achievement?.totalGamerscore,
          currentAchievements: title.achievement?.currentAchievements,
          totalAchievements: title.achievement?.totalAchievements,
          isGamePass: onGamePass,
        },
      };
    }
  }

  async *getPlayHistory(
    session: ProviderSession,
    opts?: SyncOptions,
  ): AsyncIterable<ExternalPlayEvent> {
    // Cheap pass: last-played dates for the whole library, no extra requests.
    for (const title of await this.fetchTitles(session)) {
      const lastPlayed = parseXboxDate(title.titleHistory?.lastTimePlayed);
      if (!lastPlayed) continue;

      yield {
        externalGameId: title.titleId,
        // Names exactly what this is: evidence of activity, not a session.
        activityType: 'ACHIEVEMENT_HISTORY',
        minutesPlayed: null,
        endedAt: lastPlayed,
        confidence: 'DETECTED',
      };
    }

    // Expensive pass: actual minutes, one request per game, for whichever
    // titles the runner chose to spend budget on.
    for (const externalGameId of opts?.detailFor ?? []) {
      const minutes = await this.fetchMinutesPlayed(externalGameId);
      if (minutes === null) continue;

      yield {
        externalGameId,
        // A running total Xbox overwrites, exactly like Steam's - never summed
        // across observations.
        activityType: 'LIFETIME_TOTAL',
        minutesPlayed: minutes,
        confidence: 'VERIFIED',
      };
    }
  }

  /**
   * Minutes played for one title.
   *
   * Xbox keeps this in a per-title stats collection rather than in the title
   * list, which is why a library's hours cannot arrive in one request. Titles
   * that never reported the stat simply return nothing.
   */
  private async fetchMinutesPlayed(externalGameId: string): Promise<number | null> {
    let payload: unknown;
    try {
      payload = await this.http.requestJson<unknown>({
        path: `achievements/stats/${encodeURIComponent(externalGameId)}`,
      });
    } catch {
      // A missing stats collection is normal; it must not fail the sync.
      return null;
    }

    const parsed = titleStatsSchema.safeParse(payload);
    if (!parsed.success) return null;

    for (const collection of parsed.data.content.statlistscollection ?? []) {
      for (const stat of collection.stats ?? []) {
        if (stat.name !== 'MinutesPlayed') continue;
        const minutes = Number(stat.value);
        return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
      }
    }
    return null;
  }

  /**
   * Individual achievements for one title.
   *
   * One request per game, which at 150/hour is the expensive part of a sync.
   * The caller decides how many to spend; the per-game *summary* already comes
   * free with the title list, so a library can show progress without this.
   */
  async *getAchievements(
    session: ProviderSession,
    externalGameId: string,
  ): AsyncIterable<ExternalAchievement> {
    const xuid = session.providerUserId;

    const parsed = titleAchievementsSchema.safeParse(
      await this.http.requestJson<unknown>({
        path: `achievements/player/${encodeURIComponent(xuid)}/${encodeURIComponent(externalGameId)}`,
      }),
    );

    if (!parsed.success) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected OpenXBL achievements response.', {
        provider: this.id,
        cause: parsed.error,
      });
    }

    for (const achievement of parsed.data.content.achievements) {
      const gamerscore = achievement.rewards?.find((reward) => reward.type === 'Gamerscore')?.value;

      yield {
        externalId: achievement.id,
        externalGameId,
        name: achievement.name,
        description: achievement.description ?? achievement.lockedDescription ?? null,
        points: gamerscore ? Number(gamerscore) : null,
        hidden: achievement.isSecret ?? false,
        iconUrl: achievement.mediaAssets?.find((asset) => asset.type === 'Icon')?.url ?? null,
        unlocked: achievement.progressState === 'Achieved',
        unlockedAt: parseXboxDate(achievement.progression?.timeUnlocked),
      };
    }
  }

  /**
   * The title list, which carries the library, its progress summary and the
   * Game Pass flag.
   *
   * `player/titleHistory` rather than `achievements/player/{xuid}`: both return
   * the same titles with the same achievement summary, but only this one
   * populates `gamePass`. The other reports it as null, which silently cost us
   * the single genuine entitlement signal Xbox offers.
   */
  private async fetchTitles(_session: ProviderSession): Promise<OpenXblTitle[]> {
    const parsed = titlesSchema.safeParse(
      await this.http.requestJson<unknown>({ path: 'player/titleHistory' }),
    );

    if (!parsed.success) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected OpenXBL title response.', {
        provider: this.id,
        cause: parsed.error,
      });
    }

    return parsed.data.content.titles;
  }

  async disconnect(): Promise<void> {
    // Nothing to revoke; the key belongs to the instance. The caller deletes
    // the local connection and any imported data.
  }
}

/**
 * Per-game achievement progress, free with the title list.
 *
 * `totalAchievements` is not trustworthy — Xbox returns 0 for titles that
 * plainly have some, while `totalGamerscore` for the same title reads 1000. So
 * an implausible total is reported as unknown rather than as zero, which would
 * render as "6 / 0" in the UI.
 */
function toAchievementSummary(title: OpenXblTitle) {
  const achievement = title.achievement;
  if (!achievement) return undefined;

  const unlocked = achievement.currentAchievements ?? 0;
  const rawTotal = achievement.totalAchievements ?? 0;
  const total = rawTotal >= unlocked && rawTotal > 0 ? rawTotal : null;

  const points = achievement.currentGamerscore ?? null;
  const totalPoints = achievement.totalGamerscore ?? null;

  // Nothing worth recording for a title the user has never touched and which
  // offers no achievements either.
  if (unlocked === 0 && total === null && !totalPoints) return undefined;

  return { unlocked, total, points, totalPoints };
}

/**
 * Xbox uses `0001-01-01T00:00:00Z` for "never", which would otherwise import
 * as a year-1 timestamp and sort to the beginning of every timeline.
 */
export function parseXboxDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear() <= 1601 ? null : date;
}

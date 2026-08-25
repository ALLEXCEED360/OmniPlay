/**
 * Core domain vocabulary shared by every layer of OMNIPLAY.
 *
 * Nothing in here may reference a specific provider's wire format. Providers
 * translate *into* these types; the core never translates back.
 */

/**
 * Providers are registered data sources, not database enums.
 *
 * This is deliberately a plain string at the type level with a well-known set
 * of constants, so adding `gog` or `itch` later is a registry change rather
 * than a schema migration (spec 33: "Do not hard-code provider assumptions").
 */
export type ProviderId = string;

export const PROVIDERS = {
  STEAM: 'steam',
  XBOX: 'xbox',
  PSN: 'psn',
  EPIC: 'epic',
  GOG: 'gog',
  MANUAL: 'manual',
} as const satisfies Record<string, ProviderId>;

/** How a user came to have access to a game. */
export const OWNERSHIP_TYPES = [
  'DIGITAL',
  'PHYSICAL',
  'SUBSCRIPTION',
  'GIFT',
  'FAMILY_SHARE',
  'MANUAL',
  'UNKNOWN',
] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** Where the user is in their relationship with a game. */
export const GAME_STATUSES = [
  'NOT_STARTED',
  'PLAYING',
  'PAUSED',
  'COMPLETED',
  'ABANDONED',
  'REPLAYING',
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/**
 * What kind of evidence a PlayActivity row represents.
 *
 * This matters because providers expose wildly different fidelity. Steam gives
 * a lifetime playtime total with no sessions; Xbox's title history is derived
 * from achievement activity and is explicitly NOT a complete launch log
 * (spec 5.2). Collapsing these into "playtime" would silently invent history.
 */
export const ACTIVITY_TYPES = [
  /** A provider-reported lifetime total, not a session. Not additive over time. */
  'LIFETIME_TOTAL',
  /** A bounded play session with a start and (usually) an end. */
  'SESSION',
  /** Provider says the title was played recently, without duration. */
  'RECENT_PLAY',
  /** Presence of achievement activity implies the game was launched. */
  'ACHIEVEMENT_HISTORY',
  /** The user told us this happened. */
  'USER_DECLARED',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * How much we trust a record. Every non-trivial row carries one.
 *
 * `VERIFIED`  - provider stated it directly and unambiguously.
 * `DERIVED`   - we inferred it from provider data we do trust.
 * `DETECTED`  - provider implied activity but not its shape (Xbox title history).
 * `DECLARED`  - the user asserted it; we have no independent evidence.
 * `UNCERTAIN` - imported/fuzzy-matched; surface it as such in the UI.
 */
export const CONFIDENCE_LEVELS = ['VERIFIED', 'DERIVED', 'DETECTED', 'DECLARED', 'UNCERTAIN'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Provenance travels with the data (spec 2.5). If a field cannot be traced to
 * a source it does not belong in a user-facing statistic.
 */
export interface Provenance {
  source: ProviderId;
  /** The provider's own identifier for the record we read, when it has one. */
  sourceId?: string | null;
  confidence: Confidence;
  observedAt: Date;
}

export const COLLECTION_VISIBILITY = ['PRIVATE', 'UNLISTED', 'PUBLIC'] as const;
export type CollectionVisibility = (typeof COLLECTION_VISIBILITY)[number];

export const SYNC_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'REAUTH_REQUIRED', 'DISABLED', 'REVOKED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

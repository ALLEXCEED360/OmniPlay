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
import type { ProviderHttpClient } from '../http/client.js';
import { createPsnHttp, PsnAuth, PsnTokenStore } from './psn.client.js';

/**
 * PlayStation Network.
 *
 * The richest source in OMNIPLAY, and the only unofficial one. Sony gives no
 * consumer API, but the endpoints behind the PlayStation mobile app report
 * more than either first-party API we do have: real per-title durations *with*
 * first and last played dates, play counts, and individually dated trophies.
 * Steam, by contrast, reports a lifetime total with no dates at all.
 *
 * Three things shape the adapter:
 *
 *  1. **Two id spaces.** The game list is keyed by `titleId` (PPSA/CUSA) and
 *     trophies by `npCommunicationId` (NPWR). Sony maps between them in
 *     batches, so no name matching is needed - see `mapTrophyTitles`.
 *  2. **Trophies cost two requests per game.** Names live on a public endpoint
 *     and earn state on a user-scoped one, exactly as Steam splits schema from
 *     player achievements. With 126 trophy titles that is 252 requests, hence
 *     the sweep budget.
 *  3. **The list is play history, not a library.** It reports what has been
 *     launched. Ownership is inferred only from the `service` field, and only
 *     as DERIVED - Sony never states entitlement outright.
 */

const PSN_ID = 'psn' as const;

export interface PsnConfig {
  /** Session token from ca.account.sony.com. Never logged. */
  npsso: string;
  fetchImpl?: typeof fetch;
}

/* ------------------------------------------------------------------ *
 * Wire schemas
 *
 * Captured from live responses by `pnpm --filter @omniplay/worker probe:psn`,
 * never written from memory. An undocumented API is exactly where a remembered
 * field name goes unnoticed: the IGDB integration failed on every record for
 * that reason while its hand-written fixtures agreed with the mistake.
 * ------------------------------------------------------------------ */

const profileSchema = z.object({
  onlineId: z.string(),
  isPlus: z.boolean().optional(),
  isOfficiallyVerified: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
});

const mediaImageSchema = z.object({
  url: z.string(),
  type: z.string().optional(),
});

const gameListTitleSchema = z.object({
  titleId: z.string(),
  name: z.string(),
  localizedName: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z.string().optional(),
  service: z.string().optional(),
  playCount: z.number().optional(),
  /** ISO 8601 duration, e.g. "PT76H46M7S". */
  playDuration: z.string().optional(),
  firstPlayedDateTime: z.string().optional(),
  lastPlayedDateTime: z.string().optional(),
  concept: z
    .object({
      id: z.number().optional(),
      genres: z.array(z.string()).optional(),
    })
    .nullish(),
  media: z.object({ images: z.array(mediaImageSchema).optional() }).nullish(),
});

const gameListSchema = z.object({
  titles: z.array(gameListTitleSchema),
  nextOffset: z.number().nullish(),
  totalItemCount: z.number().optional(),
});

const trophyCountsSchema = z.object({
  bronze: z.number().optional(),
  silver: z.number().optional(),
  gold: z.number().optional(),
  platinum: z.number().optional(),
});

const trophyTitleSchema = z.object({
  npServiceName: z.string(),
  npCommunicationId: z.string(),
  trophyTitleName: z.string(),
  trophyTitleIconUrl: z.string().optional(),
  trophyTitlePlatform: z.string().optional(),
  definedTrophies: trophyCountsSchema.optional(),
  earnedTrophies: trophyCountsSchema.optional(),
  progress: z.number().optional(),
  lastUpdatedDateTime: z.string().optional(),
});

const titleMappingSchema = z.object({
  titles: z.array(
    z.object({
      npTitleId: z.string(),
      trophyTitles: z.array(trophyTitleSchema).optional(),
    }),
  ),
});

/** The public endpoint: names and descriptions, no user state. */
const definedTrophySchema = z.object({
  trophyId: z.number(),
  trophyName: z.string().optional(),
  trophyDetail: z.string().optional(),
  trophyIconUrl: z.string().optional(),
  trophyType: z.string().optional(),
  trophyHidden: z.boolean().optional(),
});

/** The user-scoped endpoint: earn state only, no names. */
const earnedTrophySchema = z.object({
  trophyId: z.number(),
  earned: z.boolean().optional(),
  earnedDateTime: z.string().optional(),
  trophyType: z.string().optional(),
  trophyHidden: z.boolean().optional(),
  /** Percentage of players holding it, as a string like "42.0". */
  trophyEarnedRate: z.string().optional(),
});

const trophyListSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ trophies: z.array(inner), totalItemCount: z.number().optional() });

/* ------------------------------------------------------------------ *
 * Mapping
 * ------------------------------------------------------------------ */

/**
 * Categories that are not games.
 *
 * Sony lists Spotify and the video apps alongside real titles, and importing
 * them would put "6 seconds of Spotify" in a gaming history.
 */
const NON_GAME_CATEGORY = /videoservice|nongame|media_app|web_app/i;

export function isGameCategory(category: string | undefined): boolean {
  if (!category) return true;
  return !NON_GAME_CATEGORY.test(category);
}

/**
 * ISO 8601 duration to whole minutes.
 *
 * Sony reports playtime as "PT76H46M7S". Only hours, minutes and seconds ever
 * appear for playtime, but days are parsed too rather than silently dropping a
 * chunk of someone's history if Sony ever emits them.
 */
export function parseIsoDuration(value: string | undefined | null): number | null {
  if (!value) return null;

  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 1440 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Number(seconds ?? 0) / 60;

  // "PT6S" is a real value in the data and rounds to zero. Reporting it as
  // zero rather than null is right: the title genuinely was launched.
  return Math.round(total);
}

export function parsePsnDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * How a title was acquired, as far as `service` reveals it.
 *
 * The values are opaque and not literal - VALORANT is free-to-play yet sits
 * under a "purchased" value - so this reads them as "came through the store"
 * versus "did not", and never claims more than DERIVED. `other` covers discs
 * and pre-installed titles like ASTRO's PLAYROOM.
 */
export function ownershipFromService(
  service: string | undefined,
): { type: 'DIGITAL' | 'PHYSICAL' } | undefined {
  if (!service) return undefined;
  if (service.includes('purchased')) return { type: 'DIGITAL' };
  if (service === 'other') return { type: 'PHYSICAL' };
  return undefined;
}

/** Sony's per-image roles, best first for each use. */
function pickImage(
  images: Array<{ url: string; type?: string | undefined }> | undefined,
  preferred: string[],
): string | null {
  if (!images?.length) return null;
  for (const role of preferred) {
    const hit = images.find((image) => image.type === role);
    if (hit) return hit.url;
  }
  return null;
}

const TROPHY_POINTS: Record<string, number> = {
  bronze: 15,
  silver: 30,
  gold: 90,
  platinum: 180,
};

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

export class PsnProvider implements GamingProvider {
  readonly id = PSN_ID;
  readonly displayName = 'PlayStation';

  readonly capabilities: ProviderCapabilities = {
    // The list is everything launched, which is not the same as everything
    // owned - but unlike Xbox it does carry an acquisition signal.
    library: 'partial',
    // Durations on all but a handful of titles, with dates. The best of any
    // provider here.
    playtime: 'full',
    achievements: 'full',
    playHistory: 'full',
    profile: 'full',
    incrementalSync: false,
    // Two requests per game (names, then earn state) across ~126 trophy
    // titles. Twelve games a run keeps a sync to about half a minute of
    // requests while covering a library in a handful of syncs.
    achievementSweepBudget: 12,
    importOnly: false,
  };

  private readonly http: ProviderHttpClient;
  private readonly auth: PsnAuth;
  private store: PsnTokenStore;

  constructor(config: PsnConfig) {
    this.auth = new PsnAuth(config.npsso, config.fetchImpl);
    this.store = new PsnTokenStore(this.auth);
    this.http = createPsnHttp(config.fetchImpl);
  }

  /** Authorised headers, refreshing the access token when it is stale. */
  private async authorised(): Promise<{ headers: Record<string, string>; accountId: string }> {
    const tokens = await this.store.current();
    return {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
      accountId: tokens.accountId,
    };
  }

  async beginAuth(): Promise<AuthStartResult> {
    throw new ProviderError(
      'AUTH_INVALID',
      'PlayStation connects with a session token rather than a sign-in redirect. ' +
        'Set PSN_NPSSO and use connectDirect.',
      { provider: PSN_ID },
    );
  }

  async completeAuth(): Promise<AuthCompleteResult> {
    return this.connectDirect();
  }

  /**
   * Connects without a browser round-trip.
   *
   * The npsso the instance holds already identifies exactly one account, so
   * there is no per-user authorisation to perform - the same shape as OpenXBL.
   */
  async connectDirect(): Promise<AuthCompleteResult> {
    const tokens = await this.store.current();
    const profile = await this.getProfile({
      providerUserId: tokens.accountId,
      credentials: {},
    });

    return {
      account: profile,
      // Persisted so a later sync can refresh without the npsso, which is the
      // only credential a human has to replace.
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(tokens.expiresAt),
      },
      status: 'ACTIVE',
    };
  }

  async getProfile(session: ProviderSession): Promise<ExternalProfile> {
    const { headers, accountId } = await this.authorised();
    const id = session.providerUserId || accountId;

    const payload = await this.http.requestJson<unknown>({
      path: `userProfile/v1/internal/users/${encodeURIComponent(id)}/profiles`,
      headers,
    });

    const parsed = profileSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ProviderError('MALFORMED_RESPONSE', 'PlayStation profile was not recognisable.', {
        provider: PSN_ID,
      });
    }

    return {
      providerUserId: id,
      displayName: parsed.data.onlineId,
      avatarUrl: null,
      profileUrl: null,
      raw: { isPlus: parsed.data.isPlus ?? false },
    };
  }

  /**
   * Every title the account has launched.
   *
   * Paginated by offset. Non-games are dropped, and ownership is attached only
   * where `service` supports it.
   */
  async *getLibrary(session: ProviderSession, _opts?: SyncOptions): AsyncIterable<ExternalGame> {
    void _opts;
    const accountId = session.providerUserId;
    let offset = 0;

    for (;;) {
      const { headers } = await this.authorised();
      const payload = await this.http.requestJson<unknown>({
        path: `gamelist/v2/users/${encodeURIComponent(accountId)}/titles`,
        query: { limit: 200, offset },
        headers,
      });

      const parsed = gameListSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ProviderError('MALFORMED_RESPONSE', 'PlayStation game list was not recognisable.', {
          provider: PSN_ID,
        });
      }

      for (const title of parsed.data.titles) {
        if (!isGameCategory(title.category)) continue;

        const ownership = ownershipFromService(title.service);
        const images = title.media?.images;

        yield {
          externalId: title.titleId,
          name: title.name,
          platformHint: title.category?.startsWith('ps5') ? 'PS5' : 'PS4',
          iconUrl: title.imageUrl ?? null,
          coverUrl:
            pickImage(images, ['GAMEHUB_COVER_ART', 'PORTRAIT_BANNER', 'MASTER']) ??
            title.imageUrl ??
            null,
          // Sony reports acquisition route but never a date, so the ownership
          // row carries no acquiredAt rather than a guessed one.
          ...(ownership ? { ownership: { type: ownership.type } } : {}),
          minutesPlayedTotal: parseIsoDuration(title.playDuration),
          lastPlayedAt: parsePsnDate(title.lastPlayedDateTime),
          // DERIVED, not VERIFIED: `service` is an acquisition hint that Sony
          // does not document, and a launch is not a purchase.
          confidence: ownership ? 'DERIVED' : 'DETECTED',
          raw: {
            category: title.category ?? null,
            service: title.service ?? null,
            playCount: title.playCount ?? null,
            genres: title.concept?.genres ?? [],
            firstPlayedDateTime: title.firstPlayedDateTime ?? null,
          },
        };
      }

      const next = parsed.data.nextOffset;
      if (typeof next !== 'number' || next <= offset || parsed.data.titles.length === 0) break;
      offset = next;
    }
  }

  /**
   * Playtime, and the dates Sony attaches to it.
   *
   * One event per title: the running lifetime total, carrying the real first
   * and last played instants Sony attaches to it. Those dates are what make
   * PlayStation the only provider that can place a game on the timeline at the
   * point it was actually started - Steam reports hours with no dates at all,
   * so its own lifetime totals arrive with `startedAt` null.
   */
  async *getPlayHistory(
    session: ProviderSession,
    _opts?: SyncOptions,
  ): AsyncIterable<ExternalPlayEvent> {
    void _opts;

    for await (const game of this.getLibrary(session)) {
      const first = parsePsnDate(game.raw?.['firstPlayedDateTime'] as string | undefined);

      if (game.minutesPlayedTotal !== null && game.minutesPlayedTotal !== undefined) {
        yield {
          externalGameId: game.externalId,
          // A running total Sony overwrites, exactly like Steam's - never
          // summed across observations.
          activityType: 'LIFETIME_TOTAL',
          minutesPlayed: game.minutesPlayedTotal,
          startedAt: first,
          endedAt: game.lastPlayedAt ?? null,
          confidence: 'VERIFIED',
        };
      }
    }
  }

  /**
   * Maps game ids onto trophy ids.
   *
   * Sony accepts a handful of `npTitleIds` at a time and answers with the
   * trophy set for each, so games and trophies are joined on identifiers
   * rather than on names.
   */
  async mapTrophyTitles(
    session: ProviderSession,
    titleIds: string[],
  ): Promise<Map<string, { npCommunicationId: string; npServiceName: string }>> {
    const out = new Map<string, { npCommunicationId: string; npServiceName: string }>();
    if (titleIds.length === 0) return out;

    const accountId = session.providerUserId;

    // Five at a time: the endpoint rejects longer lists.
    for (let index = 0; index < titleIds.length; index += 5) {
      const batch = titleIds.slice(index, index + 5);
      const { headers } = await this.authorised();

      const payload = await this.http
        .requestJson<unknown>({
          path: `trophy/v1/users/${encodeURIComponent(accountId)}/titles/trophyTitles`,
          query: { npTitleIds: batch.join(',') },
          headers,
        })
        .catch(() => null);

      const parsed = titleMappingSchema.safeParse(payload);
      if (!parsed.success) continue;

      for (const entry of parsed.data.titles) {
        const trophy = entry.trophyTitles?.[0];
        // Plenty of titles have no trophies at all; that is not a failure.
        if (!trophy) continue;
        out.set(entry.npTitleId, {
          npCommunicationId: trophy.npCommunicationId,
          npServiceName: trophy.npServiceName,
        });
      }
    }

    return out;
  }

  /**
   * Trophies for one game, by its `titleId`.
   *
   * Two requests: the public set for names and descriptions, then the
   * user-scoped set for earn state. Sony splits them exactly as Steam splits
   * schema from player achievements, and neither half is usable alone - the
   * user-scoped response has no names in it at all.
   */
  async *getAchievements(
    session: ProviderSession,
    externalGameId: string,
  ): AsyncIterable<ExternalAchievement> {
    const mapping = await this.mapTrophyTitles(session, [externalGameId]);
    const trophySet = mapping.get(externalGameId);
    if (!trophySet) return;

    const { npCommunicationId, npServiceName } = trophySet;
    const accountId = session.providerUserId;
    const { headers } = await this.authorised();

    const defined = await this.http
      .requestJson<unknown>({
        path: `trophy/v1/npCommunicationIds/${npCommunicationId}/trophyGroups/all/trophies`,
        query: { npServiceName, limit: 400 },
        headers,
      })
      .catch(() => null);

    const definitions = trophyListSchema(definedTrophySchema).safeParse(defined);
    if (!definitions.success) return;

    const earnedPayload = await this.http
      .requestJson<unknown>({
        path:
          `trophy/v1/users/${encodeURIComponent(accountId)}` +
          `/npCommunicationIds/${npCommunicationId}/trophyGroups/all/trophies`,
        query: { npServiceName, limit: 400 },
        headers,
      })
      .catch(() => null);

    const earned = trophyListSchema(earnedTrophySchema).safeParse(earnedPayload);
    const earnedById = new Map(
      earned.success ? earned.data.trophies.map((trophy) => [trophy.trophyId, trophy]) : [],
    );

    for (const trophy of definitions.data.trophies) {
      const mine = earnedById.get(trophy.trophyId);
      const rate = mine?.trophyEarnedRate ? Number(mine.trophyEarnedRate) : null;

      yield {
        // Trophy ids restart at 0 for every game, so the game has to be part
        // of the identifier or two games would collide.
        externalId: `${npCommunicationId}:${trophy.trophyId}`,
        externalGameId,
        name: trophy.trophyName ?? `Trophy ${trophy.trophyId}`,
        description: trophy.trophyDetail ?? null,
        // PSN has no gamerscore. These are the community's conventional
        // weights, kept so a platinum outranks a bronze in any sort.
        points: TROPHY_POINTS[trophy.trophyType ?? ''] ?? null,
        hidden: trophy.trophyHidden ?? false,
        iconUrl: trophy.trophyIconUrl ?? null,
        globalUnlockRate: rate !== null && Number.isFinite(rate) ? rate / 100 : null,
        unlocked: mine?.earned ?? false,
        unlockedAt: parsePsnDate(mine?.earnedDateTime),
      };
    }
  }
}

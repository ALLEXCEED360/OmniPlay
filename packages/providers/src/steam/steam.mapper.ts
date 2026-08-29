import { z } from 'zod';
import { ProviderError, type ExternalGame, type ExternalProfile } from '@omniplay/types';

/**
 * Steam wire formats and their translation into OMNIPLAY's vocabulary.
 *
 * The schemas are permissive about fields we do not use and strict about the
 * ones we do. Steam has changed response shapes without notice before; a
 * validation failure here is far easier to diagnose than a NaN that surfaces
 * three tables later as a wrong playtime total.
 */

/* ------------------------------------------------------------------ *
 * Wire schemas
 * ------------------------------------------------------------------ */

export const steamOwnedGameSchema = z.object({
  appid: z.number(),
  name: z.string().optional(),
  playtime_forever: z.number().optional(),
  playtime_2weeks: z.number().optional(),
  img_icon_url: z.string().optional(),
  /** Unix seconds; 0 means "never", not "1970". */
  rtime_last_played: z.number().optional(),
});

export const steamOwnedGamesResponseSchema = z.object({
  response: z.object({
    game_count: z.number().optional(),
    games: z.array(steamOwnedGameSchema).optional(),
  }),
});

export const steamPlayerSchema = z.object({
  steamid: z.string(),
  personaname: z.string().optional(),
  profileurl: z.string().optional(),
  avatarfull: z.string().optional(),
  avatarmedium: z.string().optional(),
  /** 1 = private, 3 = public. Anything below 3 limits what we can read. */
  communityvisibilitystate: z.number().optional(),
  timecreated: z.number().optional(),
  loccountrycode: z.string().optional(),
});

export const steamPlayerSummariesResponseSchema = z.object({
  response: z.object({ players: z.array(steamPlayerSchema) }),
});

export const steamAchievementSchema = z.object({
  apiname: z.string(),
  achieved: z.number(),
  unlocktime: z.number().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

export const steamPlayerAchievementsResponseSchema = z.object({
  playerstats: z.object({
    success: z.boolean().optional(),
    error: z.string().optional(),
    achievements: z.array(steamAchievementSchema).optional(),
  }),
});

export type SteamOwnedGame = z.infer<typeof steamOwnedGameSchema>;
export type SteamPlayer = z.infer<typeof steamPlayerSchema>;

/* ------------------------------------------------------------------ *
 * Mapping
 * ------------------------------------------------------------------ */

/** Steam serves app icons from a predictable CDN path. */
export function steamIconUrl(appId: number, iconHash: string | undefined): string | null {
  if (!iconHash) return null;
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`;
}

/** The store's header image, which is the closest thing Steam has to cover art. */
export function steamHeaderUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

/** Unix seconds to Date, treating Steam's 0 sentinel as absent. */
export function fromUnixSeconds(seconds: number | undefined | null): Date | null {
  if (!seconds || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

export function mapSteamGame(game: SteamOwnedGame): ExternalGame {
  const appId = game.appid;
  return {
    externalId: String(appId),
    // Steam omits the name when the app has been delisted. The appid is still
    // a real thing the user owns, so we keep the row and label it honestly
    // rather than dropping it from their history (spec 2.4).
    name: game.name?.trim() || `Unknown Steam app ${appId}`,
    platformHint: 'PC',
    iconUrl: steamIconUrl(appId, game.img_icon_url),
    coverUrl: steamHeaderUrl(appId),
    ownership: {
      // Steam's API cannot distinguish a purchase from a family-shared or
      // free-on-demand title, so DIGITAL is the honest ceiling here.
      type: 'DIGITAL',
      acquiredAt: null,
    },
    minutesPlayedTotal: game.playtime_forever ?? null,
    lastPlayedAt: fromUnixSeconds(game.rtime_last_played),
    confidence: 'VERIFIED',
    raw: { playtime_2weeks: game.playtime_2weeks },
  };
}

export function mapSteamProfile(player: SteamPlayer): ExternalProfile {
  return {
    providerUserId: player.steamid,
    displayName: player.personaname ?? null,
    avatarUrl: player.avatarfull ?? player.avatarmedium ?? null,
    profileUrl: player.profileurl ?? null,
    createdAt: fromUnixSeconds(player.timecreated),
    countryCode: player.loccountrycode ?? null,
    raw: { communityvisibilitystate: player.communityvisibilitystate },
  };
}

/** True when Steam will not disclose the library regardless of our API key. */
export function isProfilePrivate(player: SteamPlayer): boolean {
  return (player.communityvisibilitystate ?? 3) < 3;
}

/** Wraps a Zod failure as a provider error so the worker can classify it. */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ProviderError('MALFORMED_RESPONSE', `Unexpected Steam ${context} response.`, {
      provider: 'steam',
      cause: result.error,
    });
  }
  return result.data;
}

/**
 * Global achievement percentages.
 *
 * A public Steam endpoint needing no key, keyed by the same `apiname` the
 * player-achievements call uses, so the join is exact rather than by title.
 * `percent` arrives as a number in practice but is typed loosely because Steam
 * has been known to send it as a string.
 */
export const steamGlobalPercentagesSchema = z.object({
  achievementpercentages: z
    .object({
      achievements: z
        .array(z.object({ name: z.string(), percent: z.union([z.number(), z.string()]) }))
        .optional(),
    })
    .optional(),
});

/**
 * A game's achievement schema.
 *
 * The only place Steam publishes achievement artwork: `GetPlayerAchievements`
 * returns names and unlock state but no icons at all, which is why every Steam
 * achievement rendered as an empty placeholder. Keyed by the same `apiname`,
 * so the join is exact.
 */
export const steamGameSchemaSchema = z.object({
  game: z
    .object({
      availableGameStats: z
        .object({
          achievements: z
            .array(
              z.object({
                name: z.string(),
                displayName: z.string().optional(),
                description: z.string().optional(),
                icon: z.string().optional(),
                icongray: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

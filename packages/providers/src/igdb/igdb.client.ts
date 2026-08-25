import { z } from 'zod';
import { ProviderError } from '@omniplay/types';
import { ProviderHttpClient } from '../http/client.js';

/**
 * IGDB metadata client (spec 8).
 *
 * IGDB is the canonical *catalogue*, never a source of user ownership. It
 * answers "what is this game" - cover art, genres, release dates - and the
 * provider adapters answer "what does this user have".
 *
 * Two operational facts shape this file:
 *
 *  - Auth is Twitch app credentials (client-credentials grant), and the token
 *    lasts ~60 days. It is cached in memory and refreshed on demand.
 *  - The documented limit is 4 requests/second, so the shared rate limiter is
 *    configured tightly and callers are expected to batch via `where id = (..)`
 *    rather than looping one game at a time.
 */

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_BASE = 'https://api.igdb.com/v4/';

export interface IgdbConfig {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});

/** The subset of IGDB's game model OMNIPLAY stores. */
export const igdbGameSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string().optional(),
  /** See GAME_TYPES: 0 is a main game, 1 is DLC, 8/9 are remake/remaster. */
  game_type: z.number().optional(),
  summary: z.string().optional(),
  storyline: z.string().optional(),
  /** Unix seconds. */
  first_release_date: z.number().optional(),
  rating: z.number().optional(),
  aggregated_rating: z.number().optional(),
  cover: z.object({ image_id: z.string() }).optional(),
  artworks: z.array(z.object({ image_id: z.string() })).optional(),
  genres: z.array(z.object({ name: z.string() })).optional(),
  franchises: z.array(z.object({ name: z.string() })).optional(),
  platforms: z
    .array(z.object({ id: z.number(), name: z.string(), slug: z.string().optional() }))
    .optional(),
  involved_companies: z
    .array(
      z.object({
        developer: z.boolean().optional(),
        publisher: z.boolean().optional(),
        company: z.object({ name: z.string() }),
      }),
    )
    .optional(),
  alternative_names: z.array(z.object({ name: z.string() })).optional(),
  external_games: z
    .array(
      z.object({
        uid: z.string(),
        /**
         * IGDB renamed `category` to `external_game_source`. Both are optional
         * so a payload carrying either (or neither) still parses — a store
         * mapping is a bonus, and losing one must never fail the whole game.
         */
        external_game_source: z.number().optional(),
        category: z.number().optional(),
      }),
    )
    .optional(),
});

export type IgdbGame = z.infer<typeof igdbGameSchema>;

/**
 * IGDB store identifiers for the platforms we care about.
 *
 * This is the level-2 match in the resolution pipeline: IGDB already knows
 * which Steam appid a game is, so we import that mapping rather than guessing
 * from the title (spec 9, level 2).
 *
 * Values verified against IGDB's own /external_game_sources endpoint rather
 * than assumed — Xbox Marketplace is 31, and 11 is "Microsoft", which is a
 * different thing and was previously wrong here.
 */
export const IGDB_EXTERNAL_CATEGORY = {
  STEAM: 1,
  GOG: 5,
  EPIC: 26,
  XBOX_MARKETPLACE: 31,
  PLAYSTATION_STORE: 36,
} as const;

/**
 * IGDB game types that represent something a person *owns as a library entry*.
 *
 * Excluded: DLC (1), expansions (2), bundles (3), mods (5), episodes (6),
 * seasons (7), packs (13) and updates (14). Remakes (8) and remasters (9) are
 * kept deliberately — they are distinct products, and the matcher's version
 * markers already keep them from being confused with the original.
 *
 * Without this filter IGDB's search ranks DLC above base games: searching
 * "Batman: Arkham Knight" returns four cosmetic skin packs before the game.
 */
export const LIBRARY_GAME_TYPES = [0, 4, 8, 9, 10, 11] as const;

/** Reads whichever store-source field a payload carries. */
export function externalGameSource(external: {
  external_game_source?: number | undefined;
  category?: number | undefined;
}): number | undefined {
  return external.external_game_source ?? external.category;
}

/** Reverse map from IGDB category to our provider id. */
export const IGDB_CATEGORY_TO_PROVIDER: Record<number, string> = {
  [IGDB_EXTERNAL_CATEGORY.STEAM]: 'steam',
  [IGDB_EXTERNAL_CATEGORY.GOG]: 'gog',
  [IGDB_EXTERNAL_CATEGORY.EPIC]: 'epic',
  [IGDB_EXTERNAL_CATEGORY.PLAYSTATION_STORE]: 'psn',

  // Xbox Marketplace is deliberately absent.
  //
  // It supplies *Microsoft Store product ids* ("9PC1D0103GFF", or a UUID),
  // while the Xbox APIs identify games by numeric **titleId**. Filing both
  // under provider "xbox" produced 16 mappings that no Xbox sync could ever
  // match — dead rows that looked like working level-2 resolution.
  //
  // Adding them back needs a distinct provider id and a way to translate
  // between the two id spaces, which no endpoint we have offers.
};

/** IGDB serves images at fixed size presets. */
export function igdbImageUrl(
  imageId: string,
  size: 'cover_big' | 'screenshot_huge' | '1080p' = 'cover_big',
): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

export class IgdbClient {
  private readonly http: ProviderHttpClient;
  private token: { value: string; expiresAt: number } | null = null;
  /** De-duplicates concurrent refreshes so a burst does not fetch N tokens. */
  private inFlightToken: Promise<string> | null = null;

  constructor(private readonly config: IgdbConfig) {
    this.http = new ProviderHttpClient({
      provider: 'igdb',
      baseUrl: IGDB_BASE,
      // The documented ceiling is 4/sec. We sit just under it and allow no
      // burst above it, because IGDB counts strictly.
      requestsPerSecond: 4,
      burst: 4,
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    });
  }

  get health() {
    return this.http.health;
  }

  private async getToken(): Promise<string> {
    // Refresh a minute early so a long request cannot straddle expiry.
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    this.inFlightToken ??= this.fetchToken().finally(() => {
      this.inFlightToken = null;
    });
    return this.inFlightToken;
  }

  private async fetchToken(): Promise<string> {
    const url = new URL(TWITCH_TOKEN_URL);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('client_secret', this.config.clientSecret);
    url.searchParams.set('grant_type', 'client_credentials');

    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(url.toString(), { method: 'POST' });
    if (!response.ok) {
      throw new ProviderError('AUTH_INVALID', `Twitch token request failed (${response.status}).`, {
        provider: 'igdb',
        status: response.status,
      });
    }

    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected Twitch token response.', {
        provider: 'igdb',
        cause: parsed.error,
      });
    }

    this.token = {
      value: parsed.data.access_token,
      expiresAt: Date.now() + parsed.data.expires_in * 1000,
    };
    return this.token.value;
  }

  /** Runs a raw APIcalypse query against an IGDB endpoint. */
  async query<T>(endpoint: string, body: string): Promise<T> {
    const token = await this.getToken();
    return this.http.requestJson<T>({
      method: 'POST',
      path: endpoint,
      headers: {
        'Client-ID': this.config.clientId,
        authorization: `Bearer ${token}`,
        'content-type': 'text/plain',
      },
      body,
    });
  }

  /** The field list every game lookup requests. */
  private static readonly GAME_FIELDS = [
    'id',
    'name',
    'slug',
    'game_type',
    'summary',
    'storyline',
    'first_release_date',
    'rating',
    'aggregated_rating',
    'cover.image_id',
    'artworks.image_id',
    'genres.name',
    'franchises.name',
    'platforms.id',
    'platforms.name',
    'platforms.slug',
    'involved_companies.developer',
    'involved_companies.publisher',
    'involved_companies.company.name',
    'alternative_names.name',
    'external_games.external_game_source',
    'external_games.uid',
  ].join(',');

  /** Fetches games by IGDB id, batched into one request. */
  async getGamesByIds(ids: number[]): Promise<IgdbGame[]> {
    if (ids.length === 0) return [];
    const body = `fields ${IgdbClient.GAME_FIELDS}; where id = (${ids.join(',')}); limit ${ids.length};`;
    return this.parseGames(await this.query<unknown>('games', body));
  }

  /**
   * Finds the IGDB game for a store id - the level-2 resolution path.
   *
   * One request resolves a whole page of Steam appids, which is why the sync
   * worker batches instead of calling this per game.
   */
  async getGamesByExternalIds(category: number, uids: string[]): Promise<IgdbGame[]> {
    if (uids.length === 0) return [];
    const quoted = uids.map((uid) => `"${uid.replace(/"/g, '')}"`).join(',');
    const body =
      `fields ${IgdbClient.GAME_FIELDS};` +
      ` where external_games.external_game_source = ${category} & external_games.uid = (${quoted});` +
      ` limit ${Math.min(uids.length * 2, 500)};`;
    return this.parseGames(await this.query<unknown>('games', body));
  }

  /** Title search, used only as a fallback when no store id resolves. */
  async searchGames(name: string, limit = 10): Promise<IgdbGame[]> {
    const escaped = name.replace(/"/g, '');
    const body =
      `fields ${IgdbClient.GAME_FIELDS};` +
      ` search "${escaped}";` +
      // Without this, cosmetic DLC outranks the base game in IGDB's own
      // relevance order and the real title never reaches the shortlist.
      ` where game_type = (${LIBRARY_GAME_TYPES.join(',')});` +
      ` limit ${limit};`;
    return this.parseGames(await this.query<unknown>('games', body));
  }

  async getPlatforms(): Promise<Array<{ id: number; name: string; slug: string; abbreviation?: string }>> {
    const body = 'fields id,name,slug,abbreviation,generation; limit 500;';
    const data = await this.query<unknown>('platforms', body);
    const schema = z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        slug: z.string(),
        abbreviation: z.string().optional(),
        generation: z.number().optional(),
      }),
    );
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected IGDB platforms response.', {
        provider: 'igdb',
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  private parseGames(data: unknown): IgdbGame[] {
    const parsed = z.array(igdbGameSchema).safeParse(data);
    if (!parsed.success) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected IGDB games response.', {
        provider: 'igdb',
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}

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
import { randomBytes } from 'node:crypto';
import { ProviderHttpClient } from '../http/client.js';
import { buildSteamAuthUrl, verifySteamCallback } from './steam.auth.js';
import {
  mapSteamGame,
  mapSteamProfile,
  parseOrThrow,
  steamOwnedGamesResponseSchema,
  steamPlayerAchievementsResponseSchema,
  steamPlayerSummariesResponseSchema,
  steamGlobalPercentagesSchema,
  steamGameSchemaSchema,
} from './steam.mapper.js';

/**
 * Steam provider adapter (spec 5.1).
 *
 * Steam is the reference implementation of the provider contract: it is the
 * best-documented of the three and the one whose data we trust most, so the
 * shapes it produces set the expectation for Xbox and PSN.
 */

export interface SteamProviderConfig {
  /** Publisher Web API key. Ours, not the user's. */
  apiKey: string;
  /** OpenID realm - the scheme+host users will be returned to. */
  realm: string;
  fetchImpl?: typeof fetch;
}

const STEAM_API_BASE = 'https://api.steampowered.com/';

/** Steam's communityvisibilitystate: 3 means public, anything lower is not. */
const PUBLIC_VISIBILITY = 3;

export class SteamProvider implements GamingProvider {
  readonly id = 'steam';
  readonly displayName = 'Steam';

  readonly capabilities: ProviderCapabilities = {
    library: 'full',
    playtime: 'full',
    achievements: 'full',
    // Steam exposes a lifetime total and a two-week window, never a session
    // log. There is no way to reconstruct when a game was actually played.
    playHistory: 'partial',
    profile: 'full',
    // GetOwnedGames has no cursor or since-parameter; every sync is a full read.
    incrementalSync: false,
    importOnly: false,
  };

  private readonly http: ProviderHttpClient;

  constructor(private readonly config: SteamProviderConfig) {
    if (!config.apiKey) {
      throw new Error('SteamProvider requires a Web API key (STEAM_API_KEY).');
    }
    this.http = new ProviderHttpClient({
      provider: 'steam',
      baseUrl: STEAM_API_BASE,
      // Steam's documented ceiling is 100k calls/day. 8/sec stays far inside
      // that while keeping a 3,000-game achievement pass tolerable.
      requestsPerSecond: 8,
      burst: 16,
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    });
  }

  get health() {
    return this.http.health;
  }

  async beginAuth({ redirectUri }: { redirectUri: string }): Promise<AuthStartResult> {
    // Steam's OpenID has no state parameter of its own, so we carry ours in
    // the return_to URL and compare it on the way back.
    const state = randomBytes(32).toString('base64url');
    const returnUrl = new URL(redirectUri);
    returnUrl.searchParams.set('state', state);

    return {
      redirectUrl: buildSteamAuthUrl({ realm: this.config.realm }, returnUrl.toString()),
      state,
    };
  }

  async completeAuth(input: {
    params: Record<string, string>;
    state: string;
  }): Promise<AuthCompleteResult> {
    const returnedState = input.params['state'];
    if (!returnedState || returnedState !== input.state) {
      throw new ProviderError('AUTH_INVALID', 'Steam sign-in state did not match.', {
        provider: 'steam',
      });
    }

    const steamId = await verifySteamCallback(input.params, {
      realm: this.config.realm,
      ...(this.config.fetchImpl ? { fetchImpl: this.config.fetchImpl } : {}),
    });

    const profile = await this.getProfile({ providerUserId: steamId, credentials: {} });

    return {
      account: {
        providerUserId: steamId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        profileUrl: profile.profileUrl,
      },
      // Nothing to store: access is via our API key, not a user token.
      credentials: {},
      status: 'ACTIVE',
    };
  }

  async getProfile(session: ProviderSession): Promise<ExternalProfile> {
    const data = await this.http.requestJson<unknown>({
      path: 'ISteamUser/GetPlayerSummaries/v2/',
      query: { key: this.config.apiKey, steamids: session.providerUserId },
    });

    const parsed = parseOrThrow(steamPlayerSummariesResponseSchema, data, 'player summary');
    const player = parsed.response.players[0];
    if (!player) {
      throw new ProviderError('AUTH_INVALID', 'Steam returned no profile for this account.', {
        provider: 'steam',
      });
    }
    return mapSteamProfile(player);
  }

  /**
   * Yields the user's owned games.
   *
   * GetOwnedGames returns everything in one response, so there is no real
   * pagination - but the contract stays an AsyncIterable so the worker can
   * upsert incrementally and so Xbox, which does paginate, needs no special
   * casing downstream.
   */
  async *getLibrary(session: ProviderSession, opts?: SyncOptions): AsyncIterable<ExternalGame> {
    const data = await this.http.requestJson<unknown>({
      path: 'IPlayerService/GetOwnedGames/v1/',
      query: {
        key: this.config.apiKey,
        steamid: session.providerUserId,
        include_appinfo: true,
        include_played_free_games: true,
        format: 'json',
      },
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });

    const parsed = parseOrThrow(steamOwnedGamesResponseSchema, data, 'owned games');
    const games = parsed.response.games;

    // Steam answers a private profile with 200 and an empty object rather than
    // a 403. Without this check the sync would silently report "0 games" and
    // the user would think OMNIPLAY was broken (spec 14).
    if (games === undefined) {
      const profile = await this.getProfile(session);
      const visibility = profile.raw?.['communityvisibilitystate'];
      if (typeof visibility === 'number' && visibility < PUBLIC_VISIBILITY) {
        throw new ProviderError(
          'PRIVATE_PROFILE',
          'Your Steam profile and game details are private, so Steam will not share your library. Set "Game details" to Public in your Steam privacy settings and sync again.',
          { provider: 'steam' },
        );
      }
      return;
    }

    for (const game of games) {
      yield mapSteamGame(game);
    }
  }

  /**
   * Steam reports playtime as a lifetime total, never as sessions.
   *
   * These are emitted as LIFETIME_TOTAL so that statistics never sum them
   * across syncs, and as RECENT_PLAY for the two-week window, which is the
   * only temporal signal Steam gives us.
   */
  async *getPlayHistory(
    session: ProviderSession,
    opts?: SyncOptions,
  ): AsyncIterable<ExternalPlayEvent> {
    for await (const game of this.getLibrary(session, opts)) {
      if (game.minutesPlayedTotal && game.minutesPlayedTotal > 0) {
        yield {
          externalGameId: game.externalId,
          activityType: 'LIFETIME_TOTAL',
          minutesPlayed: game.minutesPlayedTotal,
          endedAt: game.lastPlayedAt ?? null,
          confidence: 'VERIFIED',
        };
      }

      const recentMinutes = (game.raw?.['playtime_2weeks'] as number | undefined) ?? 0;
      if (recentMinutes > 0) {
        const now = new Date();
        yield {
          externalGameId: game.externalId,
          activityType: 'RECENT_PLAY',
          minutesPlayed: recentMinutes,
          startedAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
          endedAt: game.lastPlayedAt ?? now,
          // The window is real but its distribution within those two weeks is
          // not something Steam tells us.
          confidence: 'DERIVED',
        };
      }
    }
  }

  async *getAchievements(
    session: ProviderSession,
    externalGameId: string,
  ): AsyncIterable<ExternalAchievement> {
    let data: unknown;
    try {
      data = await this.http.requestJson<unknown>({
        path: 'ISteamUserStats/GetPlayerAchievements/v1/',
        query: {
          key: this.config.apiKey,
          steamid: session.providerUserId,
          appid: externalGameId,
          l: 'english',
        },
      });
    } catch (error) {
      // Most games simply have no achievements, and Steam signals that with a
      // 400. That is an expected outcome for a library sweep, not a failure.
      if (error instanceof ProviderError && error.options.status === 400) return;
      throw error;
    }

    const parsed = parseOrThrow(steamPlayerAchievementsResponseSchema, data, 'achievements');
    if (parsed.playerstats.success === false) return;

    // How many players worldwide hold each one. A separate endpoint, and a
    // public one needing no key, which is why this was missing: the rest of
    // the Steam adapter authenticates and this call does not.
    const rarity = await this.globalUnlockRates(externalGameId);
    // Artwork lives in the game schema, not in the player's achievements.
    const art = await this.achievementArt(externalGameId);

    for (const achievement of parsed.playerstats.achievements ?? []) {
      const unlockedAt =
        achievement.unlocktime && achievement.unlocktime > 0
          ? new Date(achievement.unlocktime * 1000)
          : null;

      yield {
        externalId: achievement.apiname,
        externalGameId,
        name: achievement.name ?? achievement.apiname,
        description: achievement.description ?? null,
        iconUrl: art.get(achievement.apiname) ?? null,
        // Steam has no per-achievement score; Gamerscore has no equivalent here.
        points: null,
        globalUnlockRate: rarity.get(achievement.apiname) ?? null,
        unlocked: achievement.achieved === 1,
        unlockedAt,
      };
    }
  }

  /**
   * Global unlock rate per achievement, as a fraction of all players.
   *
   * Steam publishes this on an unauthenticated endpoint separate from
   * everything else the adapter calls, keyed by the same `apiname` the player
   * achievements use — so the join is exact rather than by title. A failure
   * here is not a failure of the sweep: rarity is an enrichment, and a game
   * without it still imports its achievements.
   */
  /**
   * Achievement artwork, from the game's schema.
   *
   * `GetPlayerAchievements` carries names and unlock state but no icons, so
   * every Steam achievement was stored with a null icon and rendered as an
   * empty box beside PlayStation and Xbox artwork. Two icons exist per
   * achievement — earned and greyed-out — and the earned one is taken, since
   * this is the image shown wherever an unlock is displayed.
   *
   * Best-effort like the rarity call: no artwork must never cost the sweep
   * its achievements.
   */
  private async achievementArt(appId: string): Promise<Map<string, string>> {
    const art = new Map<string, string>();

    let data: unknown;
    try {
      data = await this.http.requestJson<unknown>({
        path: 'ISteamUserStats/GetSchemaForGame/v2/',
        query: { key: this.config.apiKey, appid: appId, l: 'english' },
      });
    } catch {
      return art;
    }

    const parsed = steamGameSchemaSchema.safeParse(data);
    if (!parsed.success) return art;

    for (const entry of parsed.data.game?.availableGameStats?.achievements ?? []) {
      if (entry.icon) art.set(entry.name, entry.icon);
    }

    return art;
  }

  private async globalUnlockRates(appId: string): Promise<Map<string, number>> {
    const rates = new Map<string, number>();

    let data: unknown;
    try {
      data = await this.http.requestJson<unknown>({
        path: 'ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/',
        query: { gameid: appId },
      });
    } catch {
      return rates;
    }

    const parsed = steamGlobalPercentagesSchema.safeParse(data);
    if (!parsed.success) return rates;

    for (const entry of parsed.data.achievementpercentages?.achievements ?? []) {
      const percent = typeof entry.percent === 'string' ? Number(entry.percent) : entry.percent;
      // Stored as a fraction, matching how PlayStation's rate is stored, so
      // the two are directly comparable wherever they are shown together.
      if (Number.isFinite(percent)) rates.set(entry.name, percent / 100);
    }

    return rates;
  }

  async disconnect(): Promise<void> {
    // Nothing to revoke: we never held a user credential. The caller deletes
    // the local connection and any imported data.
  }
}

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
  type ProviderCredentials,
  type ProviderSession,
} from '@omniplay/types';
import { createHash, randomBytes } from 'node:crypto';
import { ProviderHttpClient } from '../http/client.js';
import {
  buildXblAuthorization,
  buildXboxAuthUrl,
  exchangeCodeForMicrosoftTokens,
  getXboxUserToken,
  getXstsToken,
  refreshMicrosoftTokens,
  XBOX_SCOPES,
  type XboxOAuthConfig,
} from './xbox.tokens.js';

/**
 * Xbox provider adapter (spec 5.2).
 *
 * The honesty constraint that shapes this whole file: Xbox's title history
 * endpoint is *achievement-derived*. It lists titles the user has earned
 * achievements in, plus recent activity - it is not a complete record of every
 * game they have ever launched, and it is not an ownership list at all.
 *
 * So everything from here is recorded as activity with `DETECTED` confidence
 * and ACHIEVEMENT_HISTORY as its type. Presenting it as ownership would put
 * fabricated entries in a user's library, which is precisely the failure mode
 * the spec warns about.
 */

export interface XboxProviderConfig extends XboxOAuthConfig {}

const PROFILE_URL = 'https://profile.xboxlive.com/';
const TITLEHUB_URL = 'https://titlehub.xboxlive.com/';
const ACHIEVEMENTS_URL = 'https://achievements.xboxlive.com/';

/* ------------------------------------------------------------------ *
 * Wire schemas
 * ------------------------------------------------------------------ */

const profileResponseSchema = z.object({
  profileUsers: z.array(
    z.object({
      id: z.string(),
      settings: z.array(z.object({ id: z.string(), value: z.string() })),
    }),
  ),
});

const titleHistorySchema = z.object({
  titles: z.array(
    z.object({
      titleId: z.string(),
      name: z.string(),
      displayImage: z.string().optional(),
      devices: z.array(z.string()).optional(),
      titleHistory: z
        .object({ lastTimePlayed: z.string().optional() })
        .optional(),
      achievement: z
        .object({
          currentAchievements: z.number().optional(),
          totalAchievements: z.number().optional(),
          currentGamerscore: z.number().optional(),
          totalGamerscore: z.number().optional(),
          progressPercentage: z.number().optional(),
        })
        .optional(),
    }),
  ),
});

const achievementsSchema = z.object({
  achievements: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      lockedDescription: z.string().optional(),
      progressState: z.string().optional(),
      isSecret: z.boolean().optional(),
      progression: z.object({ timeUnlocked: z.string().optional() }).optional(),
      rewards: z
        .array(z.object({ value: z.string().optional(), type: z.string().optional() }))
        .optional(),
      mediaAssets: z
        .array(z.object({ type: z.string().optional(), url: z.string().optional() }))
        .optional(),
    }),
  ),
  pagingInfo: z.object({ continuationToken: z.string().nullable().optional() }).optional(),
});

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

export class XboxProvider implements GamingProvider {
  readonly id = 'xbox';
  readonly displayName = 'Xbox';

  readonly capabilities: ProviderCapabilities = {
    // Not an ownership list - see the file comment. "partial" is what the
    // settings screen renders as a caveat rather than a tick.
    library: 'partial',
    // Xbox exposes no playtime figure at all through these endpoints.
    playtime: 'none',
    achievements: 'full',
    playHistory: 'partial',
    profile: 'full',
    incrementalSync: false,
    importOnly: false,
  };

  private readonly http: ProviderHttpClient;

  constructor(private readonly config: XboxProviderConfig) {
    if (!config.clientId) {
      throw new Error('XboxProvider requires an Azure app client id (XBOX_CLIENT_ID).');
    }
    this.http = new ProviderHttpClient({
      provider: 'xbox',
      requestsPerSecond: 5,
      burst: 10,
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    });
  }

  get health() {
    return this.http.health;
  }

  async beginAuth({ redirectUri }: { redirectUri: string }): Promise<AuthStartResult> {
    const state = randomBytes(32).toString('base64url');
    // PKCE, so an intercepted authorization code is useless without the
    // verifier we keep server-side.
    const verifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');

    return {
      redirectUrl: buildXboxAuthUrl(this.config, { redirectUri, state, codeChallenge }),
      state,
      verifier,
    };
  }

  async completeAuth(input: {
    params: Record<string, string>;
    state: string;
    verifier?: string;
    redirectUri: string;
  }): Promise<AuthCompleteResult> {
    if (input.params['error']) {
      throw new ProviderError(
        'AUTH_INVALID',
        `Xbox sign-in was declined: ${input.params['error_description'] ?? input.params['error']}`,
        { provider: 'xbox' },
      );
    }
    if (!input.params['state'] || input.params['state'] !== input.state) {
      throw new ProviderError('AUTH_INVALID', 'Xbox sign-in state did not match.', {
        provider: 'xbox',
      });
    }
    const code = input.params['code'];
    if (!code) {
      throw new ProviderError('AUTH_INVALID', 'Xbox callback carried no authorization code.', {
        provider: 'xbox',
      });
    }

    const microsoft = await exchangeCodeForMicrosoftTokens(this.config, {
      code,
      redirectUri: input.redirectUri,
      ...(input.verifier ? { codeVerifier: input.verifier } : {}),
    });

    const { xsts } = await this.escalate(microsoft.accessToken);
    if (!xsts.xuid) {
      throw new ProviderError('AUTH_INVALID', 'Xbox did not return a user id for this account.', {
        provider: 'xbox',
      });
    }

    const session: ProviderSession = {
      providerUserId: xsts.xuid,
      credentials: {
        accessToken: microsoft.accessToken,
        refreshToken: microsoft.refreshToken,
        expiresAt: microsoft.expiresAt,
        scopes: [...XBOX_SCOPES],
        extra: { userHash: xsts.userHash, xstsToken: xsts.token, xstsExpiresAt: xsts.expiresAt },
      },
    };

    const profile = await this.getProfile(session);

    return {
      account: {
        providerUserId: xsts.xuid,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        profileUrl: null,
      },
      credentials: session.credentials,
      status: 'ACTIVE',
    };
  }

  /**
   * Refreshes the Microsoft token and re-runs the Xbox escalation.
   *
   * The XSTS token expires in hours while the Microsoft refresh token lasts
   * far longer, so the refresh path always redoes stages 2-3 rather than
   * trying to cache an XSTS token across syncs.
   */
  async refreshCredentials(session: ProviderSession): Promise<ProviderCredentials | null> {
    const refreshToken = session.credentials.refreshToken;
    if (!refreshToken) {
      throw new ProviderError('AUTH_EXPIRED', 'Xbox connection has no refresh token.', {
        provider: 'xbox',
      });
    }

    const microsoft = await refreshMicrosoftTokens(this.config, refreshToken);
    const { xsts } = await this.escalate(microsoft.accessToken);

    return {
      accessToken: microsoft.accessToken,
      // Microsoft rotates refresh tokens; keep the old one if none came back.
      refreshToken: microsoft.refreshToken ?? refreshToken,
      expiresAt: microsoft.expiresAt,
      scopes: [...XBOX_SCOPES],
      extra: { userHash: xsts.userHash, xstsToken: xsts.token, xstsExpiresAt: xsts.expiresAt },
    };
  }

  private async escalate(microsoftAccessToken: string) {
    const user = await getXboxUserToken(this.config, microsoftAccessToken);
    const xsts = await getXstsToken(this.config, user.token);
    return { user, xsts };
  }

  /** Reads the XBL3.0 header out of a session, failing loudly if absent. */
  private authHeader(session: ProviderSession): string {
    const userHash = session.credentials.extra?.['userHash'];
    const xstsToken = session.credentials.extra?.['xstsToken'];
    if (typeof userHash !== 'string' || typeof xstsToken !== 'string') {
      throw new ProviderError('AUTH_EXPIRED', 'Xbox session is missing its XSTS token.', {
        provider: 'xbox',
      });
    }
    return buildXblAuthorization(userHash, xstsToken);
  }

  async getProfile(session: ProviderSession): Promise<ExternalProfile> {
    const data = await this.http.requestJson<unknown>({
      path: new URL('users/me/profile/settings', PROFILE_URL).toString(),
      query: { settings: 'Gamertag,GameDisplayPicRaw,Gamerscore,AccountTier' },
      headers: {
        authorization: this.authHeader(session),
        'x-xbl-contract-version': '3',
      },
    });

    const parsed = profileResponseSchema.safeParse(data);
    if (!parsed.success || !parsed.data.profileUsers[0]) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected Xbox profile response.', {
        provider: 'xbox',
        ...(parsed.success ? {} : { cause: parsed.error }),
      });
    }

    const user = parsed.data.profileUsers[0];
    const settings = new Map(user.settings.map((s) => [s.id, s.value]));
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
   * Emitted with DETECTED confidence and no ownership block: we know the game
   * was played, and we do not know that it was bought (spec 5.2).
   */
  async *getLibrary(session: ProviderSession): AsyncIterable<ExternalGame> {
    for (const title of await this.fetchTitleHistory(session)) {
      yield {
        externalId: title.titleId,
        name: title.name,
        platformHint: title.devices?.[0] ?? 'Xbox',
        coverUrl: title.displayImage ?? null,
        // Deliberately no `ownership`: activity is not entitlement.
        minutesPlayedTotal: null,
        lastPlayedAt: parseDate(title.titleHistory?.lastTimePlayed),
        confidence: 'DETECTED',
        raw: {
          currentGamerscore: title.achievement?.currentGamerscore,
          totalGamerscore: title.achievement?.totalGamerscore,
          currentAchievements: title.achievement?.currentAchievements,
          totalAchievements: title.achievement?.totalAchievements,
        },
      };
    }
  }

  async *getPlayHistory(session: ProviderSession): AsyncIterable<ExternalPlayEvent> {
    for (const title of await this.fetchTitleHistory(session)) {
      const lastPlayed = parseDate(title.titleHistory?.lastTimePlayed);
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
  }

  private async fetchTitleHistory(session: ProviderSession) {
    const data = await this.http.requestJson<unknown>({
      path: new URL(
        `users/xuid(${session.providerUserId})/titles/titlehistory/decoration/achievement,scid`,
        TITLEHUB_URL,
      ).toString(),
      headers: {
        authorization: this.authHeader(session),
        'x-xbl-contract-version': '2',
        'accept-language': 'en-US',
      },
    });

    const parsed = titleHistorySchema.safeParse(data);
    if (!parsed.success) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected Xbox title history response.', {
        provider: 'xbox',
        cause: parsed.error,
      });
    }
    return parsed.data.titles;
  }

  async *getAchievements(
    session: ProviderSession,
    externalGameId: string,
  ): AsyncIterable<ExternalAchievement> {
    let continuationToken: string | null = null;

    do {
      const data: unknown = await this.http.requestJson<unknown>({
        path: new URL(`users/xuid(${session.providerUserId})/achievements`, ACHIEVEMENTS_URL).toString(),
        query: {
          titleId: externalGameId,
          maxItems: 200,
          ...(continuationToken ? { continuationToken } : {}),
        },
        headers: {
          authorization: this.authHeader(session),
          'x-xbl-contract-version': '2',
        },
      });

      const parsed = achievementsSchema.safeParse(data);
      if (!parsed.success) {
        throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected Xbox achievements response.', {
          provider: 'xbox',
          cause: parsed.error,
        });
      }

      for (const achievement of parsed.data.achievements) {
        const gamerscore = achievement.rewards?.find((r) => r.type === 'Gamerscore')?.value;
        yield {
          externalId: achievement.id,
          externalGameId,
          name: achievement.name,
          description: achievement.description ?? achievement.lockedDescription ?? null,
          points: gamerscore ? Number(gamerscore) : null,
          hidden: achievement.isSecret ?? false,
          iconUrl: achievement.mediaAssets?.find((m) => m.type === 'Icon')?.url ?? null,
          unlocked: achievement.progressState === 'Achieved',
          unlockedAt: parseDate(achievement.progression?.timeUnlocked),
        };
      }

      continuationToken = parsed.data.pagingInfo?.continuationToken ?? null;
    } while (continuationToken);
  }

  async disconnect(): Promise<void> {
    // Microsoft has no programmatic revoke for this grant; the user removes
    // consent at account.live.com/consent/Manage. We delete our copy.
  }
}

/** Xbox uses a sentinel date for "never"; treat it as absent. */
function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear() <= 1601 ? null : date;
}

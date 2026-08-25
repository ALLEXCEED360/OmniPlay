import { z } from 'zod';
import { ProviderError } from '@omniplay/types';

/**
 * The Xbox Live token chain (spec 5.2).
 *
 * Reaching Xbox services from a website is a four-stage exchange, and each
 * stage produces a credential the next one consumes:
 *
 *   1. Microsoft OAuth  -> Microsoft access token   (scope XboxLive.signin)
 *   2. user.auth        -> Xbox user token          (the "d=" prefix matters)
 *   3. xsts.auth        -> XSTS token + userhash    (relying party xboxlive.com)
 *   4. Xbox services    -> Authorization: XBL3.0 x=<userhash>;<xsts token>
 *
 * The "d=" prefix on the RpsTicket in stage 2 is required specifically because
 * we are using our own Azure app registration rather than a first-party
 * Microsoft client. Omitting it is the single most common cause of a silent
 * 400 here.
 *
 * XSTS tokens are short-lived (hours). The Microsoft refresh token is what we
 * persist; stages 2-4 are re-run on each sync, which is why they are cheap,
 * pure functions over a fetch implementation.
 */

const MS_AUTHORIZE_URL = 'https://login.live.com/oauth20_authorize.srf';
const MS_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
const XBOX_USER_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XBOX_XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';

/**
 * XboxLive.signin grants profile/achievement read access; offline_access is
 * what makes a refresh token available, without which every sync would need
 * the user to sign in again (spec 23: least-privilege scopes).
 */
export const XBOX_SCOPES = ['XboxLive.signin', 'XboxLive.offline_access'] as const;

export interface XboxOAuthConfig {
  clientId: string;
  /** Optional: a public-client Azure registration has none. */
  clientSecret?: string | undefined;
  fetchImpl?: typeof fetch;
}

/* ------------------------------------------------------------------ *
 * Stage 1 - Microsoft OAuth
 * ------------------------------------------------------------------ */

export function buildXboxAuthUrl(
  config: XboxOAuthConfig,
  input: { redirectUri: string; state: string; codeChallenge?: string },
): string {
  const url = new URL(MS_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', XBOX_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

const msTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  token_type: z.string().optional(),
});

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

export async function exchangeCodeForMicrosoftTokens(
  config: XboxOAuthConfig,
  input: { code: string; redirectUri: string; codeVerifier?: string },
): Promise<MicrosoftTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    scope: XBOX_SCOPES.join(' '),
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);

  return postMicrosoftToken(config, body);
}

export async function refreshMicrosoftTokens(
  config: XboxOAuthConfig,
  refreshToken: string,
): Promise<MicrosoftTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: XBOX_SCOPES.join(' '),
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);

  return postMicrosoftToken(config, body);
}

async function postMicrosoftToken(
  config: XboxOAuthConfig,
  body: URLSearchParams,
): Promise<MicrosoftTokens> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    // A refused refresh means the user revoked consent or changed their
    // password: re-authorisation, not retrying, is the fix.
    throw new ProviderError(
      response.status === 400 || response.status === 401 ? 'AUTH_EXPIRED' : 'UNAVAILABLE',
      `Microsoft token request failed (${response.status}): ${detail}`,
      { provider: 'xbox', status: response.status },
    );
  }

  const parsed = msTokenSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ProviderError('MALFORMED_RESPONSE', 'Unexpected Microsoft token response.', {
      provider: 'xbox',
      cause: parsed.error,
    });
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000),
  };
}

/* ------------------------------------------------------------------ *
 * Stages 2 and 3 - Xbox user token and XSTS
 * ------------------------------------------------------------------ */

const xboxTokenSchema = z.object({
  IssueInstant: z.string().optional(),
  NotAfter: z.string(),
  Token: z.string(),
  DisplayClaims: z.object({
    xui: z.array(z.object({ uhs: z.string(), xid: z.string().optional() })),
  }),
});

export interface XboxUserToken {
  token: string;
  userHash: string;
  expiresAt: Date;
}

export interface XstsToken extends XboxUserToken {
  /** The Xbox user id, present on the XSTS response. */
  xuid: string | null;
}

/** Stage 2: Microsoft access token -> Xbox user token. */
export async function getXboxUserToken(
  config: XboxOAuthConfig,
  microsoftAccessToken: string,
): Promise<XboxUserToken> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(XBOX_USER_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        // The "d=" prefix marks this as a token from a custom Azure app rather
        // than a first-party Microsoft client. Without it Xbox returns 400.
        RpsTicket: `d=${microsoftAccessToken}`,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const parsed = await parseXboxToken(response, 'user token');
  const claim = parsed.DisplayClaims.xui[0];
  if (!claim) {
    throw new ProviderError('MALFORMED_RESPONSE', 'Xbox user token carried no display claims.', {
      provider: 'xbox',
    });
  }

  return {
    token: parsed.Token,
    userHash: claim.uhs,
    expiresAt: new Date(parsed.NotAfter),
  };
}

/** Stage 3: Xbox user token -> XSTS token for the xboxlive.com relying party. */
export async function getXstsToken(
  config: XboxOAuthConfig,
  userToken: string,
): Promise<XstsToken> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(XBOX_XSTS_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      RelyingParty: 'http://xboxlive.com',
      TokenType: 'JWT',
      Properties: { UserTokens: [userToken], SandboxId: 'RETAIL' },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const parsed = await parseXboxToken(response, 'XSTS token');
  const claim = parsed.DisplayClaims.xui[0];
  if (!claim) {
    throw new ProviderError('MALFORMED_RESPONSE', 'XSTS token carried no display claims.', {
      provider: 'xbox',
    });
  }

  return {
    token: parsed.Token,
    userHash: claim.uhs,
    xuid: claim.xid ?? null,
    expiresAt: new Date(parsed.NotAfter),
  };
}

/**
 * XSTS failures are reported as a 401 with an XErr code, and the codes are the
 * difference between "tell the user to retry" and "tell the user why their
 * account cannot be used". Translating them is worth the lines.
 */
const XSTS_ERRORS: Record<string, string> = {
  '2148916227': 'This Xbox account has been banned from Xbox Live.',
  '2148916233':
    'This Microsoft account has no Xbox profile. Sign in at xbox.com once to create one, then reconnect.',
  '2148916235': 'Xbox Live is not available in this account\'s country or region.',
  '2148916236': 'This account requires adult verification before it can be used.',
  '2148916237': 'This account requires adult verification before it can be used.',
  '2148916238':
    'This is a child account and must be added to a family group by an adult before it can connect.',
};

async function parseXboxToken(
  response: Response,
  context: string,
): Promise<z.infer<typeof xboxTokenSchema>> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const xErr = /"XErr"\s*:\s*(\d+)/.exec(text)?.[1];
    const friendly = xErr ? XSTS_ERRORS[xErr] : undefined;

    if (friendly) {
      throw new ProviderError('FORBIDDEN', friendly, {
        provider: 'xbox',
        status: response.status,
      });
    }
    throw new ProviderError(
      response.status === 401 ? 'AUTH_EXPIRED' : 'UNAVAILABLE',
      `Xbox ${context} request failed (${response.status}).`,
      { provider: 'xbox', status: response.status },
    );
  }

  const parsed = xboxTokenSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ProviderError('MALFORMED_RESPONSE', `Unexpected Xbox ${context} response.`, {
      provider: 'xbox',
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** The header every Xbox services call carries. */
export function buildXblAuthorization(userHash: string, xstsToken: string): string {
  return `XBL3.0 x=${userHash};${xstsToken}`;
}

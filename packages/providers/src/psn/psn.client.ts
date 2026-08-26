import { ProviderError, type ProviderCredentials } from '@omniplay/types';
import { ProviderHttpClient } from '../http/client.js';

/**
 * PlayStation authentication.
 *
 * Sony publishes no consumer API, so this speaks to the endpoints the
 * PlayStation mobile app uses, with that app's own client credentials. Three
 * credentials with three lifetimes are in play, and confusing them produces
 * errors that look like outages:
 *
 *   npsso          ~60 days   a browser session cookie the user pastes in
 *   refresh token  ~10 days   minted from the npsso
 *   access token   ~1 hour    minted from the refresh token
 *
 * Only the npsso needs a human. When it lapses the adapter has to say so in
 * those words - an expired session surfaced as a bare 400 sends people hunting
 * for a bug that is really a login.
 */

const AUTH_BASE = 'https://ca.account.sony.com/api/authz/v3/oauth';
const REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
/** The PlayStation mobile app's client id and secret, base64 as HTTP Basic. */
const BASIC_AUTH = 'MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

/** Refresh this long before expiry, so a sync never races the clock. */
const EXPIRY_GRACE_MS = 60_000;

export interface PsnTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  accountId: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * The account id, read out of the access token rather than asked for.
 *
 * Every PSN path wants a numeric account id and none of them accept "me" -
 * that returns `Bad Request (path: accountId)`. The token is a JWT carrying
 * the id already, which saves a call and a failure mode.
 */
export function accountIdFromToken(accessToken: string): string {
  const segment = accessToken.split('.')[1];
  if (!segment) {
    throw new ProviderError('MALFORMED_RESPONSE', 'PlayStation access token is not a JWT.', {
      provider: 'psn',
    });
  }

  try {
    const payload = JSON.parse(Buffer.from(segment, 'base64').toString('utf8')) as {
      account_id?: string;
    };
    if (!payload.account_id) throw new Error('no account_id');
    return payload.account_id;
  } catch {
    throw new ProviderError(
      'MALFORMED_RESPONSE',
      'PlayStation access token carries no account id.',
      { provider: 'psn' },
    );
  }
}

export function expiredNpssoError(detail?: string): ProviderError {
  return new ProviderError(
    'AUTH_INVALID',
    'The PlayStation session token (PSN_NPSSO) has expired or was rejected. ' +
      'Sign in at https://www.playstation.com, open ' +
      'https://ca.account.sony.com/api/v1/ssocookie, and copy the new npsso ' +
      'value into .env.' + (detail ? ` Provider said: ${detail}` : ''),
    { provider: 'psn' },
  );
}

/**
 * Exchanges credentials for an access token.
 *
 * Deliberately not routed through ProviderHttpClient: the authorize step must
 * *not* follow its redirect, because the authorisation code exists only in the
 * Location header of a 302 pointing at a private URL scheme.
 */
export class PsnAuth {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly npsso: string,
    fetchImpl?: typeof fetch,
  ) {
    if (!npsso) {
      throw new ProviderError(
        'AUTH_INVALID',
        'PSN_NPSSO is not set. See .env.example for how to obtain one.',
        { provider: 'psn' },
      );
    }
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  /** npsso -> authorisation code -> tokens. */
  async fromNpsso(): Promise<PsnTokens> {
    const params = new URLSearchParams({
      access_type: 'offline',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPE,
    });

    const authorize = await this.fetchImpl(`${AUTH_BASE}/authorize?${params.toString()}`, {
      redirect: 'manual',
      headers: { Cookie: `npsso=${this.npsso}` },
    });

    const location = authorize.headers.get('location') ?? '';
    const code = new URLSearchParams(location.split('?')[1] ?? '').get('code');

    // No code means the cookie was not accepted, which is nearly always an
    // expired npsso rather than anything wrong with the request.
    if (!code) throw expiredNpssoError();

    return this.exchange({
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      token_format: 'jwt',
    });
  }

  /** Refresh token -> new access token, without touching the npsso. */
  async refresh(refreshToken: string): Promise<PsnTokens> {
    return this.exchange({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      token_format: 'jwt',
      scope: SCOPE,
    });
  }

  private async exchange(body: Record<string, string>): Promise<PsnTokens> {
    const response = await this.fetchImpl(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${BASIC_AUTH}`,
      },
      body: new URLSearchParams(body).toString(),
    });

    const payload = (await response.json().catch(() => null)) as TokenResponse | null;

    if (!response.ok || !payload?.access_token || !payload.refresh_token) {
      throw expiredNpssoError(payload?.error_description ?? payload?.error);
    }

    const accessToken = payload.access_token;
    return {
      accessToken,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      accountId: accountIdFromToken(accessToken),
    };
  }
}

/**
 * Holds the current access token and renews it before it lapses.
 *
 * A sync outlives the one-hour access token whenever a trophy sweep is
 * involved, so this refreshes mid-run rather than failing halfway through a
 * library the user is watching import.
 */
export class PsnTokenStore {
  private tokens: PsnTokens | null = null;
  private inFlight: Promise<PsnTokens> | null = null;

  constructor(
    private readonly auth: PsnAuth,
    initial?: ProviderCredentials | null,
  ) {
    const accessToken = initial?.accessToken;
    const refreshToken = initial?.refreshToken;
    if (accessToken && refreshToken) {
      this.tokens = {
        accessToken,
        refreshToken,
        expiresAt: initial?.expiresAt?.getTime() ?? 0,
        accountId: accountIdFromToken(accessToken),
      };
    }
  }

  /** Current tokens, minting or refreshing them as needed. */
  async current(): Promise<PsnTokens> {
    const held = this.tokens;
    if (held && held.expiresAt - EXPIRY_GRACE_MS > Date.now()) return held;

    // Concurrent callers share one exchange: the library and trophy passes run
    // as separate iterators and must not each burn a refresh.
    this.inFlight ??= this.mint(held).finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async mint(held: PsnTokens | null): Promise<PsnTokens> {
    if (held?.refreshToken) {
      try {
        this.tokens = await this.auth.refresh(held.refreshToken);
        return this.tokens;
      } catch {
        // The refresh token lasts ~10 days against the npsso's ~60, so it
        // lapses first. Falling back to the npsso is the normal path here,
        // not an error worth surfacing.
      }
    }

    this.tokens = await this.auth.fromNpsso();
    return this.tokens;
  }
}

/** The API client. Authorisation is attached per request by the provider. */
export function createPsnHttp(fetchImpl?: typeof fetch): ProviderHttpClient {
  return new ProviderHttpClient({
    provider: 'psn',
    baseUrl: 'https://m.np.playstation.com/api/',
    // Sony documents no limit. Two per second is well under what the mobile
    // app itself does, and a 429 is answered by the shared backoff.
    requestsPerSecond: 2,
    burst: 4,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

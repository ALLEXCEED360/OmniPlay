import { ProviderError } from '@omniplay/types';

/**
 * Steam sign-in via OpenID 2.0.
 *
 * Steam never issues an access token. The entire result of a successful login
 * is a verified SteamID64, and all subsequent data access uses *our* publisher
 * Web API key rather than anything belonging to the user. That has two
 * consequences worth stating plainly:
 *
 *  - There is no refresh flow and nothing user-specific to encrypt.
 *  - We can only read what the user has made public. A private profile yields
 *    an empty library, not an error, and the UI must say so (spec 24).
 *
 * OpenID 2.0 is long deprecated generally, but it remains Steam's documented
 * and supported browser sign-in, so it is the correct choice here.
 */

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const OPENID_IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';

/** Steam returns the identity as a claimed_id URL ending in the SteamID64. */
const CLAIMED_ID_PATTERN = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export interface SteamAuthConfig {
  /** The scheme+host of our site, e.g. "https://omniplay.app". */
  realm: string;
  fetchImpl?: typeof fetch;
}

/** Builds the URL to send the user's browser to. */
export function buildSteamAuthUrl(config: SteamAuthConfig, returnUrl: string): string {
  const url = new URL(STEAM_OPENID_ENDPOINT);
  url.searchParams.set('openid.ns', OPENID_NS);
  url.searchParams.set('openid.mode', 'checkid_setup');
  url.searchParams.set('openid.return_to', returnUrl);
  url.searchParams.set('openid.realm', config.realm);
  url.searchParams.set('openid.identity', OPENID_IDENTIFIER_SELECT);
  url.searchParams.set('openid.claimed_id', OPENID_IDENTIFIER_SELECT);
  return url.toString();
}

/**
 * Verifies a Steam OpenID callback and returns the SteamID64.
 *
 * The `check_authentication` round-trip is mandatory and must not be skipped:
 * without it, anyone can forge a callback URL naming any SteamID and take over
 * that identity. This is the single most security-critical function in the
 * Steam adapter.
 */
export async function verifySteamCallback(
  params: Record<string, string>,
  config: SteamAuthConfig,
): Promise<string> {
  if (params['openid.mode'] !== 'id_res') {
    throw new ProviderError(
      'AUTH_INVALID',
      `Steam sign-in did not complete (mode: ${params['openid.mode'] ?? 'missing'}).`,
      { provider: 'steam' },
    );
  }

  const claimedId = params['openid.claimed_id'];
  if (!claimedId) {
    throw new ProviderError('AUTH_INVALID', 'Steam callback is missing a claimed identity.', {
      provider: 'steam',
    });
  }

  // Echo every openid.* parameter back verbatim, with only the mode changed.
  // Steam signs a specific parameter set; altering or dropping any of them
  // invalidates the signature check.
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('openid.')) body.set(key, value);
  }
  body.set('openid.mode', 'check_authentication');

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new ProviderError('UNAVAILABLE', 'Could not reach Steam to verify sign-in.', {
      provider: 'steam',
      cause,
    });
  }

  if (!response.ok) {
    throw new ProviderError('UNAVAILABLE', `Steam verification returned ${response.status}.`, {
      provider: 'steam',
      status: response.status,
    });
  }

  const text = await response.text();
  // The response is key-value lines; we require an explicit affirmative.
  if (!/^is_valid\s*:\s*true$/m.test(text)) {
    throw new ProviderError('AUTH_INVALID', 'Steam rejected the sign-in signature.', {
      provider: 'steam',
    });
  }

  const match = CLAIMED_ID_PATTERN.exec(claimedId);
  if (!match?.[1]) {
    throw new ProviderError('AUTH_INVALID', `Unrecognised Steam identity URL: ${claimedId}`, {
      provider: 'steam',
    });
  }

  return match[1];
}

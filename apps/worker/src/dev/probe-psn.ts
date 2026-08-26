/**
 * Captures real PlayStation responses so the adapter is written against fact.
 *
 *   pnpm --filter @omniplay/worker probe:psn
 *
 * Reads PSN_NPSSO from the environment and never prints it. Sony publishes no
 * consumer API, so every shape here was discovered by asking rather than by
 * reading documentation — which makes capturing it first the only way to know
 * what the adapter is being written against.
 *
 * Identifiers are stripped before anything is written: the account id, the
 * online id and the avatar URLs are all personal, and fixtures are committed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AUTH = 'https://ca.account.sony.com/api/authz/v3/oauth';
const API = 'https://m.np.playstation.com/api';
const REDIRECT = 'com.scee.psxandroid.scecompcall://redirect';
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
/** The PlayStation mobile app's own credentials, as used by psn-api/PSNAWP. */
const BASIC = 'MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';

const OUT = fileURLToPath(new URL('../../../../packages/providers/fixtures/psn/', import.meta.url));

const PLACEHOLDER_ACCOUNT = '1234567890123456789';

/** Fields that are about the person rather than about their games. */
const REDACTED_KEYS = new Set(['personalDetail', 'aboutMe', 'firstName', 'lastName', 'middleName']);

/** Keeps a field's type so the schema still sees the right shape. */
function redact(value: unknown): unknown {
  if (typeof value === 'string') return '';
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).map((k) => [k, '']));
  }
  return value;
}

async function accessToken(npsso: string): Promise<string> {
  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: 'psn:mobile.v2.core psn:clientapp',
  });

  const authorize = await fetch(`${AUTH}/authorize?${params}`, {
    redirect: 'manual',
    headers: { Cookie: `npsso=${npsso}` },
  });

  const location = authorize.headers.get('location') ?? '';
  const code = new URLSearchParams(location.split('?')[1] ?? '').get('code');
  if (!code) {
    throw new Error(
      'PSN did not return an authorisation code. The npsso has most likely expired — ' +
        'sign in at playstation.com and read https://ca.account.sony.com/api/v1/ssocookie again.',
    );
  }

  const token = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${BASIC}`,
    },
    body: new URLSearchParams({
      code,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
      token_format: 'jwt',
    }),
  });

  const body = (await token.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`Token exchange failed (HTTP ${token.status}).`);
  return body.access_token;
}

/** The account id is in the token, so no call is needed to learn who we are. */
function accountIdFrom(token: string): string {
  const segment = token.split('.')[1] ?? '';
  const payload = JSON.parse(Buffer.from(segment, 'base64').toString('utf8')) as {
    account_id?: string;
  };
  if (!payload.account_id) throw new Error('Access token carries no account_id.');
  return payload.account_id;
}

/** Removes anything that identifies the account before a fixture is written. */
function sanitise(value: unknown, accountId: string, onlineId: string | undefined): unknown {
  if (typeof value === 'string') {
    let out = value.split(accountId).join(PLACEHOLDER_ACCOUNT);
    if (onlineId) out = out.split(onlineId).join('TestPlayer');
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => sanitise(item, accountId, onlineId));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        // Avatars are per-account URLs and carry nothing the adapter needs.
        key === 'avatars' || key === 'avatarUrls'
          ? []
          : // The profile carries the account holder's legal name and bio.
            // Neither is anything the adapter reads, and fixtures are committed.
            REDACTED_KEYS.has(key)
            ? redact(val)
            : sanitise(val, accountId, onlineId),
      ]),
    );
  }
  return value;
}

/** Keeps a fixture small while leaving its shape intact. */
function trim(value: unknown, limit = 4): unknown {
  if (Array.isArray(value)) return value.slice(0, limit).map((item) => trim(item, limit));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, trim(v, limit)]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  const npsso = process.env.PSN_NPSSO;
  if (!npsso) {
    console.error(
      'PSN_NPSSO is not set.\n' +
        'Sign in at https://www.playstation.com, then open\n' +
        'https://ca.account.sony.com/api/v1/ssocookie and copy the npsso value\n' +
        'into .env as PSN_NPSSO="..." and run this again.',
    );
    process.exitCode = 1;
    return;
  }

  const token = await accessToken(npsso);
  const accountId = accountIdFrom(token);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`${API}${path}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  };

  mkdirSync(OUT, { recursive: true });

  const profile = (await get(`/userProfile/v1/internal/users/${accountId}/profiles`)) as {
    onlineId?: string;
  };
  const onlineId = profile.onlineId;

  const write = (name: string, body: unknown, limit = 4): void => {
    const clean = sanitise(trim(body, limit), accountId, onlineId);
    writeFileSync(`${OUT}${name}.json`, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
    console.log(`  captured ${name}.json`);
  };

  write('profile', profile);

  const titles = (await get(`/gamelist/v2/users/${accountId}/titles?limit=5`)) as {
    titles?: Array<Record<string, unknown>>;
  };
  write('gamelist', titles);

  const trophyTitles = (await get(`/trophy/v1/users/${accountId}/trophyTitles?limit=5`)) as {
    trophyTitles?: Array<{ npCommunicationId: string; npServiceName: string }>;
  };
  write('trophy-titles', trophyTitles);

  const first = trophyTitles.trophyTitles?.[0];
  if (first) {
    const { npCommunicationId: np, npServiceName: service } = first;
    write(
      'trophies-earned',
      await get(
        `/trophy/v1/users/${accountId}/npCommunicationIds/${np}/trophyGroups/all/trophies` +
          `?npServiceName=${service}&limit=6`,
      ),
      6,
    );
    write(
      'trophies-defined',
      await get(
        `/trophy/v1/npCommunicationIds/${np}/trophyGroups/all/trophies` +
          `?npServiceName=${service}&limit=6`,
      ),
      6,
    );
  }

  console.log(`\nWrote fixtures to packages/providers/fixtures/psn/`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

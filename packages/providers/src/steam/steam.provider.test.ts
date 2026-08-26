import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@omniplay/types';
import { SteamProvider } from './steam.provider.js';
import { buildSteamAuthUrl, verifySteamCallback } from './steam.auth.js';

/**
 * Contract tests: the parsers run against sanitized provider payloads on every
 * CI run (spec 25). If Steam changes a response shape, this suite is where it
 * surfaces - not in a user's playtime total.
 */

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/steam/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Routes requests to fixtures by matching the Steam API path. */
function stubFetch(routes: Record<string, unknown>, onCall?: (url: string) => void) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    onCall?.(url);
    for (const [fragment, payload] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        if (payload instanceof Response) return payload;
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

const session = { providerUserId: '76561198000000000', credentials: {} };

function makeProvider(fetchImpl: typeof fetch) {
  return new SteamProvider({ apiKey: 'test-key', realm: 'https://omniplay.test', fetchImpl });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('SteamProvider', () => {
  describe('construction', () => {
    it('refuses to start without an API key', () => {
      expect(() => new SteamProvider({ apiKey: '', realm: 'https://x.test' })).toThrow(
        /STEAM_API_KEY/,
      );
    });

    it('declares playHistory as partial, because Steam has no session log', () => {
      const provider = makeProvider(stubFetch({}));
      expect(provider.capabilities.playHistory).toBe('partial');
      expect(provider.capabilities.incrementalSync).toBe(false);
    });
  });

  describe('getLibrary', () => {
    it('maps owned games into the canonical shape', async () => {
      const provider = makeProvider(stubFetch({ GetOwnedGames: fixture('owned-games') }));
      const games = await collect(provider.getLibrary(session));

      expect(games).toHaveLength(4);
      expect(games[0]).toMatchObject({
        externalId: '1091500',
        name: 'Cyberpunk 2077',
        platformHint: 'PC',
        minutesPlayedTotal: 10920,
        confidence: 'VERIFIED',
      });
      expect(games[0]?.ownership?.type).toBe('DIGITAL');
    });

    it('treats Steam\'s zero timestamp as "never played", not 1970', async () => {
      const provider = makeProvider(stubFetch({ GetOwnedGames: fixture('owned-games') }));
      const games = await collect(provider.getLibrary(session));
      const neverPlayed = games.find((g) => g.externalId === '292030');

      expect(neverPlayed?.lastPlayedAt).toBeNull();
      expect(neverPlayed?.minutesPlayedTotal).toBe(0);
    });

    it('keeps a delisted app rather than dropping it from the user history', async () => {
      const provider = makeProvider(stubFetch({ GetOwnedGames: fixture('owned-games') }));
      const games = await collect(provider.getLibrary(session));
      const delisted = games.find((g) => g.externalId === '9999999');

      expect(delisted).toBeDefined();
      expect(delisted?.name).toMatch(/Unknown Steam app 9999999/);
    });

    it('reports a private profile as such instead of an empty library', async () => {
      // Steam answers a private profile with 200 and {}, which is the trap.
      const provider = makeProvider(
        stubFetch({
          GetOwnedGames: fixture('owned-games-private'),
          GetPlayerSummaries: fixture('profile-private'),
        }),
      );

      await expect(collect(provider.getLibrary(session))).rejects.toMatchObject({
        kind: 'PRIVATE_PROFILE',
      });
    });

    it('returns empty, without error, for a public profile that owns nothing', async () => {
      const provider = makeProvider(
        stubFetch({
          GetOwnedGames: fixture('owned-games-private'),
          GetPlayerSummaries: fixture('profile'),
        }),
      );
      await expect(collect(provider.getLibrary(session))).resolves.toEqual([]);
    });

    it('rejects a structurally unexpected response', async () => {
      const provider = makeProvider(stubFetch({ GetOwnedGames: { nonsense: true } }));
      await expect(collect(provider.getLibrary(session))).rejects.toMatchObject({
        kind: 'MALFORMED_RESPONSE',
      });
    });
  });

  describe('getProfile', () => {
    it('maps a player summary', async () => {
      const provider = makeProvider(stubFetch({ GetPlayerSummaries: fixture('profile') }));
      const profile = await provider.getProfile(session);

      expect(profile).toMatchObject({
        providerUserId: '76561198000000000',
        displayName: 'TestPlayer',
        countryCode: 'IN',
      });
      expect(profile.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('getPlayHistory', () => {
    it('separates lifetime totals from the two-week window', async () => {
      const provider = makeProvider(stubFetch({ GetOwnedGames: fixture('owned-games') }));
      const events = await collect(provider.getPlayHistory(session));

      const lifetime = events.filter((e) => e.activityType === 'LIFETIME_TOTAL');
      const recent = events.filter((e) => e.activityType === 'RECENT_PLAY');

      // Three games have playtime; only Cyberpunk has a two-week figure.
      expect(lifetime).toHaveLength(3);
      expect(recent).toHaveLength(1);
      expect(recent[0]).toMatchObject({
        externalGameId: '1091500',
        minutesPlayed: 340,
        // We know the window, not the distribution inside it.
        confidence: 'DERIVED',
      });
    });

    it('emits nothing for a game that was never launched', async () => {
      const provider = makeProvider(stubFetch({ GetOwnedGames: fixture('owned-games') }));
      const events = await collect(provider.getPlayHistory(session));
      expect(events.some((e) => e.externalGameId === '292030')).toBe(false);
    });
  });

  describe('getAchievements', () => {
    it('maps locked and unlocked achievements', async () => {
      const provider = makeProvider(stubFetch({ GetPlayerAchievements: fixture('achievements') }));
      const achievements = await collect(provider.getAchievements(session, '1091500'));

      expect(achievements).toHaveLength(2);
      expect(achievements[0]).toMatchObject({
        externalId: 'ACH_STREET_KID',
        unlocked: true,
        points: null,
      });
      expect(achievements[0]?.unlockedAt).toBeInstanceOf(Date);
      expect(achievements[1]?.unlocked).toBe(false);
      expect(achievements[1]?.unlockedAt).toBeNull();
    });

    it('treats a game without achievements as empty, not as a failure', async () => {
      // Steam returns 400 for apps with no stats, which is routine during a
      // full-library sweep and must not abort the sync.
      const provider = makeProvider(
        stubFetch({ GetPlayerAchievements: new Response('bad', { status: 400 }) }),
      );
      await expect(collect(provider.getAchievements(session, '292030'))).resolves.toEqual([]);
    });
  });
});

describe('Steam OpenID', () => {
  it('builds an identifier_select authentication URL', async () => {
    const url = new URL(
      buildSteamAuthUrl({ realm: 'https://omniplay.test' }, 'https://omniplay.test/cb'),
    );
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(url.searchParams.get('openid.realm')).toBe('https://omniplay.test');
    expect(url.searchParams.get('openid.identity')).toContain('identifier_select');
  });

  const validCallback = {
    'openid.mode': 'id_res',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000000',
    'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000000',
    'openid.sig': 'abc',
    'openid.signed': 'mode,identity,claimed_id',
  };

  it('extracts the SteamID only after Steam confirms the signature', async () => {
    const fetchImpl = vi.fn(async () => new Response('ns:...\nis_valid:true\n')) as never;
    const steamId = await verifySteamCallback(validCallback, {
      realm: 'https://omniplay.test',
      fetchImpl,
    });
    expect(steamId).toBe('76561198000000000');
  });

  it('echoes every signed parameter back to Steam for verification', async () => {
    let sentBody = '';
    const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
      sentBody = String(init.body);
      return new Response('is_valid:true');
    }) as never;

    await verifySteamCallback(validCallback, { realm: 'https://omniplay.test', fetchImpl });

    const sent = new URLSearchParams(sentBody);
    expect(sent.get('openid.mode')).toBe('check_authentication');
    expect(sent.get('openid.sig')).toBe('abc');
    expect(sent.get('openid.claimed_id')).toBe(validCallback['openid.claimed_id']);
  });

  it('rejects a forged callback that Steam does not vouch for', async () => {
    // The whole point of check_authentication: without it, this forged
    // claimed_id would hand an attacker someone else's account.
    const fetchImpl = vi.fn(async () => new Response('is_valid:false')) as never;
    await expect(
      verifySteamCallback(validCallback, { realm: 'https://omniplay.test', fetchImpl }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects a claimed identity that is not a Steam profile URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('is_valid:true')) as never;
    await expect(
      verifySteamCallback(
        { ...validCallback, 'openid.claimed_id': 'https://evil.test/openid/id/76561198000000000' },
        { realm: 'https://omniplay.test', fetchImpl },
      ),
    ).rejects.toMatchObject({ kind: 'AUTH_INVALID' });
  });

  it('rejects a cancelled sign-in', async () => {
    const fetchImpl = vi.fn(async () => new Response('is_valid:true')) as never;
    await expect(
      verifySteamCallback({ 'openid.mode': 'cancel' }, { realm: 'https://x.test', fetchImpl }),
    ).rejects.toMatchObject({ kind: 'AUTH_INVALID' });
  });
});

describe('SteamProvider.completeAuth', () => {
  let provider: SteamProvider;

  beforeEach(() => {
    provider = makeProvider(
      stubFetch({
        'openid/login': new Response('is_valid:true'),
        GetPlayerSummaries: fixture('profile'),
      }),
    );
  });

  it('rejects a callback whose state does not match the one we issued', async () => {
    await expect(
      provider.completeAuth({
        params: { state: 'attacker-supplied', 'openid.mode': 'id_res' },
        state: 'the-real-one',
      }),
    ).rejects.toMatchObject({ kind: 'AUTH_INVALID' });
  });

  it('stores no credentials, because Steam issues none', async () => {
    const { state } = await provider.beginAuth({ redirectUri: 'https://omniplay.test/cb' });
    const result = await provider.completeAuth({
      params: {
        state,
        'openid.mode': 'id_res',
        'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000000',
        'openid.sig': 'x',
      },
      state,
    });

    expect(result.account.providerUserId).toBe('76561198000000000');
    expect(result.credentials).toEqual({});
    expect(result.status).toBe('ACTIVE');
  });

  it('carries our state through the OpenID return_to URL', async () => {
    const { redirectUrl, state } = await provider.beginAuth({
      redirectUri: 'https://omniplay.test/cb',
    });
    const returnTo = new URL(
      new URL(redirectUrl).searchParams.get('openid.return_to') ?? '',
    );
    expect(returnTo.searchParams.get('state')).toBe(state);
  });
});

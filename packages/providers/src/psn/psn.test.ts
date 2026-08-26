import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  isGameCategory,
  ownershipFromService,
  parseIsoDuration,
  parsePsnDate,
  PsnProvider,
} from './psn.provider.js';
import { accountIdFromToken } from './psn.client.js';

/**
 * Contract tests against responses captured from the live PlayStation API.
 *
 * The fixtures are real payloads, sanitised of the account id, the online id
 * and the account holder's name. Sony documents none of this, which makes
 * capturing it the only way to know the shape - and this project has already
 * paid for the alternative once, when hand-written IGDB fixtures agreed with a
 * field name that had been renamed and every enrichment failed while the tests
 * stayed green.
 */

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/psn/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** A JWT whose payload names an account, which is where the id comes from. */
function fakeToken(accountId = '1234567890123456789'): string {
  const payload = Buffer.from(JSON.stringify({ account_id: accountId })).toString('base64url');
  return `header.${payload}.signature`;
}

function stubFetch(routes: Record<string, unknown>, onCall?: (url: string) => void) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    onCall?.(url);

    // The token exchange, which every call depends on.
    if (url.includes('/oauth/authorize')) {
      return new Response(null, {
        status: 302,
        headers: { location: 'com.scee.psxandroid.scecompcall://redirect/?code=v3.TESTCODE' },
      });
    }
    if (url.includes('/oauth/token')) {
      return new Response(
        JSON.stringify({
          access_token: fakeToken(),
          refresh_token: 'refresh-token',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    for (const [fragment, payload] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        if (payload instanceof Response) return payload;
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    void init;
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

const make = (fetchImpl: typeof fetch) => new PsnProvider({ npsso: 'test-npsso', fetchImpl });
const session = { providerUserId: '1234567890123456789', credentials: {} };

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('PsnProvider', () => {
  describe('construction', () => {
    it('refuses to start without a session token', () => {
      expect(() => new PsnProvider({ npsso: '' })).toThrow(/PSN_NPSSO/);
    });

    it('declares playtime as full, which no other provider here can', () => {
      // Sony reports a duration for all but a handful of titles, with the
      // dates attached. Steam reports hours with no dates at all.
      expect(make(stubFetch({})).capabilities.playtime).toBe('full');
    });

    it('declares library as partial: a played list is not an owned list', () => {
      expect(make(stubFetch({})).capabilities.library).toBe('partial');
    });

    it('declares a sweep budget, because trophies cost two requests a game', () => {
      expect(make(stubFetch({})).capabilities.achievementSweepBudget).toBeGreaterThan(0);
    });
  });

  describe('authentication', () => {
    it('reads the account id from the token rather than asking for it', async () => {
      // Every PSN path wants a numeric account id and none accept "me", which
      // returns `Bad Request (path: accountId)`.
      const calls: string[] = [];
      const impl = stubFetch({ 'userProfile/v1': fixture('profile') }, (url) => calls.push(url));

      const result = await make(impl).connectDirect();
      expect(result.account.providerUserId).toBe('1234567890123456789');
      expect(calls.some((url) => url.includes('/users/me/'))).toBe(false);
    });

    it('persists both tokens so a later sync need not touch the npsso', async () => {
      // The npsso is the only credential a human has to replace; a sync that
      // fell back to it every run would burn the one thing that cannot be
      // renewed automatically.
      const result = await make(stubFetch({ 'userProfile/v1': fixture('profile') })).connectDirect();
      expect(result.credentials.accessToken).toBeTruthy();
      expect(result.credentials.refreshToken).toBe('refresh-token');
      expect(result.status).toBe('ACTIVE');
    });

    it('explains an expired session in those words', async () => {
      // A lapsed npsso surfaces as a redirect with no code. Reported as a bare
      // 400 it sends people hunting for a bug that is really a login.
      const impl = vi.fn(
        async () => new Response(null, { status: 302, headers: { location: 'https://sony/error' } }),
      ) as unknown as typeof fetch;

      await expect(make(impl).getProfile(session)).rejects.toMatchObject({
        kind: 'AUTH_INVALID',
        message: expect.stringContaining('PSN_NPSSO'),
      });
    });

    it('directs anything reaching for OAuth to the token instead', async () => {
      await expect(make(stubFetch({})).beginAuth()).rejects.toThrow(/session token/);
    });
  });

  describe('getLibrary', () => {
    const routes = { 'gamelist/v2': fixture('gamelist') };

    it('maps titles into the canonical shape', async () => {
      const games = await collect(make(stubFetch(routes)).getLibrary(session));

      expect(games.length).toBeGreaterThan(0);
      expect(games[0]).toMatchObject({
        externalId: expect.any(String),
        name: expect.any(String),
      });
    });

    it('carries real playtime with the library, unlike Xbox', async () => {
      // Sony sends durations in the list itself, so no per-title sweep is
      // needed to know how long anything was played.
      const games = await collect(make(stubFetch(routes)).getLibrary(session));
      expect(games.some((game) => (game.minutesPlayedTotal ?? 0) > 0)).toBe(true);
    });

    it('records a purchase as ownership, and only as DERIVED', async () => {
      // `service` is undocumented and not literal, so it supports an inference
      // about how a title arrived, never a statement of entitlement.
      const games = await collect(make(stubFetch(routes)).getLibrary(session));
      const owned = games.filter((game) => game.ownership);

      expect(owned.length).toBeGreaterThan(0);
      for (const game of owned) expect(game.confidence).toBe('DERIVED');
    });

    it('leaves a title with no acquisition signal unowned', async () => {
      const games = await collect(make(stubFetch(routes)).getLibrary(session));
      for (const game of games) {
        if (game.ownership) continue;
        expect(game.confidence).toBe('DETECTED');
      }
    });
  });

  describe('getPlayHistory', () => {
    it('emits a lifetime total carrying the dates Sony attaches', async () => {
      // The whole point of PlayStation: it knows when a game was started and
      // last touched, which makes it the only provider that can place one on
      // the timeline precisely.
      const events = await collect(
        make(stubFetch({ 'gamelist/v2': fixture('gamelist') })).getPlayHistory(session),
      );

      const totals = events.filter((event) => event.activityType === 'LIFETIME_TOTAL');
      expect(totals.length).toBeGreaterThan(0);
      expect(totals.some((event) => event.startedAt instanceof Date)).toBe(true);
      for (const event of totals) expect(event.confidence).toBe('VERIFIED');
    });
  });

  describe('getAchievements', () => {
    const routes = {
      'titles/trophyTitles': {
        titles: [
          {
            npTitleId: 'PPSA21422_00',
            trophyTitles: [{ npCommunicationId: 'NPWR42737_00', npServiceName: 'trophy2', trophyTitleName: 'UFL' }],
          },
        ],
      },
      // The user-scoped path must be matched before the public one, since the
      // public path is a substring of it.
      'users/1234567890123456789/npCommunicationIds': fixture('trophies-earned'),
      'trophy/v1/npCommunicationIds': fixture('trophies-defined'),
    };

    it('joins names to earn state across the two endpoints', async () => {
      // Neither half is usable alone: the user-scoped response carries no
      // names, and the public one carries no unlock state.
      const trophies = await collect(
        make(stubFetch(routes)).getAchievements(session, 'PPSA21422_00'),
      );

      expect(trophies.length).toBeGreaterThan(0);
      expect(trophies.some((trophy) => trophy.name !== '')).toBe(true);
      expect(trophies.some((trophy) => trophy.unlocked)).toBe(true);
    });

    it('namespaces trophy ids by game, because Sony restarts them at zero', async () => {
      // Every game numbers its trophies from 0, so a bare id would collide
      // across the library.
      const trophies = await collect(
        make(stubFetch(routes)).getAchievements(session, 'PPSA21422_00'),
      );
      for (const trophy of trophies) expect(trophy.externalId).toContain('NPWR42737_00:');
    });

    it('keeps the unlock date, which is the precisely dated signal here', async () => {
      const trophies = await collect(
        make(stubFetch(routes)).getAchievements(session, 'PPSA21422_00'),
      );
      const unlocked = trophies.filter((trophy) => trophy.unlocked);
      expect(unlocked.some((trophy) => trophy.unlockedAt instanceof Date)).toBe(true);
    });

    it('yields nothing for a game with no trophy set, rather than failing', async () => {
      const impl = stubFetch({ 'titles/trophyTitles': { titles: [{ npTitleId: 'PPSA26963_00' }] } });
      await expect(
        collect(make(impl).getAchievements(session, 'PPSA26963_00')),
      ).resolves.toEqual([]);
    });
  });
});

describe('parseIsoDuration', () => {
  it('parses the shape Sony actually sends', () => {
    // "PT76H46M7S" is a real value from the captured game list.
    expect(parseIsoDuration('PT76H46M7S')).toBe(4606);
    expect(parseIsoDuration('PT151H34M47S')).toBe(9095);
    expect(parseIsoDuration('PT20M5S')).toBe(20);
  });

  it('reports a few seconds of play as zero, not as unknown', () => {
    // "PT6S" appears in the data. The title genuinely was launched, so zero
    // is the honest answer and null would read as "never played".
    expect(parseIsoDuration('PT6S')).toBe(0);
  });

  it('handles a day component rather than silently dropping it', () => {
    expect(parseIsoDuration('P1DT2H')).toBe(1560);
  });

  it('returns null for absent or unparseable input', () => {
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration('')).toBeNull();
    expect(parseIsoDuration('76 hours')).toBeNull();
  });
});

describe('ownershipFromService', () => {
  it('reads both spellings of purchased as a digital acquisition', () => {
    // Sony sends "none_purchased" and "none(purchased)" for the same idea.
    expect(ownershipFromService('none_purchased')).toEqual({ type: 'DIGITAL' });
    expect(ownershipFromService('none(purchased)')).toEqual({ type: 'DIGITAL' });
  });

  it('treats "other" as acquired outside the store', () => {
    // Discs and pre-installed titles: confirmed against the account this was
    // built from, where every "other" title is one the user owns physically.
    expect(ownershipFromService('other')).toEqual({ type: 'PHYSICAL' });
  });

  it('claims nothing for a value it does not recognise', () => {
    expect(ownershipFromService(undefined)).toBeUndefined();
    expect(ownershipFromService('something_new')).toBeUndefined();
  });
});

describe('isGameCategory', () => {
  it('keeps games', () => {
    expect(isGameCategory('ps5_native_game')).toBe(true);
    expect(isGameCategory('ps4_game')).toBe(true);
    // Sony's own "unknown" and "not_found" are still games in the list.
    expect(isGameCategory('unknown')).toBe(true);
    expect(isGameCategory(undefined)).toBe(true);
  });

  it('drops the apps Sony lists alongside them', () => {
    // Otherwise a gaming history gains six seconds of Spotify.
    expect(isGameCategory('ps5_web_based_media_app')).toBe(false);
    expect(isGameCategory('ps4_videoservice_web_app')).toBe(false);
    expect(isGameCategory('ps4_nongame_mini_app')).toBe(false);
  });
});

describe('parsePsnDate', () => {
  it('parses the timestamps in the captured payloads', () => {
    expect(parsePsnDate('2024-12-08T14:14:43.810000Z')?.getUTCFullYear()).toBe(2024);
    expect(parsePsnDate('2025-03-27T10:33:25Z')?.getUTCFullYear()).toBe(2025);
  });

  it('returns null for missing or unparseable input', () => {
    expect(parsePsnDate(undefined)).toBeNull();
    expect(parsePsnDate('')).toBeNull();
    expect(parsePsnDate('yesterday')).toBeNull();
  });
});

describe('accountIdFromToken', () => {
  it('reads the account id out of the token payload', () => {
    expect(accountIdFromToken(fakeToken('9876543210987654321'))).toBe('9876543210987654321');
  });

  it('rejects a token that is not a JWT', () => {
    expect(() => accountIdFromToken('not-a-jwt')).toThrow(/JWT/);
  });

  it('rejects a JWT with no account in it', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
    expect(() => accountIdFromToken(`h.${payload}.s`)).toThrow(/account id/);
  });
});

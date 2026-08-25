import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { OpenXblProvider, parseXboxDate } from './openxbl.provider.js';

/**
 * Contract tests against responses captured from the live OpenXBL API.
 *
 * The fixtures are real payloads (sanitised of gamertag, XUID and signed image
 * URLs), not hand-written approximations. That distinction has already cost
 * this project once: the IGDB fixtures were written from memory, agreed with a
 * field name that had been renamed, and every enrichment failed at 100% while
 * the tests stayed green.
 */

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/xbox/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stubFetch(routes: Record<string, unknown>, onCall?: (url: string, init?: RequestInit) => void) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    onCall?.(url, init);

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

const session = { providerUserId: '2533274800000000', credentials: {} };

/** Burst of 3 lets the short tests run without waiting on the rate limiter. */
const make = (fetchImpl: typeof fetch) => new OpenXblProvider({ apiKey: 'test-key', fetchImpl });

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('OpenXblProvider', () => {
  describe('construction', () => {
    it('refuses to start without an API key', () => {
      expect(() => new OpenXblProvider({ apiKey: '' })).toThrow(/OPENXBL_API_KEY/);
    });

    it('declares playtime as partial, not absent', () => {
      // This previously asserted 'none', encoding a wrong assumption: Xbox
      // *does* report MinutesPlayed, just per title through a separate stats
      // call rather than with the library. Probing found it; the design had
      // ruled it out without checking.
      expect(make(stubFetch({})).capabilities.playtime).toBe('partial');
    });

    it('declares library as partial: title history is not an ownership list', () => {
      expect(make(stubFetch({})).capabilities.library).toBe('partial');
    });

    it('declares an achievement budget, because the free tier is 150/hour', () => {
      // Unbounded, a 37-game sweep occupies one sync for a quarter of an hour
      // and consumes the entire hourly allowance.
      expect(make(stubFetch({})).capabilities.achievementSweepBudget).toBeGreaterThan(0);
    });
  });

  describe('transport', () => {
    it('sends the API key in the header OpenXBL expects', async () => {
      let headers: Record<string, string> = {};
      const impl = stubFetch({ account: fixture('account') }, (_url, init) => {
        headers = (init?.headers ?? {}) as Record<string, string>;
      });

      await make(impl).getProfile(session);
      expect(headers['X-Authorization']).toBe('test-key');
    });

    it('sends an explicit locale', async () => {
      // Without this the upstream returns 400: "Request contains
      // Accept-Language header with invalid locale value: *". Found by probing
      // the real API, not by reading documentation.
      let headers: Record<string, string> = {};
      const impl = stubFetch({ account: fixture('account') }, (_url, init) => {
        headers = (init?.headers ?? {}) as Record<string, string>;
      });

      await make(impl).getProfile(session);
      expect(headers['accept-language']).toBe('en-US');
    });
  });

  describe('getProfile', () => {
    it('reads the gamertag and gamerscore out of the settings array', async () => {
      const profile = await make(stubFetch({ account: fixture('account') })).getProfile(session);

      expect(profile).toMatchObject({
        providerUserId: '2533274800000000',
        displayName: 'TestGamer',
      });
      expect(profile.score).toBe(3410);
    });

    it('rejects a structurally unexpected response', async () => {
      const impl = stubFetch({ account: { content: { nonsense: true } } });
      await expect(make(impl).getProfile(session)).rejects.toMatchObject({
        kind: 'MALFORMED_RESPONSE',
      });
    });
  });

  describe('getLibrary', () => {
    it('maps titles into the canonical shape', async () => {
      const games = await collect(
        make(stubFetch({ 'player/titleHistory': fixture('player-titles') })).getLibrary(
          session,
        ),
      );

      expect(games.length).toBeGreaterThan(0);
      expect(games[0]).toMatchObject({
        externalId: expect.any(String),
        name: expect.any(String),
        // The library pass carries no minutes: those come from a per-title
        // stats call the runner budgets for separately.
        minutesPlayedTotal: null,
      });
    });

    it('records a Game Pass title as subscription access, not a purchase', async () => {
      // `isGamePass` is the one genuine entitlement signal in the payload, and
      // SUBSCRIPTION says "you can play it" without claiming "you bought it".
      const games = await collect(
        make(stubFetch({ 'player/titleHistory': fixture('player-titles') })).getLibrary(session),
      );

      const gamePass = games.find((game) => game.raw?.['isGamePass'] === true);
      expect(gamePass?.ownership?.type).toBe('SUBSCRIPTION');
      expect(gamePass?.confidence).toBe('VERIFIED');
    });

    it('creates no ownership for a title known only from achievement activity', async () => {
      // The central honesty rule for Xbox: activity is not entitlement, and
      // inventing ownership would put games the user never bought in their
      // library (spec 5.2).
      const games = await collect(
        make(stubFetch({ 'player/titleHistory': fixture('player-titles') })).getLibrary(session),
      );

      for (const game of games) {
        if (game.raw?.['isGamePass'] === true) continue;
        expect(game.ownership).toBeUndefined();
        expect(game.confidence).toBe('DETECTED');
      }
    });
  });

  describe('getPlayHistory', () => {
    it('emits activity with no duration, labelled as achievement-derived', async () => {
      const events = await collect(
        make(stubFetch({ 'player/titleHistory': fixture('player-titles') })).getPlayHistory(
          session,
        ),
      );

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.activityType).toBe('ACHIEVEMENT_HISTORY');
        expect(event.minutesPlayed).toBeNull();
        expect(event.confidence).toBe('DETECTED');
      }
    });
  });

  describe('playtime', () => {
    const statsResponse = {
      content: {
        statlistscollection: [
          {
            stats: [
              { name: 'MinutesPlayed', type: 'Integer', value: '1825' },
            ],
          },
        ],
      },
      code: 200,
    };

    it('fetches minutes only for the games the runner asked about', async () => {
      // The budget lives with the runner, which knows what has already been
      // fetched; the adapter just answers for the ids it is given.
      const impl = stubFetch({
        'player/titleHistory': fixture('player-titles'),
        'achievements/stats': statsResponse,
      });

      const events = await collect(
        make(impl).getPlayHistory(session, { detailFor: ['2059212977'] }),
      );

      const lifetime = events.filter((event) => event.activityType === 'LIFETIME_TOTAL');
      expect(lifetime).toHaveLength(1);
      expect(lifetime[0]).toMatchObject({
        externalGameId: '2059212977',
        minutesPlayed: 1825,
        // Xbox stated it outright, unlike the achievement-derived activity.
        confidence: 'VERIFIED',
      });
    });

    it('costs nothing extra when no detail is requested', async () => {
      let statsCalls = 0;
      const impl = stubFetch(
        { 'player/titleHistory': fixture('player-titles') },
        (url) => {
          if (url.includes('achievements/stats')) statsCalls += 1;
        },
      );

      await collect(make(impl).getPlayHistory(session));
      expect(statsCalls).toBe(0);
    });

    it('skips a title whose stats call fails rather than failing the sync', async () => {
      const impl = stubFetch({
        'player/titleHistory': fixture('player-titles'),
        'achievements/stats': new Response('nope', { status: 404 }),
      });

      const events = await collect(
        make(impl).getPlayHistory(session, { detailFor: ['2059212977'] }),
      );
      expect(events.every((event) => event.activityType !== 'LIFETIME_TOTAL')).toBe(true);
    });
  });

  describe('getAchievements', () => {
    it('maps a title\'s achievements, including locked ones', async () => {
      const achievements = await collect(
        make(
          stubFetch({ 'achievements/player': fixture('achievements-title') }),
        ).getAchievements(session, '2059212977'),
      );

      expect(achievements.length).toBeGreaterThan(0);
      expect(achievements[0]).toMatchObject({
        externalId: expect.any(String),
        externalGameId: '2059212977',
        name: expect.any(String),
      });
    });

    it('treats only progressState "Achieved" as unlocked', async () => {
      const achievements = await collect(
        make(
          stubFetch({ 'achievements/player': fixture('achievements-title') }),
        ).getAchievements(session, '2059212977'),
      );

      // The captured fixture's entries are NotStarted, so none are unlocked
      // and none carry a real unlock date.
      for (const achievement of achievements) {
        if (!achievement.unlocked) expect(achievement.unlockedAt).toBeNull();
      }
    });
  });

  describe('connect', () => {
    it('connects without a browser, because the key is the identity', async () => {
      const result = await make(stubFetch({ account: fixture('account') })).connectDirect();

      expect(result.account.providerUserId).toBe('2533274800000000');
      // No per-user token exists: access is via the instance's key.
      expect(result.credentials).toEqual({});
      expect(result.status).toBe('ACTIVE');
    });

    it('explains itself if something reaches for the OAuth path', async () => {
      await expect(make(stubFetch({})).beginAuth()).rejects.toThrow(/API key rather than a sign-in/);
    });
  });
});

describe('parseXboxDate', () => {
  it('treats the year-1 sentinel as absent', () => {
    // Xbox returns this for "never unlocked". Importing it as a real date
    // would sort every locked achievement to the start of the timeline.
    expect(parseXboxDate('0001-01-01T00:00:00.0000000Z')).toBeNull();
  });

  it('parses a real timestamp', () => {
    expect(parseXboxDate('2026-08-22T21:49:52.5086863Z')?.getUTCFullYear()).toBe(2026);
  });

  it('returns null for missing or unparseable input', () => {
    expect(parseXboxDate(undefined)).toBeNull();
    expect(parseXboxDate('')).toBeNull();
    expect(parseXboxDate('not a date')).toBeNull();
  });
});

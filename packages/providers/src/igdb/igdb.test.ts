import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  IGDB_CATEGORY_TO_PROVIDER,
  IGDB_EXTERNAL_CATEGORY,
  IgdbClient,
  externalGameSource,
  igdbImageUrl,
} from './igdb.client.js';

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/igdb/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Records every request so auth headers and query bodies can be asserted. */
function stubFetch(routes: Record<string, unknown>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

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

  return { impl, calls };
}

const config = { clientId: 'test-client', clientSecret: 'test-secret' };

describe('IgdbClient', () => {
  describe('authentication', () => {
    it('obtains a Twitch token before its first query', async () => {
      const { impl, calls } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('games'),
      });
      const client = new IgdbClient({ ...config, fetchImpl: impl });

      await client.getGamesByIds([1877]);

      expect(calls[0]?.url).toContain('id.twitch.tv/oauth2/token');
      expect(calls[0]?.url).toContain('grant_type=client_credentials');
    });

    it('sends the Client-ID and bearer token IGDB requires', async () => {
      const { impl, calls } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('games'),
      });
      await new IgdbClient({ ...config, fetchImpl: impl }).getGamesByIds([1877]);

      const query = calls.find((call) => call.url.includes('api.igdb.com'));
      const headers = query?.init?.headers as Record<string, string>;
      expect(headers['Client-ID']).toBe('test-client');
      expect(headers['authorization']).toBe('Bearer test-twitch-token');
    });

    it('reuses a cached token rather than re-authenticating per query', async () => {
      // The token lasts ~60 days; fetching one per request would be both
      // wasteful and a good way to get rate-limited by Twitch.
      const { impl, calls } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('games'),
      });
      const client = new IgdbClient({ ...config, fetchImpl: impl });

      await client.getGamesByIds([1877]);
      await client.getGamesByIds([119133]);
      await client.searchGames('Elden Ring');

      expect(calls.filter((call) => call.url.includes('id.twitch.tv'))).toHaveLength(1);
    });

    it('fetches only one token when several queries race', async () => {
      const { impl, calls } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('games'),
      });
      const client = new IgdbClient({ ...config, fetchImpl: impl });

      await Promise.all([
        client.getGamesByIds([1]),
        client.getGamesByIds([2]),
        client.getGamesByIds([3]),
      ]);

      expect(calls.filter((call) => call.url.includes('id.twitch.tv'))).toHaveLength(1);
    });

    it('reports a rejected credential as an auth failure', async () => {
      const { impl } = stubFetch({
        'id.twitch.tv': new Response('bad client', { status: 403 }),
      });
      await expect(
        new IgdbClient({ ...config, fetchImpl: impl }).getGamesByIds([1]),
      ).rejects.toMatchObject({ kind: 'AUTH_INVALID' });
    });
  });

  describe('queries', () => {
    it('batches ids into a single request', async () => {
      // One request per game would exhaust the 4/sec budget instantly.
      const { impl, calls } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('games'),
      });
      await new IgdbClient({ ...config, fetchImpl: impl }).getGamesByIds([1877, 119133]);

      const queries = calls.filter((call) => call.url.includes('api.igdb.com'));
      expect(queries).toHaveLength(1);
      expect(String(queries[0]?.init?.body)).toContain('where id = (1877,119133)');
    });

    it('returns immediately for an empty id list', async () => {
      const { impl, calls } = stubFetch({ 'id.twitch.tv': fixture('token') });
      await expect(
        new IgdbClient({ ...config, fetchImpl: impl }).getGamesByIds([]),
      ).resolves.toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('looks up games by store id, which is the level-2 match', async () => {
      const { impl, calls } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('games'),
      });
      await new IgdbClient({ ...config, fetchImpl: impl }).getGamesByExternalIds(
        IGDB_EXTERNAL_CATEGORY.STEAM,
        ['1091500'],
      );

      const body = String(calls.find((c) => c.url.includes('api.igdb.com'))?.init?.body);
      expect(body).toContain('external_games.external_game_source = 1');
      expect(body).toContain('external_games.uid = ("1091500")');
    });

    it('strips quotes from a title so a search cannot break the query', async () => {
      const { impl, calls } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('games'),
      });
      await new IgdbClient({ ...config, fetchImpl: impl }).searchGames('Rock "n" Roll');

      const body = String(calls.find((c) => c.url.includes('api.igdb.com'))?.init?.body);
      expect(body).toContain('search "Rock n Roll"');
    });

    it('parses the fields the canonical model stores', async () => {
      const { impl } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('games'),
      });
      const [game] = await new IgdbClient({ ...config, fetchImpl: impl }).getGamesByIds([1877]);

      expect(game).toMatchObject({ id: 1877, name: 'Cyberpunk 2077' });
      expect(game?.genres?.map((genre) => genre.name)).toContain('Shooter');
      expect(game?.involved_companies?.find((c) => c.developer)?.company.name).toBe(
        'CD Projekt RED',
      );

      // Compared against the fixture rather than a literal: cover ids are
      // IGDB's to change, and pinning one here would fail for a reason that
      // says nothing about our parsing.
      const expected = (fixture('games') as Array<{ id: number; cover?: { image_id: string } }>)
        .find((entry) => entry.id === 1877)?.cover?.image_id;
      expect(game?.cover?.image_id).toBe(expected);
    });

    it('rejects a structurally unexpected response', async () => {
      const { impl } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': { unexpected: true },
      });
      await expect(
        new IgdbClient({ ...config, fetchImpl: impl }).getGamesByIds([1]),
      ).rejects.toMatchObject({ kind: 'MALFORMED_RESPONSE' });
    });

    it('parses the platform list', async () => {
      const { impl } = stubFetch({
        'id.twitch.tv': fixture('token'),
        'api.igdb.com': fixture('platforms'),
      });
      const platforms = await new IgdbClient({ ...config, fetchImpl: impl }).getPlatforms();

      expect(platforms).toHaveLength(3);
      expect(platforms[1]).toMatchObject({ id: 48, slug: 'ps4--1' });
    });
  });

  describe('store id mappings', () => {
    it('maps IGDB sources onto OMNIPLAY provider ids', () => {
      // These carry every other store a game is on, so connecting Xbox after
      // Steam resolves at level 1 with no extra requests.
      expect(IGDB_CATEGORY_TO_PROVIDER[IGDB_EXTERNAL_CATEGORY.STEAM]).toBe('steam');
      expect(IGDB_CATEGORY_TO_PROVIDER[IGDB_EXTERNAL_CATEGORY.PLAYSTATION_STORE]).toBe('psn');
    });

    it('does not map Xbox Marketplace, which is a different id space', () => {
      // It supplies Microsoft Store product ids while the Xbox APIs use
      // numeric titleIds. Mapping it created 16 identities that no Xbox sync
      // could match — dead rows that looked like working resolution.
      expect(IGDB_CATEGORY_TO_PROVIDER[IGDB_EXTERNAL_CATEGORY.XBOX_MARKETPLACE]).toBeUndefined();
    });

    it('uses the verified source ids, not the ones that look plausible', () => {
      // Checked against IGDB's /external_game_sources endpoint. 11 is
      // "Microsoft", which is a different thing and was wrong here before.
      expect(IGDB_EXTERNAL_CATEGORY.XBOX_MARKETPLACE).toBe(31);
      expect(IGDB_EXTERNAL_CATEGORY.STEAM).toBe(1);
    });

    describe('externalGameSource', () => {
      it('reads the current field name', () => {
        expect(externalGameSource({ external_game_source: 1 })).toBe(1);
      });

      it('still reads the legacy field, so older payloads keep working', () => {
        // IGDB renamed `category` to `external_game_source`. Rejecting the old
        // shape would break replay of anything captured before the rename.
        expect(externalGameSource({ category: 36 })).toBe(36);
      });

      it('prefers the current field when a payload somehow carries both', () => {
        expect(externalGameSource({ external_game_source: 1, category: 99 })).toBe(1);
      });

      it('returns undefined when neither is present', () => {
        // Real responses do omit it; a missing store mapping must be skipped,
        // never allowed to fail the whole game.
        expect(externalGameSource({})).toBeUndefined();
      });
    });
  });

  describe('live response shape', () => {
    it('parses a response captured from the real IGDB API', () => {
      // This fixture is a verbatim capture, not hand-written. The previous
      // hand-written one asserted `external_games.category`, a field IGDB had
      // already removed — so every real enrichment failed while the tests
      // stayed green.
      const games = fixture('games') as Array<Record<string, unknown>>;
      const externals = games.flatMap(
        (game) => (game['external_games'] as Array<Record<string, unknown>>) ?? [],
      );

      expect(externals.length).toBeGreaterThan(0);
      expect(externals.some((e) => 'external_game_source' in e)).toBe(true);
      expect(externals.every((e) => 'category' in e)).toBe(false);
    });
  });
});

describe('igdbImageUrl', () => {
  it('builds a sized CDN url', () => {
    expect(igdbImageUrl('co2mjs')).toBe(
      'https://images.igdb.com/igdb/image/upload/t_cover_big/co2mjs.jpg',
    );
    expect(igdbImageUrl('ar8xk', '1080p')).toContain('t_1080p');
  });
});

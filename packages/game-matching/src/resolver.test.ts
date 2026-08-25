import { describe, expect, it } from 'vitest';
import { normalizeTitle } from './normalize.js';
import {
  DEFAULT_THRESHOLDS,
  resolveGame,
  type GameCandidate,
  type ResolverPort,
} from './resolver.js';

/** Builds a candidate the way the database layer would. */
function candidate(id: string, name: string, releaseYear?: number): GameCandidate {
  const n = normalizeTitle(name);
  return {
    id,
    name,
    normalizedName: n.normalized,
    versionMarkers: n.versionMarkers,
    firstReleaseDate: releaseYear ? new Date(Date.UTC(releaseYear, 0, 1)) : null,
  };
}

/** In-memory ResolverPort over a fixed catalogue. */
function portFor(
  catalogue: GameCandidate[],
  overrides: Partial<ResolverPort> = {},
): ResolverPort {
  return {
    findByExternalId: async () => null,
    findByNormalizedName: async (normalized) =>
      catalogue.filter((c) => c.normalizedName === normalized),
    searchCandidates: async (_normalized, limit) => catalogue.slice(0, limit),
    ...overrides,
  };
}

const steamInput = (name: string, externalId = '1', releaseDate?: Date) => ({
  provider: 'steam',
  externalId,
  name,
  releaseDate: releaseDate ?? null,
});

describe('resolveGame', () => {
  describe('level 1 - exact external id', () => {
    it('short-circuits on a known mapping without consulting names', () => {
      // A pre-existing mapping is authoritative even if the name has drifted.
      return resolveGame(
        steamInput('Totally Different Name', '1091500'),
        portFor([], {
          findByExternalId: async (provider, externalId) =>
            provider === 'steam' && externalId === '1091500' ? 'game-481' : null,
          findByNormalizedName: async () => {
            throw new Error('should not reach level 3');
          },
        }),
      ).then((result) => {
        expect(result).toMatchObject({
          gameId: 'game-481',
          method: 'external_id',
          confidence: 'VERIFIED',
          score: 1,
        });
      });
    });
  });

  describe('level 2 - metadata mapping', () => {
    it('accepts a mapping supplied by the metadata layer', async () => {
      const result = await resolveGame(
        steamInput('Cyberpunk 2077', '1091500'),
        portFor([], { findByMetadataMapping: async () => 'game-igdb' }),
      );
      expect(result.gameId).toBe('game-igdb');
      expect(result.method).toBe('metadata_mapping');
    });
  });

  describe('level 3 - exact normalised name', () => {
    it('matches across trademark and edition differences', async () => {
      const result = await resolveGame(
        steamInput('Cyberpunk 2077™ - Deluxe Edition'),
        portFor([candidate('g1', 'Cyberpunk 2077')]),
      );
      expect(result.gameId).toBe('g1');
      expect(result.method).toBe('exact_name');
      expect(result.confidence).toBe('DERIVED');
    });

    it('defers when a title is reused and no year disambiguates it', async () => {
      // "Prey" is a real collision: 2006 and 2017 are unrelated games.
      const result = await resolveGame(
        steamInput('Prey'),
        portFor([candidate('prey-2006', 'Prey', 2006), candidate('prey-2017', 'Prey', 2017)]),
      );
      expect(result.gameId).toBeNull();
      expect(result.method).toBe('unresolved');
      expect(result.candidates).toHaveLength(2);
    });

    it('uses release year to break a name collision when it can', async () => {
      const result = await resolveGame(
        steamInput('Prey', '1', new Date(Date.UTC(2017, 4, 5))),
        portFor([candidate('prey-2006', 'Prey', 2006), candidate('prey-2017', 'Prey', 2017)]),
      );
      expect(result.gameId).toBe('prey-2017');
      expect(result.method).toBe('exact_name');
    });
  });

  describe('level 4 - fuzzy matching', () => {
    it('accepts a high-confidence fuzzy match with a clear winner', async () => {
      const result = await resolveGame(
        steamInput('The Witcher 3 Wild Hunt'),
        portFor([candidate('w3', 'The Witcher 3: Wild Hunt'), candidate('other', 'Stardew Valley')]),
      );
      expect(result.gameId).toBe('w3');
      expect(result.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.autoAccept);
    });

    it('refuses to merge across version markers however similar the strings', async () => {
      // One token apart and scoring very highly, but they are two products.
      const result = await resolveGame(
        steamInput('Resident Evil 4 Remake'),
        portFor([candidate('re4', 'Resident Evil 4')]),
      );
      expect(result.gameId).toBeNull();
      expect(result.method).toBe('unresolved');
      // The incompatible candidate is not even offered as an option.
      expect(result.candidates).toHaveLength(0);
    });

    it('defers when the top two candidates are near-tied', async () => {
      const result = await resolveGame(
        steamInput('FIFA 21'),
        portFor([candidate('a', 'FIFA 22'), candidate('b', 'FIFA 23')]),
      );
      expect(result.gameId).toBeNull();
      expect(result.method).toBe('unresolved');
    });

    it('discards candidates below the similarity floor', async () => {
      const result = await resolveGame(
        steamInput('Elden Ring'),
        portFor([candidate('x', 'Microsoft Flight Simulator')]),
      );
      expect(result.gameId).toBeNull();
      expect(result.candidates).toHaveLength(0);
    });
  });

  describe('level 5 - unresolved', () => {
    it('returns ranked candidates for the admin mapping screen', async () => {
      const result = await resolveGame(
        steamInput('Game X Deluxe'),
        portFor([candidate('a', 'Game X'), candidate('b', 'Game Y')]),
      );
      expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(
        result.candidates[1]?.score ?? 0,
      );
    });

    it('gives up cleanly on a title that normalises to nothing', async () => {
      const result = await resolveGame(steamInput('™®'), portFor([candidate('a', 'Anything')]));
      expect(result.gameId).toBeNull();
      expect(result.method).toBe('unresolved');
      expect(result.confidence).toBe('UNCERTAIN');
    });
  });
});

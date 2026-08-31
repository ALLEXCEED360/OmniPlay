import { describe, expect, it } from 'vitest';
import { libraryOrderBy, sortByLastPlayed } from './library.service.js';

/**
 * Three of the library's four sorts returned an order the reader could not
 * distinguish from random, for three different reasons. These pin each one.
 *
 * The symptom was identical in every case — "it gives results in random
 * order" — which is worth remembering: an ordering bug does not announce
 * which layer it lives in.
 */
describe('libraryOrderBy', () => {
  describe('descending sorts put unknowns last', () => {
    // Postgres defaults to NULLS FIRST on DESC. With 17 unrated and 7 undated
    // titles in a 233-game library, the first screen of "highest rated" was
    // entirely games with no rating, in planner order.
    it('sorts unrated games to the end, not the front', () => {
      expect(libraryOrderBy('rating')[0]).toEqual({
        aggregatedRating: { sort: 'desc', nulls: 'last' },
      });
    });

    it('sorts undated games to the end, not the front', () => {
      expect(libraryOrderBy('release')[0]).toEqual({
        firstReleaseDate: { sort: 'desc', nulls: 'last' },
      });
    });
  });

  // `rating` is IGDB's user score; `aggregatedRating` is its aggregate of
  // external critic scores. The UI offered one label over the other column.
  it('ranks by the critic score, not the user score', () => {
    const [first] = libraryOrderBy('rating');
    expect(first).toHaveProperty('aggregatedRating');
    expect(first).not.toHaveProperty('rating');
  });

  describe('stability', () => {
    // Without a tiebreak, two games sharing a rating can swap between
    // requests, which makes one repeat on page two and another vanish.
    it('breaks ties by name so paging cannot repeat or drop a game', () => {
      for (const sort of ['rating', 'release']) {
        expect(libraryOrderBy(sort).at(-1)).toEqual({ name: 'asc' });
      }
    });
  });

  it('falls back to name for an unknown or absent sort', () => {
    expect(libraryOrderBy(undefined)).toEqual([{ name: 'asc' }]);
    expect(libraryOrderBy('nonsense')).toEqual([{ name: 'asc' }]);
  });

  // 'recent' is resolved by sortByLastPlayed, not by SQL, so asking Postgres
  // for it must not silently produce some other order.
  it('does not claim to handle the recently-played sort', () => {
    expect(libraryOrderBy('recent')).toEqual([{ name: 'asc' }]);
  });
});

describe('sortByLastPlayed', () => {
  const games = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Bravo' },
    { id: 'c', name: 'Charlie' },
  ];
  const at = (iso: string) => new Date(iso).getTime();

  it('puts the most recently played first', () => {
    const played = new Map([
      ['a', at('2026-01-01')],
      ['b', at('2026-06-01')],
      ['c', at('2026-03-01')],
    ]);
    expect(sortByLastPlayed(games, played).map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });

  describe('games nobody has played', () => {
    // The old sort used Game.updatedAt, which every sync rewrites, so never
    // having played something still gave it a fresh timestamp and floated it
    // to the top. Not a recency.
    it('sorts them last rather than first', () => {
      const played = new Map([['c', at('2026-03-01')]]);
      expect(sortByLastPlayed(games, played).map((g) => g.id)).toEqual(['c', 'a', 'b']);
    });

    it('orders the undated tail by name so paging is stable', () => {
      const shuffled = [
        { id: 'c', name: 'Charlie' },
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Bravo' },
      ];
      expect(sortByLastPlayed(shuffled, new Map()).map((g) => g.name)).toEqual([
        'Alpha',
        'Bravo',
        'Charlie',
      ]);
    });
  });

  it('breaks equal timestamps by name', () => {
    const same = at('2026-05-05');
    const played = new Map([
      ['a', same],
      ['b', same],
      ['c', same],
    ]);
    expect(sortByLastPlayed(games, played).map((g) => g.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });

  it('leaves the caller’s array alone', () => {
    const input = [...games];
    sortByLastPlayed(input, new Map([['c', at('2026-03-01')]]));
    expect(input.map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { criticRatingFor, PORT, type IgdbGame } from './igdb.client.js';

/**
 * Which critic score a game gets, and — more importantly — which it does not.
 *
 * IGDB attaches critic reception to the parent entry, so a port carries none
 * of its own. That is why BioShock, Bayonetta and Batman: Arkham Origins all
 * arrived in the library looking unreviewed while their parents held 93, 91
 * and 71.
 *
 * The restriction to ports is the whole design. A remaster is a different
 * product with its own reception, and lending it the original's number would
 * be a quiet lie about how it was received.
 */

const game = (over: Partial<IgdbGame> = {}): IgdbGame =>
  ({ id: 1, name: 'A Game', ...over }) as IgdbGame;

/** A client that answers with one parent, and counts how often it is asked. */
const clientWith = (parent: Partial<IgdbGame> | null) => {
  const getGamesByIds = vi.fn(async () => (parent ? [game(parent)] : []));
  return { client: { getGamesByIds }, getGamesByIds };
};

describe('criticRatingFor', () => {
  describe('a score of its own', () => {
    it('is used as-is', async () => {
      const { client, getGamesByIds } = clientWith({ aggregated_rating: 88 });

      await expect(
        criticRatingFor(client, game({ aggregated_rating: 88, aggregated_rating_count: 9 })),
      ).resolves.toEqual({ rating: 88, count: 9 });
      // No parent lookup: a re-run over an enriched library must cost nothing.
      expect(getGamesByIds).not.toHaveBeenCalled();
    });

    it('is preferred over the parent even when both exist', async () => {
      const { client } = clientWith({ aggregated_rating: 93, aggregated_rating_count: 8 });
      const port = game({
        game_type: PORT,
        parent_game: 20,
        aggregated_rating: 79,
        aggregated_rating_count: 5,
      });

      await expect(criticRatingFor(client, port)).resolves.toEqual({ rating: 79, count: 5 });
    });

    // A genuine zero is a review outcome, not an absence, and `?? ` would
    // have thrown it away.
    it('keeps a score of zero', async () => {
      const { client, getGamesByIds } = clientWith({ aggregated_rating: 50 });

      await expect(
        criticRatingFor(client, game({ aggregated_rating: 0, aggregated_rating_count: 6 })),
      ).resolves.toEqual({ rating: 0, count: 6 });
      expect(getGamesByIds).not.toHaveBeenCalled();
    });
  });

  describe('a port with no score', () => {
    it('takes the parent’s', async () => {
      const { client, getGamesByIds } = clientWith({
        aggregated_rating: 93,
        aggregated_rating_count: 8,
      });
      const bioshock = game({ name: 'BioShock', game_type: PORT, parent_game: 20 });

      // The parent's review count travels with the parent's score: the port
      // has none of its own, which is the whole reason we followed the link.
      await expect(criticRatingFor(client, bioshock)).resolves.toEqual({ rating: 93, count: 8 });
      expect(getGamesByIds).toHaveBeenCalledWith([20]);
    });

    it('reports nothing when the parent has none either', async () => {
      const { client } = clientWith({});
      const port = game({ game_type: PORT, parent_game: 20 });

      await expect(criticRatingFor(client, port)).resolves.toBeUndefined();
    });

    it('reports nothing when the parent cannot be fetched', async () => {
      const { client } = clientWith(null);
      const port = game({ game_type: PORT, parent_game: 20 });

      await expect(criticRatingFor(client, port)).resolves.toBeUndefined();
    });

    // A failed lookup must not fail the enrichment around it: a missing score
    // is a gap, a thrown error loses the whole game's metadata.
    it('survives the lookup throwing', async () => {
      const client = {
        getGamesByIds: vi.fn(async () => {
          throw new Error('IGDB is down');
        }),
      };

      await expect(
        criticRatingFor(client, game({ game_type: PORT, parent_game: 20 })),
      ).resolves.toBeUndefined();
    });
  });

  describe('everything that is not a port', () => {
    // The cases that must stay blank. Metro 2033 Redux is not Metro 2033, and
    // a remaster scoring differently from its original is normal rather than
    // an error to paper over.
    const derived = [
      ['remake', 8],
      ['remaster', 9],
      ['expanded_game', 10],
      ['fork', 12],
      ['main_game', 0],
      ['dlc', 1],
      ['bundle', 3],
      ['mod', 5],
    ] as const;

    it.each(derived)('does not inherit for %s', async (_label, type) => {
      const { client, getGamesByIds } = clientWith({ aggregated_rating: 87 });

      await expect(
        criticRatingFor(client, game({ game_type: type, parent_game: 495 })),
      ).resolves.toBeUndefined();
      expect(getGamesByIds).not.toHaveBeenCalled();
    });

    it('does not inherit for a port with no parent recorded', async () => {
      const { client, getGamesByIds } = clientWith({ aggregated_rating: 87 });

      await expect(criticRatingFor(client, game({ game_type: PORT }))).resolves.toBeUndefined();
      expect(getGamesByIds).not.toHaveBeenCalled();
    });
  });
});

import { describe, expect, it } from 'vitest';
import { resolveGameStatus } from './status.js';

/**
 * Status has to mean the same thing on a card, on the game page and in the
 * library filter.
 *
 * Before this, every status but "backlog" required a UserGameStatus row, and
 * one is only written when the user sets it by hand. With no rows at all the
 * Completed filter matched nothing, and a 100%-complete 35-hour playthrough of
 * Expedition 33 was labelled Backlog.
 */
describe('resolveGameStatus', () => {
  const played = { allAchievementsUnlocked: false, hasPlaytime: true };

  describe('a status the user set', () => {
    it('wins over anything inferred', () => {
      // The user is a better authority on whether they finished a game than
      // its achievement list is - someone may abandon a game at 100%.
      expect(
        resolveGameStatus({ declared: 'ABANDONED', allAchievementsUnlocked: true, hasPlaytime: true }),
      ).toEqual({ status: 'ABANDONED', derived: false });
    });

    it('is marked as not derived, so the UI can say who decided', () => {
      expect(resolveGameStatus({ declared: 'PLAYING', ...played }).derived).toBe(false);
    });
  });

  describe('with nothing declared', () => {
    it('calls a fully unlocked game completed', () => {
      expect(
        resolveGameStatus({ allAchievementsUnlocked: true, hasPlaytime: true }),
      ).toEqual({ status: 'COMPLETED', derived: true });
    });

    it('calls a played game playing, never completed', () => {
      // Hours alone say started. Treating them as finishing would mark most of
      // a library complete on the strength of an hour's play.
      expect(resolveGameStatus(played)).toEqual({ status: 'PLAYING', derived: true });
    });

    it('calls an untouched game backlog', () => {
      expect(
        resolveGameStatus({ allAchievementsUnlocked: false, hasPlaytime: false }),
      ).toEqual({ status: 'NOT_STARTED', derived: true });
    });

    it('completes a game whose achievements are all unlocked without playtime', () => {
      // Xbox reports hours only for titles that answer a separate stats call,
      // so a genuinely finished game can have none recorded.
      expect(
        resolveGameStatus({ allAchievementsUnlocked: true, hasPlaytime: false }).status,
      ).toBe('COMPLETED');
    });

    it('never infers abandonment', () => {
      // Nothing in the data separates "gave up" from "have not gone back yet",
      // so it stays something only the user can say.
      const statuses = [
        resolveGameStatus({ allAchievementsUnlocked: true, hasPlaytime: true }).status,
        resolveGameStatus(played).status,
        resolveGameStatus({ allAchievementsUnlocked: false, hasPlaytime: false }).status,
      ];
      expect(statuses).not.toContain('ABANDONED');
    });
  });

  it('treats an empty declared value as undeclared rather than as a status', () => {
    expect(resolveGameStatus({ declared: '', ...played }).status).toBe('PLAYING');
    expect(resolveGameStatus({ declared: null, ...played }).derived).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  aggregatePlaytime,
  computeLibraryStats,
  formatPlaytime,
  playtimeByYear,
  type ActivityRecord,
} from './playtime.js';

const activity = (over: Partial<ActivityRecord>): ActivityRecord => ({
  gameId: 'g1',
  provider: 'steam',
  activityType: 'LIFETIME_TOTAL',
  minutesPlayed: 60,
  startedAt: null,
  endedAt: null,
  confidence: 'VERIFIED',
  ...over,
});

describe('aggregatePlaytime', () => {
  it('sums a single provider total', () => {
    expect(aggregatePlaytime([activity({ minutesPlayed: 120 })]).totalMinutes).toBe(120);
  });

  it('does not inflate a lifetime total across repeated syncs', () => {
    // The core hazard: three syncs observing the same Steam figure, plus one
    // where playtime had grown. The answer is 300, not 900.
    const records = [
      activity({ minutesPlayed: 240 }),
      activity({ minutesPlayed: 240 }),
      activity({ minutesPlayed: 300 }),
    ];
    expect(aggregatePlaytime(records).totalMinutes).toBe(300);
  });

  it('adds the same game across two providers, which are separate playthroughs', () => {
    const records = [
      activity({ gameId: 'elden-ring', provider: 'steam', minutesPlayed: 10920 }),
      activity({ gameId: 'elden-ring', provider: 'psn', minutesPlayed: 3900 }),
    ];
    const result = aggregatePlaytime(records);

    expect(result.totalMinutes).toBe(14820);
    expect(result.byGame['elden-ring']).toBe(14820);
    expect(result.byProvider['steam']).toBe(10920);
    expect(result.byProvider['psn']).toBe(3900);
  });

  it('sums discrete sessions, which are real events', () => {
    const records = [
      activity({ activityType: 'SESSION', minutesPlayed: 30 }),
      activity({ activityType: 'SESSION', minutesPlayed: 45 }),
    ];
    expect(aggregatePlaytime(records).totalMinutes).toBe(75);
  });

  it('prefers the lifetime total over sessions from the same provider', () => {
    // Counting both would double the same hours.
    const records = [
      activity({ minutesPlayed: 500 }),
      activity({ activityType: 'SESSION', minutesPlayed: 60 }),
    ];
    expect(aggregatePlaytime(records).totalMinutes).toBe(500);
  });

  it('ignores the two-week window, which the lifetime total already contains', () => {
    const records = [
      activity({ minutesPlayed: 1000 }),
      activity({ activityType: 'RECENT_PLAY', minutesPlayed: 340 }),
    ];
    expect(aggregatePlaytime(records).totalMinutes).toBe(1000);
  });

  it('ignores Xbox achievement history, which carries no duration', () => {
    const records = [
      activity({ activityType: 'ACHIEVEMENT_HISTORY', provider: 'xbox', minutesPlayed: null }),
    ];
    expect(aggregatePlaytime(records).totalMinutes).toBe(0);
  });

  it('handles an empty history', () => {
    expect(aggregatePlaytime([])).toEqual({ totalMinutes: 0, byProvider: {}, byGame: {} });
  });
});

describe('playtimeByYear', () => {
  it('attributes sessions to their calendar year', () => {
    const records = [
      activity({
        activityType: 'SESSION',
        minutesPlayed: 100,
        startedAt: new Date('2024-03-01T00:00:00Z'),
      }),
      activity({
        activityType: 'SESSION',
        minutesPlayed: 50,
        startedAt: new Date('2026-01-15T00:00:00Z'),
      }),
    ];
    const result = playtimeByYear(records);

    expect(result.byYear[2024]).toBe(100);
    expect(result.byYear[2026]).toBe(50);
    expect(result.unattributedMinutes).toBe(0);
  });

  it('refuses to invent a year for a lifetime total', () => {
    // Steam says "247 hours", never "247 hours during 2022". Guessing would
    // fabricate the yearly chart.
    const result = playtimeByYear([activity({ minutesPlayed: 14820 })]);

    expect(result.byYear).toEqual({});
    expect(result.unattributedMinutes).toBe(14820);
  });

  it('does not inflate unattributed time across repeated observations', () => {
    const result = playtimeByYear([
      activity({ minutesPlayed: 200 }),
      activity({ minutesPlayed: 200 }),
    ]);
    expect(result.unattributedMinutes).toBe(200);
  });

  describe('consistency with the overall total', () => {
    it('does not double-count a provider that reports the same hours twice', () => {
      // A file import writes BOTH a lifetime total and a dated USER_DECLARED
      // row for one game. Counting them separately reported more unattributed
      // time than the user had played in total — visibly nonsense on the
      // statistics page.
      const records = [
        activity({ provider: 'psn', activityType: 'LIFETIME_TOTAL', minutesPlayed: 3750 }),
        activity({
          provider: 'psn',
          activityType: 'USER_DECLARED',
          minutesPlayed: 3750,
          endedAt: new Date('2015-06-01T00:00:00Z'),
        }),
      ];

      const yearly = playtimeByYear(records);
      const total = aggregatePlaytime(records).totalMinutes;

      expect(total).toBe(3750);
      expect(yearly.byYear[2015]).toBe(3750);
      expect(yearly.unattributedMinutes).toBe(0);
    });

    it('attributes only the dated portion and leaves the rest unattributed', () => {
      // Steam knows 500 minutes total; only 120 of them can be placed in time.
      const records = [
        activity({ activityType: 'LIFETIME_TOTAL', minutesPlayed: 500 }),
        activity({
          activityType: 'SESSION',
          minutesPlayed: 120,
          startedAt: new Date('2024-05-01T00:00:00Z'),
        }),
      ];

      const yearly = playtimeByYear(records);
      expect(yearly.byYear[2024]).toBe(120);
      expect(yearly.unattributedMinutes).toBe(380);
    });

    it('never reports more unattributed time than exists in total', () => {
      const records = [
        activity({ gameId: 'a', provider: 'steam', minutesPlayed: 600 }),
        activity({ gameId: 'a', provider: 'psn', minutesPlayed: 200 }),
        activity({
          gameId: 'a',
          provider: 'psn',
          activityType: 'USER_DECLARED',
          minutesPlayed: 200,
          endedAt: new Date('2020-01-01T00:00:00Z'),
        }),
        activity({
          gameId: 'b',
          activityType: 'SESSION',
          minutesPlayed: 45,
          startedAt: new Date('2026-02-02T00:00:00Z'),
        }),
      ];

      const yearly = playtimeByYear(records);
      const dated = Object.values(yearly.byYear).reduce((sum, m) => sum + m, 0);

      // The invariant that was broken: dated + unattributed === the total.
      expect(dated + yearly.unattributedMinutes).toBe(aggregatePlaytime(records).totalMinutes);
    });

    it('does not go negative when dated events exceed a stale lifetime total', () => {
      const records = [
        activity({ activityType: 'LIFETIME_TOTAL', minutesPlayed: 100 }),
        activity({
          activityType: 'SESSION',
          minutesPlayed: 300,
          startedAt: new Date('2025-01-01T00:00:00Z'),
        }),
      ];
      expect(playtimeByYear(records).unattributedMinutes).toBe(0);
    });
  });
});

describe('computeLibraryStats', () => {
  it('counts owned, previously owned and backlog separately', () => {
    const stats = computeLibraryStats({
      ownerships: [
        { gameId: 'a', provider: 'steam', removedAt: null },
        { gameId: 'b', provider: 'steam', removedAt: null },
        { gameId: 'c', provider: 'xbox', removedAt: new Date('2024-01-01') },
      ],
      statuses: [],
      playtimeByGame: { a: 500 },
    });

    expect(stats.currentlyOwned).toBe(2);
    expect(stats.previouslyOwned).toBe(1);
    expect(stats.totalGames).toBe(3);
    // b was never played and c was dropped unplayed.
    expect(stats.backlog).toBe(2);
  });

  it('treats a reacquired game as currently owned', () => {
    const stats = computeLibraryStats({
      ownerships: [
        { gameId: 'a', provider: 'steam', removedAt: new Date('2023-01-01') },
        { gameId: 'a', provider: 'xbox', removedAt: null },
      ],
      statuses: [],
      playtimeByGame: {},
    });

    expect(stats.currentlyOwned).toBe(1);
    expect(stats.previouslyOwned).toBe(0);
    expect(stats.totalGames).toBe(1);
  });

  it('counts a game as played on evidence of time or a user status', () => {
    const stats = computeLibraryStats({
      ownerships: [
        { gameId: 'a', provider: 'steam', removedAt: null },
        { gameId: 'b', provider: 'steam', removedAt: null },
        { gameId: 'c', provider: 'steam', removedAt: null },
      ],
      statuses: [{ gameId: 'b', status: 'COMPLETED' }],
      playtimeByGame: { a: 10 },
    });

    expect(stats.gamesPlayed).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.backlog).toBe(1);
  });

  it('denominates completion rate on started games, not the whole library', () => {
    // A 100-game bundle haul must not make one completion look like 1%.
    const ownerships = Array.from({ length: 100 }, (_, i) => ({
      gameId: `g${i}`,
      provider: 'steam',
      removedAt: null,
    }));
    const stats = computeLibraryStats({
      ownerships,
      statuses: [
        { gameId: 'g0', status: 'COMPLETED' },
        { gameId: 'g1', status: 'PLAYING' },
      ],
      playtimeByGame: { g0: 600, g1: 120 },
    });

    expect(stats.gamesPlayed).toBe(2);
    expect(stats.completionRate).toBe(0.5);
  });

  it('reports a zero completion rate rather than NaN for an untouched library', () => {
    const stats = computeLibraryStats({
      ownerships: [{ gameId: 'a', provider: 'steam', removedAt: null }],
      statuses: [],
      playtimeByGame: {},
    });
    expect(stats.completionRate).toBe(0);
  });
});

describe('formatPlaytime', () => {
  it.each([
    [0, '0h'],
    [-5, '0h'],
    [45, '45m'],
    [90, '1.5h'],
    [247 * 60, '247h'],
  ])('formats %i minutes as %s', (minutes, expected) => {
    expect(formatPlaytime(minutes)).toBe(expected);
  });
});

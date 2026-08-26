import { describe, expect, it } from 'vitest';
import {
  dayKeyToDate,
  groupByDay,
  intensityOf,
  localDayKey,
  monthColumns,
  weeksOfYear,
  type TimelineEntry,
} from './timeline';

/**
 * Day handling for the timeline calendar.
 *
 * Timezones have caused two separate bugs on this page already: grouping by
 * UTC day while displaying the local one made a single evening appear twice,
 * and passing a bare "YYYY-MM-DD" to `formatDate` labelled every cell with the
 * previous day for anyone west of Greenwich, because a date-only string parses
 * as UTC midnight and then renders locally. Both are pinned here.
 */

function entry(date: string, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    date,
    provider: 'psn',
    game: { name: 'A Game', slug: 'a-game', coverImage: null },
    played: false,
    achievements: 0,
    acquired: false,
    completed: false,
    ...overrides,
  };
}

describe('localDayKey', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 23:30 local on the 10th belongs to the 10th, whatever UTC calls it.
    const local = new Date(2026, 0, 10, 23, 30);
    expect(localDayKey(local)).toBe('2026-01-10');
  });

  it('pads month and day so keys sort lexically', () => {
    expect(localDayKey(new Date(2026, 2, 5))).toBe('2026-03-05');
  });

  it('round-trips through dayKeyToDate', () => {
    // The round trip is what keeps a cell's label and its detail panel
    // naming the same day.
    const key = '2026-01-10';
    const date = dayKeyToDate(key);
    expect(localDayKey(date)).toBe(key);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(10);
  });

  it('builds a local date, not a UTC one', () => {
    // `new Date("2026-01-10")` is UTC midnight, which is the previous evening
    // in the Americas. dayKeyToDate must not behave that way.
    expect(dayKeyToDate('2026-01-10').getHours()).toBe(0);
    expect(dayKeyToDate('2026-01-10').getDate()).toBe(10);
  });
});

describe('groupByDay', () => {
  it('collapses several entries on one day into a single day', () => {
    const days = groupByDay([
      entry(new Date(2026, 0, 10, 9).toISOString(), { achievements: 3 }),
      entry(new Date(2026, 0, 10, 22).toISOString(), { achievements: 4 }),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0]?.achievements).toBe(7);
    expect(days[0]?.games).toBe(2);
  });

  it('keeps an evening on its own day rather than the next one', () => {
    // The regression that made one session appear on two dates.
    const days = groupByDay([entry(new Date(2026, 0, 10, 23, 45).toISOString())]);
    expect(days[0]?.key).toBe('2026-01-10');
  });

  it('orders days newest first', () => {
    const days = groupByDay([
      entry(new Date(2026, 0, 3).toISOString()),
      entry(new Date(2026, 0, 9).toISOString()),
    ]);
    expect(days.map((day) => day.key)).toEqual(['2026-01-09', '2026-01-03']);
  });

  it('records which kinds a day contains', () => {
    const days = groupByDay([
      entry(new Date(2026, 0, 10).toISOString(), { played: true }),
      entry(new Date(2026, 0, 10).toISOString(), { achievements: 2 }),
    ]);
    expect(days[0]?.kinds).toEqual(['played', 'achievements']);
  });
});

describe('weeksOfYear', () => {
  it('covers every day of the year', () => {
    const filled = weeksOfYear(2026)
      .flat()
      .filter((day): day is string => day !== null);
    expect(filled).toHaveLength(365);
    expect(filled[0]).toBe('2026-01-01');
    expect(filled.at(-1)).toBe('2026-12-31');
  });

  it('counts the extra day in a leap year', () => {
    const filled = weeksOfYear(2024)
      .flat()
      .filter(Boolean);
    expect(filled).toHaveLength(366);
  });

  it('pads to whole weeks so every column is seven cells', () => {
    // A ragged column reads as a rendering fault rather than as January
    // starting midweek.
    for (const week of weeksOfYear(2026)) expect(week).toHaveLength(7);
  });
});

describe('monthColumns', () => {
  it('labels twelve months once each', () => {
    const labels = monthColumns(weeksOfYear(2026)).map((month) => month.label);
    expect(labels).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
  });

  it('places each label in an increasing column', () => {
    const columns = monthColumns(weeksOfYear(2026)).map((month) => month.column);
    expect([...columns].sort((a, b) => a - b)).toEqual(columns);
  });
});

describe('intensityOf', () => {
  const day = (achievements: number) => ({
    key: '2026-01-10',
    entries: [],
    achievements,
    games: 1,
    kinds: [],
  });

  it('reports nothing for a day with no activity', () => {
    expect(intensityOf(undefined, 30)).toBe(0);
  });

  it('scales against the reader\'s own busiest day', () => {
    // A fixed threshold would render most libraries a flat single shade.
    expect(intensityOf(day(30), 30)).toBe(4);
    expect(intensityOf(day(1), 30)).toBe(1);
  });

  it('never returns zero for a day that had something in it', () => {
    // Zero is the empty-cell shade; an active day must be distinguishable.
    expect(intensityOf(day(1), 10_000)).toBe(1);
  });

  it('survives a library with no busiest day yet', () => {
    expect(intensityOf(day(1), 0)).toBe(1);
  });
});

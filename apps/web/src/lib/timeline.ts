/**
 * Shared timeline vocabulary.
 *
 * Deliberately its own module rather than living in `timeline-filters.tsx`.
 * That file is a `'use client'` boundary, and Next only carries *component*
 * references across it — importing a plain array from a client module into a
 * server component yields a proxy, so `EVENT_KINDS.find` blew up at render.
 * Both sides import this instead.
 */

export const EVENT_KINDS = [
  { id: 'played', label: 'Played', dot: 'bg-accent' },
  { id: 'achievements', label: 'Achievements', dot: 'bg-warning' },
  { id: 'acquired', label: 'Added', dot: 'bg-violet' },
  { id: 'completed', label: 'Completed', dot: 'bg-positive' },
] as const;

export type EventKind = (typeof EVENT_KINDS)[number]['id'];

export interface TimelineEntry {
  date: string;
  provider: string | null;
  game: { name: string; slug: string; coverImage: string | null };
  played: boolean;
  achievements: number;
  acquired: boolean;
  completed: boolean;
}

/** Which filter kinds an entry satisfies. */
export function kindsOf(entry: TimelineEntry): EventKind[] {
  const kinds: EventKind[] = [];
  if (entry.played) kinds.push('played');
  if (entry.achievements > 0) kinds.push('achievements');
  if (entry.acquired) kinds.push('acquired');
  if (entry.completed) kinds.push('completed');
  return kinds;
}

/* ------------------------------------------------------------------ *
 * Days
 *
 * The calendar grid needs a day key that means the same thing on the
 * server and in the browser. Slicing the ISO string would use UTC and put
 * an evening's play on the following day for anyone west of Greenwich —
 * the same day-boundary bug that once made one session appear twice.
 * ------------------------------------------------------------------ */

/** `YYYY-MM-DD` in the reader's own timezone. */
export function localDayKey(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface TimelineDay {
  /** `YYYY-MM-DD`, local. */
  key: string;
  entries: TimelineEntry[];
  /** Achievements unlocked that day, across every game. */
  achievements: number;
  /** Games touched that day. */
  games: number;
  kinds: EventKind[];
}

/** Groups entries into days, newest first. */
export function groupByDay(entries: TimelineEntry[]): TimelineDay[] {
  const days = new Map<string, TimelineDay>();

  for (const entry of entries) {
    const key = localDayKey(entry.date);
    const day = days.get(key) ?? { key, entries: [], achievements: 0, games: 0, kinds: [] };
    day.entries.push(entry);
    day.achievements += entry.achievements;
    days.set(key, day);
  }

  for (const day of days.values()) {
    day.games = day.entries.length;
    // Ordered by EVENT_KINDS so the strongest signal leads, which is what the
    // grid colours a cell by.
    day.kinds = EVENT_KINDS.map((kind) => kind.id).filter((kind) =>
      day.entries.some((entry) => kindsOf(entry).includes(kind)),
    );
  }

  return [...days.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/**
 * How busy a day was, on a 0–4 scale.
 *
 * Relative to the reader's own busiest day rather than an absolute number:
 * one library's heavy week is another's quiet one, and a fixed threshold
 * would render most people's grid a flat single shade.
 */
export function intensityOf(day: TimelineDay | undefined, busiest: number): 0 | 1 | 2 | 3 | 4 {
  if (!day) return 0;
  if (busiest <= 0) return 1;

  const weight = Math.max(day.achievements, day.games);
  const share = weight / busiest;

  if (share > 0.5) return 4;
  if (share > 0.25) return 3;
  if (share > 0.1) return 2;
  return 1;
}

/** Tailwind background for each intensity step. */
export const INTENSITY_CLASSES = [
  'bg-ink-850',
  'bg-accent/25',
  'bg-accent/45',
  'bg-accent/70',
  'bg-accent',
] as const;

/**
 * The Monday-based weeks covering one calendar year.
 *
 * Returns whole weeks so every column is seven cells tall, with days outside
 * the year left null rather than dropped — a ragged first column reads as a
 * rendering fault rather than as January starting midweek.
 */
export function weeksOfYear(year: number): Array<Array<string | null>> {
  const first = new Date(year, 0, 1);
  const last = new Date(year, 11, 31);

  // Monday-first: getDay() is Sunday-based, so Sunday becomes 6.
  const lead = (first.getDay() + 6) % 7;

  const weeks: Array<Array<string | null>> = [];
  let week: Array<string | null> = Array.from({ length: lead }, () => null);

  for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    week.push(localDayKey(cursor));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return weeks;
}

/** Month labels positioned by the week column each month starts in. */
export function monthColumns(weeks: Array<Array<string | null>>): Array<{
  label: string;
  column: number;
}> {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const seen = new Set<number>();
  const out: Array<{ label: string; column: number }> = [];

  weeks.forEach((week, column) => {
    for (const day of week) {
      if (!day) continue;
      const month = Number(day.slice(5, 7)) - 1;
      if (!seen.has(month)) {
        seen.add(month);
        out.push({ label: names[month] ?? '', column });
      }
      break;
    }
  });

  return out;
}

/** Reads a `YYYY-MM-DD` key back as a local date, for display. */
export function dayKeyToDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

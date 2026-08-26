'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDate, providerLabel } from '@/lib/format';
import {
  dayKeyToDate,
  groupByDay,
  intensityOf,
  INTENSITY_CLASSES,
  monthColumns,
  weeksOfYear,
  type TimelineDay,
  type TimelineEntry,
} from '@/lib/timeline';

/**
 * One year of the timeline, as a calendar rather than a list.
 *
 * The list this replaced could only ever show its first sixty rows, so a busy
 * year — 2023 had activity on 188 separate days — appeared as an arbitrary
 * slice followed by "and 128 more". Worse, a list is the wrong shape for the
 * question people actually bring to a timeline, which is not "what is the
 * 47th thing I did" but "when was I playing, and when did I stop".
 *
 * A year of days is 365 cells, so the whole year fits at a glance and the
 * shape of it — the binges, the gaps, the year something took over — is
 * legible without reading a word. Selecting a day expands what happened on it,
 * which is where the detail belongs: available on demand, not scrolled past.
 */

const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

export function TimelineYear({
  year,
  entries,
  /** Busiest day across the whole timeline, so shading is comparable between years. */
  busiestOverall,
  /** The most recent year opens with its latest day already showing. */
  defaultOpen = false,
}: {
  year: number;
  entries: TimelineEntry[];
  busiestOverall: number;
  defaultOpen?: boolean;
}) {
  const days = useMemo(() => groupByDay(entries), [entries]);
  const byKey = useMemo(() => new Map(days.map((day) => [day.key, day])), [days]);
  const weeks = useMemo(() => weeksOfYear(year), [year]);
  const months = useMemo(() => monthColumns(weeks), [weeks]);

  const [selected, setSelected] = useState<string | null>(
    defaultOpen ? (days[0]?.key ?? null) : null,
  );

  const totals = useMemo(() => {
    let achievements = 0;
    const games = new Set<string>();
    for (const entry of entries) {
      achievements += entry.achievements;
      games.add(entry.game.slug);
    }
    return { achievements, games: games.size, activeDays: days.length };
  }, [entries, days]);

  const selectedDay = selected ? byKey.get(selected) : undefined;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="stat-figure text-2xl text-ink-100">{year}</h2>
        <p className="text-xs text-ink-500">
          {totals.activeDays} active {totals.activeDays === 1 ? 'day' : 'days'} ·{' '}
          {totals.games} {totals.games === 1 ? 'game' : 'games'}
          {totals.achievements > 0 ? ` · ${totals.achievements.toLocaleString()} unlocks` : ''}
        </p>
      </div>

      {/* Horizontal scroll rather than shrinking cells: a squashed year is
          unreadable, and the page itself must never scroll sideways. */}
      <div className="card overflow-x-auto p-4">
        <div className="min-w-max">
          <div className="mb-1 flex gap-[3px] pl-8 text-[10px] text-ink-600">
            {weeks.map((_, column) => {
              const month = months.find((entry) => entry.column === column);
              return (
                <span key={column} className="w-[11px] shrink-0">
                  {month ? month.label : ''}
                </span>
              );
            })}
          </div>

          <div className="flex gap-[3px]">
            <div className="mr-1 flex w-7 shrink-0 flex-col gap-[3px] text-[10px] leading-[11px] text-ink-600">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={index} className="h-[11px]">
                  {label}
                </span>
              ))}
            </div>

            {weeks.map((week, column) => (
              <div key={column} className="flex flex-col gap-[3px]">
                {week.map((key, row) => {
                  if (!key) return <span key={row} className="size-[11px]" aria-hidden />;

                  const day = byKey.get(key);
                  const level = intensityOf(day, busiestOverall);
                  const isSelected = key === selected;

                  return (
                    <button
                      key={row}
                      type="button"
                      // A day with nothing in it is decoration, not a control.
                      disabled={!day}
                      onClick={() => setSelected(isSelected ? null : key)}
                      // Never `formatDate(key)`: a bare "YYYY-MM-DD" parses as
                      // UTC midnight and then renders in local time, so every
                      // label west of Greenwich named the previous day.
                      title={
                        day
                          ? `${formatDate(dayKeyToDate(key))} — ${summarise(day)}`
                          : formatDate(dayKeyToDate(key))
                      }
                      aria-label={
                        day ? `${formatDate(dayKeyToDate(key))}, ${summarise(day)}` : undefined
                      }
                      className={`size-[11px] rounded-[2px] transition-colors ${
                        INTENSITY_CLASSES[level]
                      } ${day ? 'cursor-pointer hover:ring-1 hover:ring-ink-400' : ''} ${
                        isSelected ? 'ring-2 ring-accent ring-offset-1 ring-offset-ink-900' : ''
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-1.5 pl-8 text-[10px] text-ink-600">
            <span>Quieter</span>
            {INTENSITY_CLASSES.map((cls, index) => (
              <span key={index} className={`size-[11px] rounded-[2px] ${cls}`} aria-hidden />
            ))}
            <span>Busier</span>
          </div>
        </div>
      </div>

      {selectedDay ? (
        <DayDetail day={selectedDay} onClose={() => setSelected(null)} />
      ) : (
        <p className="mt-3 text-xs text-ink-600">
          Select a day to see what happened.
        </p>
      )}
    </section>
  );
}

/** Everything that happened on one selected day. */
function DayDetail({ day, onClose }: { day: TimelineDay; onClose: () => void }) {
  return (
    <div className="mt-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-ink-100">
          {formatDate(dayKeyToDate(day.key))}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-500 transition-colors hover:text-ink-300"
        >
          Close
        </button>
      </div>

      <div className="card divide-y divide-ink-850">
        {day.entries.map((entry, index) => (
          <div key={`${entry.game.slug}-${index}`} className="flex items-center gap-3 p-3">
            {entry.game.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.game.coverImage}
                alt=""
                loading="lazy"
                className="h-12 w-9 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="h-12 w-9 shrink-0 rounded bg-ink-850" />
            )}

            <div className="min-w-0 flex-1">
              <Link
                href={`/game/${entry.game.slug}`}
                className="block truncate text-sm text-ink-100 hover:text-accent"
              >
                {entry.game.name}
              </Link>
              <div className="mt-0.5 truncate text-xs text-ink-500">
                {describeEntry(entry)}
                {entry.provider ? ` · ${providerLabel(entry.provider)}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A day in one phrase, for the cell tooltip. */
function summarise(day: TimelineDay): string {
  const parts: string[] = [];
  if (day.achievements > 0) {
    parts.push(`${day.achievements} unlock${day.achievements === 1 ? '' : 's'}`);
  }
  parts.push(`${day.games} game${day.games === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/** Everything that happened to one game on one day, as a single phrase. */
function describeEntry(entry: TimelineEntry): string {
  const parts: string[] = [];

  if (entry.acquired) parts.push('Added');
  if (entry.completed) parts.push('Completed');
  if (entry.achievements > 0) {
    parts.push(`${entry.achievements} achievement${entry.achievements === 1 ? '' : 's'}`);
  }
  // "Played" is implied by an unlock, so it is only worth saying on its own.
  if (entry.played && parts.length === 0) parts.push('Played');

  return parts.join(' · ');
}

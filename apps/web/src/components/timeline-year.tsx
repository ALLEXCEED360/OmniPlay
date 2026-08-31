'use client';

import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDate, providerLabel } from '@/lib/format';
import { Counter } from '@/components/counter';
import {
  dayKeyToDate,
  groupByDay,
  intensityOf,
  INTENSITY_CLASSES,
  monthColumns,
  summariseYear,
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

  const totals = useMemo(() => summariseYear(entries), [entries]);

  const selectedDay = selected ? byKey.get(selected) : undefined;

  return (
    <section>
      {/* A year in figures. Deliberately no hours: see summariseYear — most
          of this library's playtime carries no date at all, and spreading it
          across years would be inventing a distribution. */}
      <div className="anim-rise mb-4">
        <div className="mb-3 flex items-center gap-4">
          <h2 className="stat-figure text-4xl text-ink-100 sm:text-5xl">{year}</h2>
          <span className="rule-soft flex-1" aria-hidden />
        </div>
        {/* Held to a measure rather than spread edge to edge. Five figures
            stretched across a wide screen put 240px between "Games" and
            "Unlocks", which reads as five unrelated facts instead of one
            year's summary. */}
        <dl className="grid max-w-3xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          <YearFigure label="Active days" value={totals.activeDays} accent index={0} />
          <YearFigure label="Games" value={totals.games} index={1} />
          <YearFigure
            label={totals.achievements === 1 ? 'Unlock' : 'Unlocks'}
            value={totals.achievements}
            index={2}
          />
          <YearFigure label="Started" value={totals.started} index={3} />
          <YearFigure label="Finished" value={totals.completed} index={4} />
        </dl>
      </div>

      {/* The year fills the width it is given, down to a floor at which the
          card scrolls sideways instead.

          This used to be `min-w-max` around fixed 11px cells, which answered
          the narrow case — a squashed year is unreadable — and ignored the
          wide one. On a desktop the grid stopped at its natural 740px and left
          a third of the card empty, so the densest thing on the page was also
          the smallest. Cells now stretch to about 20px there.

          The floor is 48rem because that is the width at which a cell is back
          to the 11px it always was: a phone still scrolls, and scrolls through
          exactly the calendar it had before rather than a smaller one. */}
      <div className="card overflow-x-auto p-4">
        <div className="min-w-[48rem]">
          <div className="mb-1 flex gap-[3px] pl-8 text-[10px] text-ink-600">
            {weeks.map((_, column) => {
              const month = months.find((entry) => entry.column === column);
              return (
                <span key={column} className="min-w-0 flex-1 whitespace-nowrap">
                  {month ? month.label : ''}
                </span>
              );
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* Each label takes an equal share of the column's height rather
                than a fixed 11px, so the rows stay aligned once the cells grow. */}
            <div className="mr-1 flex w-7 shrink-0 flex-col gap-[3px] text-[10px] text-ink-600">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={index} className="flex flex-1 items-center leading-none">
                  {label}
                </span>
              ))}
            </div>

            {weeks.map((week, column) => (
              <div
                key={column}
                className="anim-fade stagger flex min-w-0 flex-1 flex-col gap-[3px]"
                style={{ '--i': column, '--stagger-step': '8ms' } as CSSProperties}
              >
                {week.map((key, row) => {
                  if (!key) return <span key={row} className="aspect-square w-full" aria-hidden />;

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
                      className={`aspect-square w-full rounded-[2px] transition-[background-color,transform,box-shadow] duration-150 ${
                        INTENSITY_CLASSES[level]
                      } ${
                        day
                          ? 'cursor-pointer hover:scale-125 hover:ring-1 hover:ring-ink-300'
                          : ''
                      } ${
                        isSelected
                          ? 'scale-125 ring-2 ring-accent ring-offset-1 ring-offset-ink-900'
                          : ''
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

/** One figure in a year's summary row. */
function YearFigure({
  label,
  value,
  accent = false,
  index = 0,
}: {
  label: string;
  value: number;
  accent?: boolean;
  index?: number;
}) {
  return (
    <div className="anim-rise stagger" style={{ '--i': index } as CSSProperties}>
      <dt className="eyebrow text-ink-600">{label}</dt>
      <dd
        className={`stat-figure mt-0.5 text-xl ${
          value === 0 ? 'text-ink-600' : accent ? 'text-accent' : 'text-ink-100'
        }`}
      >
        <Counter value={value} />
      </dd>
    </div>
  );
}

/** Everything that happened on one selected day. */
function DayDetail({ day, onClose }: { day: TimelineDay; onClose: () => void }) {
  return (
    <div className="anim-rise mt-3">
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
          <div
            key={`${entry.game.slug}-${index}`}
            style={{ '--i': index, '--stagger-step': '45ms' } as CSSProperties}
            className="group anim-fade stagger flex items-center gap-3 p-3 transition-colors hover:bg-ink-850/50"
          >
            {entry.game.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.game.coverImage}
                alt=""
                loading="lazy"
                className="h-12 w-9 shrink-0 rounded object-cover transition-transform duration-200 group-hover:scale-105"
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

  // Ordered by how much each says about the day. "Started playing" is the
  // most notable thing that can happen to a game, so it leads.
  if (entry.firstPlayed) parts.push('Started playing');
  if (entry.acquired) parts.push('Added');
  if (entry.completed) parts.push('Completed');
  if (entry.achievements > 0) {
    parts.push(`${entry.achievements} achievement${entry.achievements === 1 ? '' : 's'}`);
  }
  // "Played" is implied by an unlock, so it is only worth saying on its own.
  if (entry.played && parts.length === 0) parts.push('Played');

  return parts.join(' · ');
}

'use client';

import type { CSSProperties, KeyboardEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
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
 *
 * The grid answers the pointer like a game board answers a cursor. A readout
 * above it names whatever day is under the mouse, at once, instead of a
 * browser tooltip a second later; the chosen day glows; and the arrow keys
 * walk from day to day — a column is a week, so left and right step seven
 * days and up and down step one — skipping the days nothing happened on.
 * The detail below cross-fades between days rather than snapping.
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
  const [hovered, setHovered] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const totals = useMemo(() => summariseYear(entries), [entries]);

  const selectedDay = selected ? byKey.get(selected) : undefined;
  const readoutKey = hovered ?? selected;
  const readoutDay = readoutKey ? byKey.get(readoutKey) : undefined;

  // Every day of the year in order, with its place, so the arrow keys can
  // step through the calendar and land only on days with something in them.
  const order = useMemo(() => weeks.flat().filter((key): key is string => key !== null), [weeks]);
  const walk = (from: string, by: number): string | null => {
    let index = order.indexOf(from);
    if (index < 0) return null;
    const direction = Math.sign(by);
    // Step the full distance first, then keep going in the same direction
    // until a day with activity, so a quiet fortnight is not a wall.
    index += by;
    while (index >= 0 && index < order.length) {
      const key = order[index]!;
      if (byKey.has(key)) return key;
      index += direction;
    }
    return null;
  };
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = selected ?? days[0]?.key;
    if (!from) return;
    const step: Record<string, number> = {
      ArrowRight: 7,
      ArrowLeft: -7,
      ArrowDown: 1,
      ArrowUp: -1,
    };
    const by = step[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const next = selected ? walk(from, by) : from;
    if (next) setSelected(next);
  };

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

      {/* The year fills the width it is given — about 20px a cell on a
          desktop — down to a floor at which the card scrolls sideways
          instead. The floor is 48rem because that is the width at which a
          cell is 11px, the smallest a day can be and still be read: a
          phone scrolls through a calendar of that size rather than a
          squashed one. */}
      <div className="card overflow-x-auto p-4">
        <div className="min-w-[48rem]">
          {/* The readout: whatever day the pointer is over, or failing that
              the chosen one. It sits above the grid where the eye already
              is, and it changes the instant the pointer does. */}
          <div className="mb-2 flex h-5 items-baseline justify-between gap-4 pl-8">
            <span className="stat-figure text-[11px] text-ink-500" aria-live="polite">
              {readoutKey ? (
                <>
                  <span className="text-ink-100">{formatDate(dayKeyToDate(readoutKey))}</span>
                  {readoutDay ? <span className="text-accent"> — {summarise(readoutDay)}</span> : null}
                </>
              ) : (
                <span className="text-ink-600">Hover a day</span>
              )}
            </span>
            <span className="stat-figure hidden text-[10px] text-ink-600 lg:inline">
              ← → week · ↑ ↓ day
            </span>
          </div>

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

          <div
            ref={gridRef}
            className="flex gap-[3px] outline-none"
            tabIndex={0}
            onKeyDown={onGridKey}
            onMouseLeave={() => setHovered(null)}
            aria-label={`${year}, a calendar of days. Use the arrow keys to move between days.`}
          >
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
                      tabIndex={-1}
                      // A day with nothing in it is decoration, not a control.
                      disabled={!day}
                      onClick={() => setSelected(isSelected ? null : key)}
                      onMouseEnter={() => setHovered(key)}
                      // Never `formatDate(key)`: a bare "YYYY-MM-DD" parses as
                      // UTC midnight and then renders in local time, so every
                      // label west of Greenwich named the previous day.
                      aria-label={
                        day ? `${formatDate(dayKeyToDate(key))}, ${summarise(day)}` : undefined
                      }
                      className={`aspect-square w-full rounded-[2px] transition-[background-color,transform,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        INTENSITY_CLASSES[level]
                      } ${
                        day
                          ? 'cursor-pointer hover:z-10 hover:scale-[1.35] hover:shadow-[0_0_0_1.5px_var(--color-ink-100)]'
                          : ''
                      } ${
                        isSelected
                          ? 'z-10 scale-[1.35] shadow-[0_0_0_2px_var(--color-accent),0_0_14px_2px_color-mix(in_oklch,var(--color-accent)_55%,transparent)]'
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

      <AnimatePresence mode="wait" initial={false}>
        {selectedDay ? (
          <motion.div
            key={selectedDay.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <DayDetail day={selectedDay} onClose={() => setSelected(null)} />
          </motion.div>
        ) : (
          <motion.p
            key="hint"
            className="mt-3 text-xs text-ink-600"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            Select a day to see what happened.
          </motion.p>
        )}
      </AnimatePresence>
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
    <div className="mt-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="display flex items-center gap-2.5 text-lg text-ink-100">
          <span className="slash" aria-hidden />
          {formatDate(dayKeyToDate(day.key))}
          <span className="stat-figure text-xs font-normal normal-case tracking-normal text-ink-500">
            {summarise(day)}
          </span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-ink-500 transition-colors hover:text-accent"
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
                className="h-12 w-9 shrink-0 object-cover transition-transform duration-200 group-hover:scale-105"
              />
            ) : (
              <span className="h-12 w-9 shrink-0 bg-ink-850" />
            )}

            <div className="min-w-0 flex-1">
              <Link
                href={`/game/${entry.game.slug}`}
                className="block truncate font-display text-[15px] font-semibold uppercase tracking-wide text-ink-100 transition-colors hover:text-accent"
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

'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { providerLabel } from '@/lib/format';
import { platformStyle } from '@/lib/platform';
import { EVENT_KINDS, type EventKind } from '@/lib/timeline';

/**
 * Timeline filters.
 *
 * State lives in the URL, matching the library's filter bar: a filtered view
 * survives a refresh, is shareable, and the back button behaves. Filtering
 * happens on the already-fetched entries rather than server-side, because the
 * timeline is a bounded list and a round-trip per chip would feel worse than
 * the render it saves.
 */

/** The URL value for "nothing ticked"; see toggleInList. */
export const NONE = 'none';

export function TimelineFilters({
  providers,
  counts,
  providerCounts,
  shown,
  total,
  shownDays,
}: {
  providers: string[];
  counts: Record<EventKind, number>;
  /** Entries per platform, over the whole history. */
  providerCounts: Record<string, number>;
  /** Entries the current filter lets through, and how many there are. */
  shown: number;
  total: number;
  /** Days with at least one entry after filtering. */
  shownDays: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const toggleInList = useCallback(
    (key: string, value: string, all: string[]) => {
      const raw = searchParams.get(key) ?? '';
      // An empty parameter means "everything", so the first click has to start
      // from the full set and remove one — otherwise unticking a box would
      // read as selecting only that box. `none` is the other end: every box
      // unticked, which has to be spelt out because an empty list already
      // means "all". Without it, unticking the last box snapped straight
      // back to everything, and there was no way to clear the board.
      const current = raw === NONE ? [] : raw.split(',').filter(Boolean);
      const base = raw === NONE ? [] : current.length > 0 ? current : all;
      const next = base.includes(value)
        ? base.filter((item) => item !== value)
        : [...base, value];

      // Back to everything selected: drop the parameter rather than listing
      // every value, so the URL stays clean.
      update(key, next.length === 0 ? NONE : next.length === all.length ? null : next.join(','));
    },
    [searchParams, update],
  );

  // Only kinds this library actually contains.
  //
  // A chip that can never match anything is not a disabled control, it is
  // clutter: "Added" stays empty until a file import supplies acquisition
  // dates, because no platform API reports when a game was bought. Hiding it
  // is honest — the filter reappears the moment the data does.
  const presentKinds = EVENT_KINDS.filter((kind) => counts[kind.id] > 0);
  const allKinds = presentKinds.map((kind) => kind.id);
  const rawKinds = searchParams.get('kinds') ?? '';
  const rawProviders = searchParams.get('providers') ?? '';
  const activeKinds = rawKinds.split(',').filter(Boolean);
  const activeProviders = rawProviders.split(',').filter(Boolean);

  const isKindOn = (kind: string) =>
    rawKinds !== NONE && (activeKinds.length === 0 || activeKinds.includes(kind));
  const isProviderOn = (provider: string) =>
    rawProviders !== NONE && (activeProviders.length === 0 || activeProviders.includes(provider));

  const filtered = activeKinds.length > 0 || activeProviders.length > 0;

  return (
    <div
      className="card hud-corners relative p-4 sm:p-5"
      role="group"
      aria-label="Filter the timeline"
    >
      {/* A determinate-looking sweep rather than dimming the controls: the
          reader is mid-decision, and greying out the chips they are aiming at
          is the one thing not to do while a navigation resolves. */}
      <span
        className={`absolute inset-x-0 top-0 h-px overflow-hidden transition-opacity duration-200 ${
          pending ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden
      >
        <span className="shimmer absolute inset-0 bg-ink-800" />
      </span>

      {/* The panel says what it is. A row of coloured words with nothing
          around them read as decoration; a titled panel with tick boxes
          reads as a control, which is what it is. */}
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="display flex items-center gap-2.5 text-[1.25rem] text-ink-100">
          <svg
            viewBox="0 0 24 24"
            className="size-4 text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
          </svg>
          Filter
          <span className="stat-figure text-xs font-normal normal-case tracking-normal text-ink-500">
            {filtered ? 'showing a subset' : 'showing everything'}
          </span>
        </h2>
        {filtered ? (
          <button
            type="button"
            onClick={() => startTransition(() => router.push(pathname, { scroll: false }))}
            className="btn-ghost btn-sm"
          >
            Reset
          </button>
        ) : null}
      </div>

      {/* Ticks on the left, sized to themselves; the readout takes every
          pixel that is left, its bars running the full remaining width, so
          a wide screen gets longer bars rather than a wider gap. */}
      <div className="grid gap-5 lg:grid-cols-[auto_1fr] lg:gap-8">
      <div className="grid gap-3 self-start lg:grid-cols-[auto_1fr] lg:items-baseline lg:gap-x-6">
        <span className="eyebrow text-ink-500">Show</span>
        <div className="flex flex-wrap items-center gap-2">
          {presentKinds.map((kind) => {
            const on = isKindOn(kind.id);
            return (
              <Toggle
                key={kind.id}
                on={on}
                onClick={() => toggleInList('kinds', kind.id, allKinds)}
                dot={kind.dot}
                count={counts[kind.id]}
              >
                {kind.label}
              </Toggle>
            );
          })}
        </div>

        {providers.length > 1 ? (
          <>
            <span className="eyebrow text-ink-500">Platform</span>
            <div className="flex flex-wrap items-center gap-2">
              {providers.map((provider) => (
                <Toggle
                  key={provider}
                  on={isProviderOn(provider)}
                  onClick={() => toggleInList('providers', provider, providers)}
                  dot={platformStyle(provider).bar}
                >
                  {providerLabel(provider)}
                </Toggle>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* The readout: what the ticks add up to. The figure is how much of
          the history is on the board right now; the two bars are its make-up
          by kind and by platform, in the colours the tick boxes use, so the
          panel explains the calendars below as well as controlling them. */}
      <div className="flex flex-col gap-4 border-t border-ink-800 pt-4 lg:flex-row lg:gap-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <div className="shrink-0">
          <span className="eyebrow text-ink-500">On the board</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="display text-[2.5rem] leading-none text-ink-100">
              {shown.toLocaleString()}
            </span>
            <span className="stat-figure text-xs text-ink-500">
              of {total.toLocaleString()} events
            </span>
          </div>
          <div className="stat-figure mt-1 text-[11px] text-ink-500">
            across {shownDays.toLocaleString()} days
          </div>
        </div>

        <div className="min-w-0 flex-1">
        <Split
          label="By kind"
          parts={presentKinds.map((kind) => ({
            id: kind.id,
            label: kind.label,
            value: counts[kind.id],
            colour: kind.dot,
            on: isKindOn(kind.id),
          }))}
        />
        {providers.length > 1 ? (
          <Split
            label="By platform"
            parts={providers.map((provider) => ({
              id: provider,
              label: providerLabel(provider),
              value: providerCounts[provider] ?? 0,
              colour: platformStyle(provider).bar,
              on: isProviderOn(provider),
            }))}
          />
        ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * One segmented bar with its legend. A part that is ticked off in the
 * filter is drawn hollow rather than removed, so the bar keeps its
 * proportions and shows what is missing as well as what is there.
 */
function Split({
  label,
  parts,
}: {
  label: string;
  parts: Array<{ id: string; label: string; value: number; colour: string; on: boolean }>;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  return (
    <div className="[&+&]:mt-4">
      <div className="eyebrow mb-1.5 text-[10px] text-ink-600">{label}</div>
      <div className="flex h-2 -skew-x-[20deg] gap-0.5 overflow-hidden bg-ink-950/60">
        {parts.map((part) => (
          <span
            key={part.id}
            className={`h-full transition-[opacity,width] duration-300 ${part.colour} ${
              part.on ? '' : 'opacity-20'
            }`}
            style={{ width: `${(part.value / total) * 100}%` }}
            title={`${part.label}: ${part.value.toLocaleString()}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((part) => (
          <span
            key={part.id}
            className={`flex items-center gap-1.5 text-[11px] transition-colors ${
              part.on ? 'text-ink-300' : 'text-ink-600 line-through'
            }`}
          >
            <span className={`size-1.5 -skew-x-[20deg] ${part.colour} ${part.on ? '' : 'opacity-30'}`} aria-hidden />
            {part.label}
            <span className="stat-figure text-ink-500">{Math.round((part.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One filter, drawn as the thing it is: a tick box with a label. Ticked is
 * a filled box with a check; unticked is an empty box and dimmed text. The
 * colour swatch says which series the toggle governs.
 */
function Toggle({
  on,
  onClick,
  dot,
  count,
  children,
}: {
  on: boolean;
  onClick: () => void;
  dot: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={`group inline-flex items-center gap-2.5 cut-sm px-3 py-2 font-display text-[13px] font-semibold uppercase tracking-wider transition-all duration-200 active:translate-y-px ${
        on
          ? 'bg-ink-800 text-ink-100 shadow-[inset_0_0_0_1px_var(--color-ink-600)]'
          : 'bg-ink-950/40 text-ink-500 shadow-[inset_0_0_0_1px_var(--color-ink-800)] hover:text-ink-300 hover:shadow-[inset_0_0_0_1px_var(--color-ink-600)]'
      }`}
    >
      <span
        className={`grid size-4 shrink-0 place-items-center transition-colors duration-200 ${
          on ? 'bg-accent text-ink-950' : 'shadow-[inset_0_0_0_1.5px_var(--color-ink-600)]'
        }`}
        aria-hidden
      >
        {on ? (
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        ) : null}
      </span>
      <span className={`size-2 shrink-0 -skew-x-[20deg] ${on ? dot : 'bg-ink-700'}`} aria-hidden />
      {children}
      {count !== undefined ? (
        <span className={`stat-figure text-[11px] ${on ? 'text-ink-400' : 'text-ink-600'}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

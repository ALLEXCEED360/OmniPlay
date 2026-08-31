'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { platformStyle } from '@/lib/platform';

/**
 * Library filter bar.
 *
 * State lives entirely in the URL rather than in component state: filters
 * survive a refresh, are shareable, and the server component re-renders with
 * the right data without a client-side store.
 *
 * Every chip carries the number of games it would bring back, counted against
 * the whole library rather than the current results — so the count answers
 * "what will this show me", not "what is already on screen". That matters here
 * because two of these filters match nothing at all: no provider has ever
 * dropped a title from this library, and "Abandoned" is never inferred, only
 * declared. Without a number attached, clicking either one empties the page
 * and looks like a bug.
 */

export interface LibraryFacets {
  total: number;
  providers: Record<string, number>;
  statuses: Record<string, number>;
  ownership: { owned: number; previouslyOwned: number };
}

const PROVIDERS = [
  { id: 'steam', label: 'Steam' },
  { id: 'xbox', label: 'Xbox' },
  { id: 'psn', label: 'PlayStation' },
];

const STATUSES = [
  { id: 'PLAYING', label: 'Playing' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'NOT_STARTED', label: 'Backlog' },
  {
    id: 'ABANDONED',
    label: 'Abandoned',
    // Not a gap in the data: a sync is never allowed to decide you gave up on
    // something. Said plainly, because a chip that returns nothing otherwise
    // reads as broken.
    empty: 'Nothing is marked abandoned — this is only ever set by you, never guessed from a sync.',
  },
];

const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'rating', label: 'Critic score' },
  { id: 'release', label: 'Release date' },
  { id: 'recent', label: 'Recently played' },
];

export function LibraryFilters({ facets }: { facets: LibraryFacets }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  const update = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      // Any filter change invalidates the current page number.
      params.delete('page');
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  /** Toggles one value inside a comma-separated multi-select parameter. */
  const toggleInList = useCallback(
    (key: string, value: string) => {
      const current = (searchParams.get(key) ?? '').split(',').filter(Boolean);
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      update(key, next.length > 0 ? next.join(',') : null);
    },
    [searchParams, update],
  );

  // Debounced search: one navigation per pause in typing, not per keystroke.
  useEffect(() => {
    const currentSearch = searchParams.get('search') ?? '';
    if (search === currentSearch) return;

    const timer = setTimeout(() => update('search', search || null), 300);
    return () => clearTimeout(timer);
  }, [search, searchParams, update]);

  const activeProviders = (searchParams.get('providers') ?? '').split(',').filter(Boolean);
  const activeStatuses = (searchParams.get('statuses') ?? '').split(',').filter(Boolean);
  const ownership = searchParams.get('ownership') ?? 'all';
  const sort = searchParams.get('sort') ?? 'name';
  const view = searchParams.get('view') === 'list' ? 'list' : 'grid';

  const anyFilter =
    activeProviders.length > 0 ||
    activeStatuses.length > 0 ||
    ownership !== 'all' ||
    search.length > 0;

  const setView = (next: 'grid' | 'list') => update('view', next === 'list' ? 'list' : null);

  return (
    <div className="relative space-y-4">
      {/* A determinate-looking sweep rather than dimming the controls: the
          reader is mid-decision, and greying out the chips they are aiming at
          is the one thing not to do while a navigation resolves. */}
      <span
        className={`absolute -top-2 left-0 h-px w-full overflow-hidden rounded-full transition-opacity duration-200 ${
          pending ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden
      >
        <span className="shimmer absolute inset-0 bg-ink-800" />
      </span>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your library"
            aria-label="Search your library"
            className="w-full rounded-lg border border-ink-800 bg-ink-900 py-2 pl-9 pr-3 text-sm text-ink-100 transition-[border-color,box-shadow] duration-200 placeholder:text-ink-600 focus:border-accent focus:shadow-[0_0_0_3px] focus:shadow-accent/15 focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-400">
          Sort
          <select
            value={sort}
            onChange={(event) => update('sort', event.target.value)}
            className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-accent focus:outline-none"
          >
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* Grid or table. The table exists so the numbers a sort orders by can
            be compared down a column instead of hunted across a grid. */}
        <div
          className="flex items-center rounded-lg border border-ink-800 p-0.5"
          role="group"
          aria-label="View"
        >
          {(['grid', 'list'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              title={option === 'grid' ? 'Cover grid' : 'Detail table'}
              className={`rounded-md px-2 py-1.5 transition-colors ${
                view === option
                  ? 'bg-ink-800 text-ink-100'
                  : 'text-ink-500 hover:text-ink-200'
              }`}
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                {option === 'grid' ? (
                  <>
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </>
                ) : (
                  <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
                )}
              </svg>
              <span className="sr-only">{option === 'grid' ? 'Cover grid' : 'Detail table'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PROVIDERS.map((provider) => (
          <FilterChip
            key={provider.id}
            active={activeProviders.includes(provider.id)}
            provider={provider.id}
            count={facets.providers[provider.id] ?? 0}
            onClick={() => toggleInList('providers', provider.id)}
          >
            {provider.label}
          </FilterChip>
        ))}

        <span className="mx-1 w-px self-stretch bg-ink-800" aria-hidden />

        {STATUSES.map((status) => (
          <FilterChip
            key={status.id}
            active={activeStatuses.includes(status.id)}
            count={facets.statuses[status.id] ?? 0}
            emptyReason={status.empty}
            onClick={() => toggleInList('statuses', status.id)}
          >
            {status.label}
          </FilterChip>
        ))}

        <span className="mx-1 w-px self-stretch bg-ink-800" aria-hidden />

        {/* Ownership is single-select: the states are mutually exclusive. */}
        <FilterChip
          active={ownership === 'owned'}
          count={facets.ownership.owned}
          onClick={() => update('ownership', ownership === 'owned' ? null : 'owned')}
        >
          Owned now
        </FilterChip>
        <FilterChip
          active={ownership === 'previously-owned'}
          count={facets.ownership.previouslyOwned}
          emptyReason="Nothing has left your library yet — this fills in if a platform ever drops a title from your entitlements."
          onClick={() =>
            update('ownership', ownership === 'previously-owned' ? null : 'previously-owned')
          }
        >
          Previously owned
        </FilterChip>

        {anyFilter ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              startTransition(() =>
                router.push(view === 'list' ? `${pathname}?view=list` : pathname, {
                  scroll: false,
                }),
              );
            }}
            className="anim-fade ml-1 text-xs text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-200"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  /** When set, the active chip wears that platform's colour. */
  provider,
  count,
  /** Why this filter currently matches nothing, if it does not. */
  emptyReason,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  provider?: string;
  count?: number;
  emptyReason?: string;
}) {
  const style = provider ? platformStyle(provider) : null;

  // A chip that can bring back nothing is not disabled — it is still a true
  // statement about the library, and hiding it would leave the reader
  // wondering where a filter went. It is dimmed, made unclickable, and told
  // to explain itself on hover.
  const empty = count === 0;

  return (
    <button
      type="button"
      onClick={empty ? undefined : onClick}
      disabled={empty}
      aria-pressed={empty ? undefined : active}
      title={empty ? emptyReason : undefined}
      className={`group relative inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
        empty
          ? 'cursor-default border-ink-850 text-ink-600'
          : active
            ? style
              ? `${style.border} ${style.text} bg-ink-850`
              : 'border-accent/40 bg-accent/15 text-accent'
            : 'border-ink-800 text-ink-400 hover:-translate-y-px hover:border-ink-700 hover:text-ink-200 active:scale-[0.96]'
      }`}
    >
      {/* A dot that only lights once the chip is on, so the row reads as a set
          of switches rather than a row of buttons. */}
      {style ? (
        <span
          className={`size-1.5 rounded-full transition-all duration-200 ${
            active ? style.bar : 'bg-ink-700 group-hover:bg-ink-600'
          }`}
          aria-hidden
        />
      ) : null}
      {children}
      {count !== undefined ? (
        <span className={`stat-figure ${empty ? 'text-ink-700' : 'text-ink-500'}`}>{count}</span>
      ) : null}
    </button>
  );
}

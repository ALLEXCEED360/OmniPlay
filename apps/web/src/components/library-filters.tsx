'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

const PROVIDERS = [
  { id: 'steam', label: 'Steam' },
  { id: 'xbox', label: 'Xbox' },
  { id: 'psn', label: 'PlayStation' },
];

const STATUSES = [
  { id: 'PLAYING', label: 'Playing' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'NOT_STARTED', label: 'Backlog' },
  { id: 'ABANDONED', label: 'Abandoned' },
];

const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'release', label: 'Release date' },
  { id: 'rating', label: 'Rating' },
  { id: 'recent', label: 'Recently updated' },
];

/**
 * Library filter bar.
 *
 * State lives entirely in the URL rather than in component state: filters
 * survive a refresh, are shareable, and the server component re-renders with
 * the right data without a client-side store.
 */
export function LibraryFilters() {
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

  return (
    <div className={`space-y-4 ${pending ? 'opacity-70' : ''} transition-opacity`}>
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
            className="w-full rounded-lg border border-ink-800 bg-ink-900 py-2 pl-9 pr-3 text-sm text-ink-100 placeholder:text-ink-600 focus:border-accent focus:outline-none"
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
      </div>

      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((provider) => (
          <FilterChip
            key={provider.id}
            active={activeProviders.includes(provider.id)}
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
            onClick={() => toggleInList('statuses', status.id)}
          >
            {status.label}
          </FilterChip>
        ))}

        <span className="mx-1 w-px self-stretch bg-ink-800" aria-hidden />

        {/* Ownership is single-select: the three states are mutually exclusive. */}
        <FilterChip
          active={ownership === 'owned'}
          onClick={() => update('ownership', ownership === 'owned' ? null : 'owned')}
        >
          Owned now
        </FilterChip>
        <FilterChip
          active={ownership === 'previously-owned'}
          onClick={() =>
            update('ownership', ownership === 'previously-owned' ? null : 'previously-owned')
          }
        >
          Previously owned
        </FilterChip>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-accent/40 bg-accent/15 text-accent'
          : 'border-ink-800 text-ink-400 hover:border-ink-700 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}

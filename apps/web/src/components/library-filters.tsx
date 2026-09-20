'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LIBRARY_RETURN_KEY } from './back-to-library';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { platformStyle } from '@/lib/platform';

/**
 * The library's deck: its filters, sort and view, as a menu.
 *
 * Laid out the way an Atlus game lays out a menu — one column of choices
 * in the display cut, grouped under headings, the chosen ones cut from
 * paper with a gold slash, the rest waiting in ink and lighting from the
 * left as the pointer crosses them. Every row carries the number of games
 * it would bring back, counted against the whole library, so the deck
 * reads as a table of contents for the collection before a single row is
 * pressed.
 *
 * State lives entirely in the URL rather than in component state: filters
 * survive a refresh, are shareable, and the server component re-renders
 * with the right data without a client-side store. Two of these rows
 * match nothing at all — no provider has ever dropped a title from this
 * library, and "Abandoned" is never inferred, only declared — and they
 * say so on hover rather than emptying the page and looking like a bug.
 *
 * On a wide screen the deck stands to the left of the shelf and stays put
 * as the shelf scrolls. On a phone it folds behind one button.
 */

export interface LibraryFacets {
  total: number;
  providers: Record<string, number>;
  statuses: Record<string, number>;
  ownership: { purchased: number; subscription: number };
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
    empty: 'Nothing is marked abandoned — this is only ever set by you, never guessed from a sync.',
  },
];

const SORTS = [
  { id: 'name', label: 'Name', hint: 'A to Z' },
  { id: 'rating', label: 'Critic score', hint: 'Highest first' },
  { id: 'release', label: 'Release date', hint: 'Newest first' },
  { id: 'recent', label: 'Recently played', hint: 'Latest first' },
];

const ease = [0.16, 1, 0.3, 1] as const;

export function LibraryFilters({ facets }: { facets: LibraryFacets }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  const update = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      // Any filter change invalidates the current page number.
      params.delete('page');
      startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
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

  // Remember the shelf as it stands, so a game page's "Library" button can
  // bring you back to the same filters, sort and page. See LIBRARY_RETURN_KEY.
  useEffect(() => {
    const query = searchParams.toString();
    try {
      sessionStorage.setItem(LIBRARY_RETURN_KEY, query ? `${pathname}?${query}` : pathname);
    } catch {
      // Storage may be blocked; the button then goes to the shelf fresh.
    }
  }, [pathname, searchParams]);

  // "/" jumps to the search box from anywhere on the page, the way it does
  // on every site a player already uses.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      setOpen(true);
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeProviders = (searchParams.get('providers') ?? '').split(',').filter(Boolean);
  const activeStatuses = (searchParams.get('statuses') ?? '').split(',').filter(Boolean);
  const ownership = searchParams.get('ownership') ?? 'all';
  const sort = searchParams.get('sort') ?? 'name';
  const view = searchParams.get('view') === 'list' ? 'list' : 'grid';

  const activeCount =
    activeProviders.length + activeStatuses.length + (ownership !== 'all' ? 1 : 0) + (search ? 1 : 0);

  const clear = () => {
    setSearch('');
    startTransition(() =>
      router.push(view === 'list' ? `${pathname}?view=list` : pathname, { scroll: false }),
    );
  };

  const deck = (
    <div className="relative">
      {/* A sweep along the top while a navigation resolves: the reader is
          mid-decision, and greying out the row they are aiming at is the
          one thing not to do. */}
      <span
        className={`pointer-events-none absolute -top-2 left-0 h-px w-full overflow-hidden transition-opacity duration-200 ${
          pending ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden
      >
        <span className="shimmer absolute inset-0 bg-ink-800" />
      </span>

      {/* Search */}
      <div className="relative">
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
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          aria-label="Search your library"
          className="w-full cut-sm bg-ink-950/70 py-2.5 pl-9 pr-9 font-display text-[15px] font-semibold uppercase tracking-wider text-ink-100 shadow-[inset_0_0_0_1px_var(--color-ink-700)] transition-shadow duration-200 placeholder:text-ink-600 focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)] focus:outline-none"
        />
        <kbd className="stat-figure pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ink-600">
          /
        </kbd>
      </div>

      <Section
        title="Platform"
        state={activeProviders.length === 0 ? 'All' : `${activeProviders.length} of ${PROVIDERS.length}`}
      >
        {PROVIDERS.map((provider) => (
          <Row
            key={provider.id}
            box
            on={activeProviders.includes(provider.id)}
            count={facets.providers[provider.id] ?? 0}
            swatch={platformStyle(provider.id).bar}
            onClick={() => toggleInList('providers', provider.id)}
          >
            {provider.label}
          </Row>
        ))}
      </Section>

      <Section
        title="Status"
        state={activeStatuses.length === 0 ? 'All' : `${activeStatuses.length} of ${STATUSES.length}`}
      >
        {STATUSES.map((status) => (
          <Row
            key={status.id}
            box
            on={activeStatuses.includes(status.id)}
            count={facets.statuses[status.id] ?? 0}
            emptyReason={status.empty}
            onClick={() => toggleInList('statuses', status.id)}
          >
            {status.label}
          </Row>
        ))}
      </Section>

      <Section title="Ownership" state={ownership === 'all' ? 'Either' : 'One of two'}>
        <Row
          box
          on={ownership === 'purchased'}
          count={facets.ownership.purchased}
          onClick={() => update('ownership', ownership === 'purchased' ? null : 'purchased')}
        >
          Purchased
        </Row>
        <Row
          box
          on={ownership === 'subscription'}
          count={facets.ownership.subscription}
          emptyReason="No subscription titles in your library — Game Pass and PS Plus games appear here once a sync finds them."
          onClick={() => update('ownership', ownership === 'subscription' ? null : 'subscription')}
        >
          Subscription
        </Row>
      </Section>

      <Section title="Sort by">
        {SORTS.map((option) => (
          <Row
            key={option.id}
            on={sort === option.id}
            hint={option.hint}
            radio
            onClick={() => update('sort', option.id === 'name' ? null : option.id)}
          >
            {option.label}
          </Row>
        ))}
      </Section>

      <Section title="View">
        <Row radio on={view === 'grid'} onClick={() => update('view', null)}>
          Covers
        </Row>
        <Row radio on={view === 'list'} onClick={() => update('view', 'list')}>
          Table
        </Row>
      </Section>

      <AnimatePresence initial={false}>
        {activeCount > 0 ? (
          <motion.button
            key="clear"
            type="button"
            onClick={clear}
            className="btn-ghost btn-sm mt-5 w-full"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            transition={{ duration: 0.25, ease }}
          >
            Clear {activeCount === 1 ? 'the filter' : `${activeCount} filters`}
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {/* Phone: the deck folds behind one button that says how much of it
          is in use. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="btn-ghost w-full justify-between"
        >
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
            </svg>
            Filters
            {activeCount > 0 ? (
              <span className="stat-figure bg-accent px-1.5 text-[11px] text-ink-950">
                {activeCount}
              </span>
            ) : null}
          </span>
          <span aria-hidden>{open ? '−' : '+'}</span>
        </button>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="deck"
              className="card mt-3 overflow-hidden p-4"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease }}
            >
              {deck}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Desktop: the deck stands beside the shelf and stays put. */}
      <aside className="hidden lg:block lg:sticky lg:top-24 lg:self-start">
        <div className="card hud-corners p-4 2xl:p-5">{deck}</div>
      </aside>
    </>
  );
}

function Section({
  title,
  state,
  children,
}: {
  title: string;
  /** What the section is currently doing — "All", "2 of 3" — so an empty set of boxes is read as "everything", not "nothing". */
  state?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="eyebrow text-ink-500">{title}</span>
        <span className="rule-soft flex-1" aria-hidden />
        {state ? (
          <span className={`stat-figure text-[10px] ${state === 'All' || state === 'Either' ? 'text-ink-600' : 'text-accent'}`}>
            {state}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

/**
 * One row of the deck. `on` is a paper cut-out with the gold slash, the
 * menu's cursor; off is ink that lights from the left under the pointer.
 * A row that can bring back nothing is not disabled — it is still a true
 * statement about the library — it is dimmed, unclickable, and explains
 * itself on hover.
 */
function Row({
  on,
  onClick,
  children,
  count,
  swatch,
  hint,
  emptyReason,
  radio = false,
  box = false,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  /** A platform colour, shown as a slanted swatch. */
  swatch?: string;
  /** A short phrase on the right, for sorts. */
  hint?: string;
  emptyReason?: string;
  /** One of a set rather than a toggle: ARIA only. */
  radio?: boolean;
  /**
   * A tick box on the row. For the multi-select sections, where "none
   * ticked" means everything: the box makes the difference between
   * "included" and "not narrowed down to" visible, where the paper cursor
   * alone did not.
   */
  box?: boolean;
}) {
  const empty = count === 0;
  return (
    <button
      type="button"
      onClick={empty ? undefined : onClick}
      disabled={empty}
      role={radio ? 'radio' : 'checkbox'}
      aria-checked={empty ? undefined : on}
      title={empty ? emptyReason : undefined}
      className={`group relative flex w-full items-center gap-3 py-1.5 pl-4 pr-3 text-left outline-none transition-colors duration-150 focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)] ${
        empty ? 'cursor-default text-ink-600' : on ? 'text-ink-950' : 'text-ink-300 hover:text-ink-950'
      }`}
    >
      {on ? (
        <span className="paper slant absolute inset-0" aria-hidden />
      ) : empty ? null : (
        <span
          className="slant absolute inset-0 origin-left scale-x-0 bg-accent transition-transform duration-200 ease-out group-hover:scale-x-100"
          aria-hidden
        />
      )}
      {box ? (
        <span
          className={`relative grid size-4 shrink-0 place-items-center transition-colors duration-200 ${
            on
              ? 'bg-accent-strong text-paper'
              : empty
                ? 'shadow-[inset_0_0_0_1.5px_var(--color-ink-800)]'
                : 'shadow-[inset_0_0_0_1.5px_var(--color-ink-600)] group-hover:shadow-[inset_0_0_0_1.5px_var(--color-ink-950)]'
          }`}
          aria-hidden
        >
          {on ? (
            <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8.5l3 3 7-7" />
            </svg>
          ) : null}
        </span>
      ) : null}
      <span
        className={`relative h-4 w-1 shrink-0 -skew-x-[20deg] transition-colors ${
          on ? 'bg-accent-strong' : swatch ?? 'bg-ink-700 group-hover:bg-ink-950'
        }`}
        aria-hidden
      />
      <span className="display relative flex-1 text-[1.15rem]">{children}</span>
      {hint ? (
        <span className={`relative stat-figure text-[10px] ${on ? 'text-ink-700' : 'text-ink-600 group-hover:text-ink-800'}`}>
          {hint}
        </span>
      ) : null}
      {count !== undefined ? (
        <span className={`relative stat-figure text-xs ${empty ? 'text-ink-700' : on ? 'text-ink-700' : 'text-ink-500 group-hover:text-ink-800'}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

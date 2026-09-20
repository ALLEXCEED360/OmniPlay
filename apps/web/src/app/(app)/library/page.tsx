import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { EmptyState, PageHeader } from '@/components/ui';
import { LibraryFilters, type LibraryFacets } from '@/components/library-filters';
import {
  LibraryGrid,
  LibraryList,
  type LibraryGame,
  type LibrarySort,
} from '@/components/library-view';

/**
 * The universal library (spec 4.1, 16).
 *
 * Filtering, sorting and the choice of view all happen through the query
 * string, so any state the reader can see is a URL they can bookmark, share
 * and step back through with the browser's own button.
 */

interface LibraryResponse {
  total: number;
  page: number;
  pageCount: number;
  facets: LibraryFacets;
  games: LibraryGame[];
}

const SORTS: LibrarySort[] = ['name', 'rating', 'release', 'recent'];

/** How each sort describes the order it produces, for the results line. */
const SORT_DESCRIPTION: Record<LibrarySort, string> = {
  name: 'A to Z',
  rating: 'Highest critic score first',
  release: 'Newest release first',
  recent: 'Most recently played first',
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const key of ['search', 'providers', 'statuses', 'ownership', 'sort', 'page'] as const) {
    const value = params[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }

  const data = await apiFetch<LibraryResponse>(`/library?${query.toString()}`);
  const currentPage = data.page;

  const sortParam = params.sort;
  const sort: LibrarySort =
    typeof sortParam === 'string' && (SORTS as string[]).includes(sortParam)
      ? (sortParam as LibrarySort)
      : 'name';

  const view = params.view === 'list' ? 'list' : 'grid';

  // Carried through pagination: paging out of list view and back into the
  // grid would undo a choice the reader made two clicks ago.
  const linkParams = new URLSearchParams(query);
  if (view === 'list') linkParams.set('view', 'list');

  // The reader is looking at a subset whenever any filter is on, and the
  // header should say so rather than printing a bare number they have to
  // reconcile with the library size they remember.
  const filtered = data.total !== data.facets.total;

  return (
    <>
      <PageHeader
        eyebrow="Everything you own and everything you played"
        title="Library"
        subtitle={`${data.facets.total.toLocaleString()} games across every platform you have connected.`}
      />

      {/* The deck to the left, the shelf to the right. On a wide screen the
          deck is a menu standing beside the collection, the way a game's
          filter panel stands beside its inventory; the shelf takes the rest. */}
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8 2xl:grid-cols-[19rem_minmax(0,1fr)]">
        <LibraryFilters facets={data.facets} />

        <div className="min-w-0">
          {/* The results line: what is on the shelf and how it is ordered,
              in the display cut, so the answer to "what am I looking at"
              is the loudest thing above the covers. */}
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 className="display flex items-baseline gap-3 text-[1.75rem] text-ink-100">
              <span className="slash self-center" aria-hidden />
              <span>
                {data.total.toLocaleString()}{' '}
                <span className="text-ink-400">{data.total === 1 ? 'game' : 'games'}</span>
              </span>
              {filtered ? (
                <span className="stat-figure text-sm font-normal normal-case tracking-normal text-ink-500">
                  of {data.facets.total.toLocaleString()}
                </span>
              ) : null}
            </h2>
            <span className="stat-figure text-xs text-ink-500">
              {SORT_DESCRIPTION[sort]}
              {data.pageCount > 1 ? ` · page ${currentPage} of ${data.pageCount}` : ''}
            </span>
          </div>

          {data.games.length === 0 ? (
            <EmptyState
              title="Nothing matches those filters"
              description="Try clearing a filter, or sync your accounts to bring in more of your history."
              action={
                <Link href="/library" className="btn-ghost">
                  Clear filters
                </Link>
              }
            />
          ) : view === 'list' ? (
            <LibraryList games={data.games} sort={sort} />
          ) : (
            <LibraryGrid games={data.games} sort={sort} />
          )}

      {data.pageCount > 1 ? (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
          <PageLink params={linkParams} page={currentPage - 1} disabled={currentPage <= 1}>
            Previous
          </PageLink>
          <span className="stat-figure px-3 text-sm text-ink-400">
            {currentPage} of {data.pageCount}
          </span>
          <PageLink params={linkParams} page={currentPage + 1} disabled={currentPage >= data.pageCount}>
            Next
          </PageLink>
        </nav>
      ) : null}
        </div>
      </div>
    </>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: URLSearchParams;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="btn-ghost cursor-not-allowed opacity-40">{children}</span>
    );
  }

  const next = new URLSearchParams(params);
  next.set('page', String(page));

  return (
    <Link href={`/library?${next.toString()}`} className="btn-ghost">
      {children}
    </Link>
  );
}

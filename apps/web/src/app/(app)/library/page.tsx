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
  rating: 'highest critic score first',
  release: 'newest release first',
  recent: 'most recently played first',
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
        subtitle={
          filtered
            ? `${data.total.toLocaleString()} of ${data.facets.total.toLocaleString()} games match, ${SORT_DESCRIPTION[sort]}.`
            : `${data.total.toLocaleString()} ${data.total === 1 ? 'game' : 'games'} across every platform you have connected, ${SORT_DESCRIPTION[sort]}.`
        }
      />

      <LibraryFilters facets={data.facets} />

      {data.games.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing matches those filters"
            description="Try clearing a filter, or sync your accounts to bring in more of your history."
            action={
              <Link href="/library" className="btn-ghost">
                Clear filters
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-6">
          {view === 'list' ? (
            <LibraryList games={data.games} sort={sort} />
          ) : (
            <LibraryGrid games={data.games} sort={sort} />
          )}
        </div>
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
      <span className="cursor-not-allowed rounded-lg border border-ink-850 px-4 py-2 text-sm text-ink-600">
        {children}
      </span>
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

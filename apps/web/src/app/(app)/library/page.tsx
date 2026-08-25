import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { EmptyState, GameCard, PageHeader } from '@/components/ui';
import { LibraryFilters } from '@/components/library-filters';

/**
 * The universal library (spec 4.1, 16).
 *
 * Filtering happens on the server through the query string, so a filtered view
 * is a shareable, bookmarkable URL and the browser's back button does the
 * right thing.
 */

interface LibraryResponse {
  total: number;
  page: number;
  pageCount: number;
  games: Array<{
    id: string;
    name: string;
    slug: string;
    coverImage: string | null;
    providers: string[];
    owned: boolean;
    status: string;
    totalMinutes: number;
  }>;
}

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

  return (
    <>
      <PageHeader
        title="Library"
        subtitle={`${data.total.toLocaleString()} ${data.total === 1 ? 'game' : 'games'}`}
      />

      <LibraryFilters />

      {data.games.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing matches those filters"
            description="Try clearing a filter, or sync your accounts to bring in more of your history."
            action={
              <Link
                href="/library"
                className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 transition-colors hover:bg-ink-850"
              >
                Clear filters
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {data.games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}

      {data.pageCount > 1 ? (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
          <PageLink params={query} page={currentPage - 1} disabled={currentPage <= 1}>
            Previous
          </PageLink>
          <span className="stat-figure px-3 text-sm text-ink-400">
            {currentPage} of {data.pageCount}
          </span>
          <PageLink
            params={query}
            page={currentPage + 1}
            disabled={currentPage >= data.pageCount}
          >
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
    <Link
      href={`/library?${next.toString()}`}
      className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 transition-colors hover:bg-ink-850"
    >
      {children}
    </Link>
  );
}

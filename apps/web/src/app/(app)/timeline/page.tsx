import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatDate, providerLabel } from '@/lib/format';
import { EmptyState, PageHeader } from '@/components/ui';
import { TimelineFilters } from '@/components/timeline-filters';
import { EVENT_KINDS, kindsOf, type EventKind, type TimelineEntry } from '@/lib/timeline';

/**
 * The gaming timeline (spec 4.3).
 *
 * One row per game per day, listing everything that happened to it — a session
 * that unlocked ten achievements is one evening, not eleven entries.
 *
 * Only events that can honestly be placed in time appear. A Steam lifetime
 * total has no date, and pinning it to the day we happened to sync would
 * fabricate history, so it is absent and the empty state says why.
 */

interface TimelineYear {
  year: number;
  entries: TimelineEntry[];
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const years = await apiFetch<TimelineYear[]>('/stats/timeline');

  const asList = (value: string | string[] | undefined): string[] =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : [];

  const activeKinds = asList(params.kinds);
  const activeProviders = asList(params.providers);

  // Counts come from the unfiltered set so a chip always shows how much it
  // would bring back, not how much is currently visible.
  const counts = { played: 0, achievements: 0, acquired: 0, completed: 0 } as Record<
    EventKind,
    number
  >;
  const providers = new Set<string>();

  for (const year of years) {
    for (const entry of year.entries) {
      for (const kind of kindsOf(entry)) counts[kind] += 1;
      if (entry.provider) providers.add(entry.provider);
    }
  }

  const visible = years
    .map((year) => ({
      year: year.year,
      entries: year.entries.filter((entry) => {
        const kinds = kindsOf(entry);
        const kindOk =
          activeKinds.length === 0 || kinds.some((kind) => activeKinds.includes(kind));
        const providerOk =
          activeProviders.length === 0 ||
          (entry.provider !== null && activeProviders.includes(entry.provider));
        return kindOk && providerOk;
      }),
    }))
    .filter((year) => year.entries.length > 0);

  const totalVisible = visible.reduce((sum, year) => sum + year.entries.length, 0);
  const isFiltered = activeKinds.length > 0 || activeProviders.length > 0;

  if (years.length === 0) {
    return (
      <>
        <PageHeader title="Timeline" subtitle="Your gaming life, in order." />
        <EmptyState
          title="No dated history yet"
          description="Your connected platforms report total playtime without saying when those hours happened. Achievement unlocks are dated, so they will appear here as you earn them."
          action={
            <Link
              href="/settings"
              className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 transition-colors hover:bg-ink-850"
            >
              Connect another account
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Timeline"
        subtitle={
          isFiltered
            ? `${totalVisible} of ${counts.played + counts.achievements + counts.acquired + counts.completed} entries`
            : `${visible.length} ${visible.length === 1 ? 'year' : 'years'} of recorded activity`
        }
      />

      <TimelineFilters providers={[...providers].sort()} counts={counts} />

      {totalVisible === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Try turning another kind of event back on."
        />
      ) : (
        <div className="space-y-12">
          {visible.map((year) => (
            <section key={year.year}>
              <h2 className="stat-figure mb-5 text-2xl text-ink-100">{year.year}</h2>

              <ol className="relative space-y-4 border-l border-ink-850 pl-6">
                {year.entries.slice(0, 60).map((entry, index) => (
                  <li key={`${entry.game.slug}-${entry.date}-${index}`} className="relative">
                    {/* The dot takes the colour of the entry's most notable
                        kind, so a scan down the rail still reads as a legend. */}
                    <span
                      className={`absolute -left-[1.9rem] top-2 size-2 rounded-full ring-4 ring-ink-950 ${
                        EVENT_KINDS.find((kind) => kindsOf(entry).includes(kind.id))?.dot ??
                        'bg-ink-700'
                      }`}
                      aria-hidden
                    />

                    <div className="card flex items-center gap-4 p-3">
                      {entry.game.coverImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.game.coverImage}
                          alt=""
                          loading="lazy"
                          className="hidden h-14 w-10 shrink-0 rounded object-cover sm:block"
                        />
                      ) : null}

                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/game/${entry.game.slug}`}
                          className="block truncate text-sm font-medium text-ink-100 hover:text-accent"
                        >
                          {entry.game.name}
                        </Link>
                        <div className="mt-0.5 text-xs text-ink-500">
                          {describe(entry)}
                          {entry.provider ? ` on ${providerLabel(entry.provider)}` : ''} ·{' '}
                          {formatDate(entry.date)}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              {year.entries.length > 60 ? (
                <p className="mt-4 pl-6 text-xs text-ink-600">
                  and {year.entries.length - 60} more in {year.year}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Everything that happened to one game on one day, as a single phrase. */
function describe(entry: TimelineEntry): string {
  const parts: string[] = [];

  if (entry.acquired) parts.push('Added');
  if (entry.completed) parts.push('Completed');
  if (entry.achievements > 0) {
    parts.push(
      `${entry.achievements} achievement${entry.achievements === 1 ? '' : 's'} unlocked`,
    );
  }
  // "Played" is implied by an unlock, so it is only worth saying on its own.
  if (entry.played && parts.length === 0) parts.push('Played');

  return parts.join(' · ');
}

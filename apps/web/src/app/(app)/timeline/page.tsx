import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatDate, providerLabel } from '@/lib/format';
import { EmptyState, PageHeader } from '@/components/ui';

/**
 * The gaming timeline (spec 4.3).
 *
 * Only events that can honestly be placed in time appear here. A Steam
 * lifetime total has no date attached, and pinning it to the day we happened
 * to sync would fabricate history - so it is absent, and the empty state says
 * why rather than looking like a bug.
 */

interface TimelineYear {
  year: number;
  events: Array<{
    date: string;
    type: 'played' | 'acquired' | 'completed';
    provider: string | null;
    game: { name: string; slug: string; coverImage: string | null };
  }>;
}

const EVENT_STYLES: Record<string, { label: string; dot: string }> = {
  played: { label: 'Played', dot: 'bg-accent' },
  acquired: { label: 'Added', dot: 'bg-violet' },
  completed: { label: 'Completed', dot: 'bg-positive' },
};

export default async function TimelinePage() {
  const years = await apiFetch<TimelineYear[]>('/stats/timeline');

  if (years.length === 0) {
    return (
      <>
        <PageHeader title="Timeline" subtitle="Your gaming life, in order." />
        <EmptyState
          title="No dated history yet"
          description="Your connected platforms report total playtime without saying when those hours happened. As achievements unlock and new games arrive, dated events will appear here."
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
        subtitle={`${years.length} ${years.length === 1 ? 'year' : 'years'} of recorded activity`}
      />

      <div className="space-y-12">
        {years.map((year) => (
          <section key={year.year}>
            <h2 className="stat-figure mb-5 text-2xl text-ink-100">{year.year}</h2>

            <ol className="relative space-y-4 border-l border-ink-850 pl-6">
              {year.events.slice(0, 60).map((event, index) => {
                const style = EVENT_STYLES[event.type] ?? EVENT_STYLES.played!;
                return (
                  <li key={`${event.game.slug}-${event.type}-${index}`} className="relative">
                    <span
                      className={`absolute -left-[1.9rem] top-2 size-2 rounded-full ring-4 ring-ink-950 ${style.dot}`}
                      aria-hidden
                    />
                    <div className="card flex items-center gap-4 p-3">
                      {event.game.coverImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={event.game.coverImage}
                          alt=""
                          className="hidden h-14 w-10 shrink-0 rounded object-cover sm:block"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/game/${event.game.slug}`}
                          className="block truncate text-sm font-medium text-ink-100 hover:text-accent"
                        >
                          {event.game.name}
                        </Link>
                        <div className="mt-0.5 text-xs text-ink-500">
                          {style.label}
                          {event.provider ? ` on ${providerLabel(event.provider)}` : ''} ·{' '}
                          {formatDate(event.date)}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {year.events.length > 60 ? (
              <p className="mt-4 pl-6 text-xs text-ink-600">
                and {year.events.length - 60} more events in {year.year}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}

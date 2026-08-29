import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { platformStyle, staggerStep } from '@/lib/platform';
import type { CSSProperties } from 'react';
import { formatHours, providerLabel } from '@/lib/format';
import {
  ConfidenceNote,
  EmptyState,
  PageHeader,
  PlatformBadge,
  StatCard,
} from '@/components/ui';

/**
 * The whole library, ranked by playtime.
 *
 * The dashboard's top five is a teaser; this is the answer. Ranking every game
 * is what makes the long tail visible — the hundred titles between "most
 * played" and "never started" are most of a library, and a leaderboard of five
 * says nothing about them.
 *
 * Games with no recorded time are listed rather than hidden. An absent figure
 * usually means the platform did not report one, not that the game was never
 * launched, and dropping those rows would quietly assert the opposite.
 */

interface PlaytimeRanking {
  totalMinutes: number;
  byProvider: Record<string, number>;
  games: Array<{
    id: string;
    name: string;
    slug: string;
    coverImage: string | null;
    minutes: number;
    providers: string[];
  }>;
  withoutPlaytime: number;
}

export default async function MostPlayedPage() {
  const data = await apiFetch<PlaytimeRanking>('/stats/playtime');

  const played = data.games.filter((game) => game.minutes > 0);
  const unplayed = data.games.filter((game) => game.minutes === 0);
  const top = played[0]?.minutes ?? 1;

  if (data.games.length === 0) {
    return (
      <>
        <PageHeader title="Most played" subtitle="Every game, ranked by hours." />
        <EmptyState
          title="No playtime recorded yet"
          description="Connect a platform and run a sync — playtime arrives with your library."
        />
      </>
    );
  }

  // The median says more about a library than the mean, which a single
  // 600-hour game drags upward on its own.
  const median =
    played.length > 0 ? (played[Math.floor(played.length / 2)]?.minutes ?? 0) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Ranked by recorded hours"
        title="Most played"
        subtitle="Every game in your library, longest first."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total" value={formatHours(data.totalMinutes)} accent index={0} />
        <StatCard
          label="Games with hours"
          value={played.length}
          hint={`of ${data.games.length}`}
          index={1}
        />
        <StatCard label="Longest" value={formatHours(top)} hint={played[0]?.name} index={2} />
        <StatCard label="Median" value={formatHours(median)} hint="of games with hours" index={3} />
      </div>

      <ol
        className="card anim-rise mt-8 divide-y divide-ink-850"
        style={{ '--stagger-step': staggerStep(played.length) } as CSSProperties}
      >
        {played.map((game, index) => (
          <li key={game.id} className="anim-fade stagger" style={{ '--i': index } as CSSProperties}>
            <Link
              href={`/game/${game.slug}`}
              className="group flex items-center gap-4 p-3 transition-colors hover:bg-ink-850/40"
            >
              <span className="stat-figure w-8 shrink-0 text-right text-xs text-ink-600 transition-colors group-hover:text-accent">
                {index + 1}
              </span>

              {game.coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={game.coverImage}
                  alt=""
                  loading="lazy"
                  className="h-14 w-10 shrink-0 rounded object-cover transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                <span className="h-14 w-10 shrink-0 rounded bg-ink-850" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-ink-100 transition-colors group-hover:text-accent">
                    {game.name}
                  </span>
                  <span className="stat-figure shrink-0 text-sm text-ink-200">
                    {formatHours(game.minutes)}
                  </span>
                </div>

                {/* Scaled against the longest game, so the shape of the tail
                    is visible rather than every bar reading as full. */}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-850">
                  <div
                    className={`anim-grow stagger h-full rounded-full ${
                      game.providers[0] ? platformStyle(game.providers[0]).bar : 'bg-accent'
                    }`}
                    style={
                      { width: `${Math.max(1, (game.minutes / top) * 100)}%`, '--i': index } as CSSProperties
                    }
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {game.providers.map((provider) => (
                    <PlatformBadge key={provider} provider={provider} small />
                  ))}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ol>

      {unplayed.length > 0 ? (
        <section className="anim-rise mt-10">
          <h2 className="mb-3 text-sm font-medium text-ink-300">
            {unplayed.length} {unplayed.length === 1 ? 'game' : 'games'} with no recorded hours
          </h2>

          <div className="card flex flex-wrap gap-x-4 gap-y-1.5 p-4">
            {unplayed.map((game) => (
              <Link
                key={game.id}
                href={`/game/${game.slug}`}
                className="truncate text-xs text-ink-500 transition-colors hover:text-accent"
              >
                {game.name}
                <span className="ml-1.5 text-ink-600">
                  {game.providers.map((provider) => providerLabel(provider)).join(', ')}
                </span>
              </Link>
            ))}
          </div>

          <p className="mt-4">
            <ConfidenceNote>
              No recorded hours is not the same as never played. Steam reports playtime for
              every game it sells you, so a zero there is real — but Xbox reports it only for
              titles that answer a separate stats call, and a game may simply never have been
              asked about.
            </ConfidenceNote>
          </p>
        </section>
      ) : null}
    </>
  );
}

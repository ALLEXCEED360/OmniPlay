import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatHours, providerLabel } from '@/lib/format';
import { ConfidenceNote, PageHeader, SectionHeading } from '@/components/ui';
import { Counter } from '@/components/counter';
import { platformStyle } from '@/lib/platform';
import type { CSSProperties } from 'react';

interface Overview {
  library: {
    totalGames: number;
    currentlyOwned: number;
    previouslyOwned: number;
    gamesPlayed: number;
    completed: number;
    backlog: number;
    completionRate: number;
    gamesByProvider: Record<string, number>;
  };
  playtime: {
    totalMinutes: number;
    byProvider: Record<string, number>;
    unattributedMinutes: number;
  };
  activityByYear: Array<{
    year: number;
    activeDays: number;
    games: number;
    unlocks: number;
    started: number;
    finished: number;
  }>;
  genres: Array<{ genre: string; games: number; minutes: number }>;
  unlocks: { unlocked: number; years: number; first: string | null; last: string | null };
  crossPlatform: Array<{ name: string; slug: string; providers: string[]; minutes: number }>;
}

export default async function StatsPage() {
  const data = await apiFetch<Overview>('/stats/overview');

  const years = data.activityByYear.slice().sort((a, b) => b.year - a.year);
  const platforms = [
    ...new Set([
      ...Object.keys(data.library.gamesByProvider),
      ...Object.keys(data.playtime.byProvider),
    ]),
  ]
    .map((provider) => ({
      provider,
      games: data.library.gamesByProvider[provider] ?? 0,
      minutes: data.playtime.byProvider[provider] ?? 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  const topGenre = data.genres[0];
  const genrePeak = topGenre?.minutes || 1;
  const busiest = years.reduce(
    (top, year) => (!top || year.activeDays > top.activeDays ? year : top),
    years[0],
  );
  const activeDays = years.reduce((sum, year) => sum + year.activeDays, 0);
  const maxDays = Math.max(...years.map((year) => year.activeDays), 1);
  const span = years.length > 0 ? `${years[years.length - 1]?.year}–${years[0]?.year}` : '—';

  return (
    <>
      <PageHeader
        eyebrow="The shape of a decade"
        title="Statistics"
        subtitle={`What ${years.length} years of playing adds up to.`}
      />

      <section className="card bloom anim-rise overflow-hidden p-0">
        <div className="grid gap-px bg-ink-850 sm:grid-cols-4">
          {(
            [
              { label: 'Hours', count: data.playtime.totalMinutes, kind: 'hours' as const, hint: span },
              {
                label: 'Games played',
                count: data.library.gamesPlayed,
                kind: 'count' as const,
                hint: `of ${data.library.totalGames} in library`,
              },
              {
                label: 'Achievements',
                count: data.unlocks.unlocked,
                kind: 'count' as const,
                hint: `${data.library.completed} games complete`,
              },
              {
                // A year is a label, not a quantity — counting up to 2023
                // from zero would be nonsense, so this one stays still.
                label: 'Busiest year',
                text: busiest ? String(busiest.year) : '—',
                hint: busiest ? `${busiest.activeDays} active days` : '',
              },
            ]
          ).map((stat, index) => (
            <div
              key={stat.label}
              style={{ '--i': index + 1 } as CSSProperties}
              className="anim-rise stagger group relative bg-ink-900 p-5 transition-colors hover:bg-ink-850/60"
            >
              <div className="eyebrow text-ink-500">{stat.label}</div>
              <div
                className={`stat-figure mt-1.5 text-3xl sm:text-[2rem] ${
                  index === 0 ? 'text-accent' : 'text-ink-100'
                }`}
              >
                {stat.text ?? <Counter value={stat.count ?? 0} kind={stat.kind} />}
              </div>
              <div className="mt-1 text-[11px] text-ink-600">{stat.hint}</div>
              <span
                className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-accent/50 transition-transform duration-300 group-hover:scale-x-100"
                aria-hidden
              />
            </div>
          ))}
        </div>
      </section>

      {/* Gaming DNA, over everything rather than this year.
          Weighted by time so one 200-hour RPG outranks twelve unplayed
          platformers — which is the whole point of asking what kind of player
          someone is. */}
      {data.genres.length > 0 ? (
        <section className="anim-rise mt-10">
          <SectionHeading>Gaming DNA</SectionHeading>

          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div className="card anim-rise p-6">
              <ol className="space-y-3.5">
                {data.genres.map((genre, index) => {
                  const share = genre.minutes / genrePeak;
                  return (
                    <li
                      key={genre.genre}
                      style={{ '--i': index, '--stagger-step': '60ms' } as CSSProperties}
                      className="group anim-rise stagger"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="stat-figure w-4 shrink-0 text-[11px] text-ink-600">
                            {index + 1}
                          </span>
                          <span className="truncate text-sm text-ink-100 transition-colors group-hover:text-accent">
                            {genre.genre}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-600">
                            {genre.games} games
                          </span>
                        </span>
                        <span className="stat-figure shrink-0 text-sm text-ink-200">
                          {formatHours(genre.minutes)}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-850">
                        <div
                          className="anim-grow stagger h-full rounded-full bg-gradient-to-r from-violet/60 via-accent/60 to-accent"
                          style={
                            {
                              width: `${Math.max(2, share * 100)}%`,
                              '--i': index,
                              '--stagger-step': '60ms',
                            } as CSSProperties
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="space-y-4">
              {topGenre ? (
        <div className="card bloom anim-rise relative p-6">
                  <div className="relative">
                    <div className="eyebrow text-ink-500">Most of your time</div>
                    <div className="shimmer stat-figure mt-1 inline-block rounded text-3xl text-accent">
                      {topGenre.genre}
                    </div>
                    <p className="mt-2 text-sm text-ink-400">
                      {formatHours(topGenre.minutes)} across {topGenre.games} games —{' '}
                      {Math.round((topGenre.minutes / (data.playtime.totalMinutes || 1)) * 100)}%
                      of everything you have played.
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="card anim-rise p-6">
                <div className="eyebrow text-ink-500">Library</div>
                <dl className="mt-3 space-y-2.5">
                  {(
                    [
                      ['Owned now', data.library.currentlyOwned],
                      ['Previously owned', data.library.previouslyOwned],
                      ['Never started', data.library.backlog],
                      ['Complete', data.library.completed],
                    ] as const
                  ).map(([label, value], index) => (
                    <div
                      key={label}
                      style={{ '--i': index, '--stagger-step': '55ms' } as CSSProperties}
                      className="anim-fade stagger flex items-baseline justify-between gap-3"
                    >
                      <dt className="text-sm text-ink-400">{label}</dt>
                      <dd className="stat-figure text-sm text-ink-100">
                        <Counter value={value} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>

          <p className="mt-4">
            <ConfidenceNote>
              Genres come from IGDB and are weighted by recorded hours, not by how many games
              carry the label. Deterministic throughout — there is no model here.
            </ConfidenceNote>
          </p>
        </section>
      ) : null}

      <section className="anim-rise mt-10">
        <SectionHeading
          action={
            <Link
              href="/timeline"
              className="shrink-0 text-xs font-normal normal-case tracking-normal text-ink-500 transition-colors hover:text-accent"
            >
              Open timeline &rarr;
            </Link>
          }
        >
          Year by year
        </SectionHeading>

        {/* Everything the data can honestly date, one row per year. No hours
            column: a lifetime total says how long a game was played, never how
            much of it fell inside a given twelve months. */}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-850 text-[11px] uppercase tracking-wider text-ink-600">
                <th scope="col" className="px-4 py-3 text-left font-medium">Year</th>
                <th scope="col" className="px-4 py-3 text-left font-medium">Active days</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Games</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Unlocks</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Started</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Finished</th>
              </tr>
            </thead>
            <tbody>
              {years.map((year, index) => (
                <tr
                  key={year.year}
                  style={{ '--i': index, '--stagger-step': '45ms' } as CSSProperties}
                  className="anim-fade stagger border-b border-ink-850/60 transition-colors last:border-0 hover:bg-ink-850/40"
                >
                  <th scope="row" className="stat-figure px-4 py-2.5 text-left text-ink-100">
                    {year.year}
                  </th>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-850">
                        <span
                          className="anim-grow stagger block h-full rounded-full bg-gradient-to-r from-violet/60 via-accent/60 to-accent"
                          style={
                            {
                              width: `${Math.max(3, (year.activeDays / maxDays) * 100)}%`,
                              '--i': index,
                              '--stagger-step': '45ms',
                            } as CSSProperties
                          }
                        />
                      </span>
                      <span className="stat-figure w-8 shrink-0 text-right text-xs text-ink-300">
                        {year.activeDays}
                      </span>
                    </div>
                  </td>
                  <td className="stat-figure px-4 py-2.5 text-right text-ink-300">{year.games}</td>
                  <td className="stat-figure px-4 py-2.5 text-right text-ink-300">
                    {year.unlocks.toLocaleString()}
                  </td>
                  <td
                    className={`stat-figure px-4 py-2.5 text-right ${
                      year.started > 0 ? 'text-violet' : 'text-ink-600'
                    }`}
                  >
                    {year.started || '—'}
                  </td>
                  <td
                    className={`stat-figure px-4 py-2.5 text-right ${
                      year.finished > 0 ? 'text-positive' : 'text-ink-600'
                    }`}
                  >
                    {year.finished || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink-850 text-ink-400">
                <th scope="row" className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider">
                  Total
                </th>
                <td className="stat-figure px-4 py-2.5 text-xs">{activeDays.toLocaleString()}</td>
                <td />
                <td className="stat-figure px-4 py-2.5 text-right text-xs">
                  {data.unlocks.unlocked.toLocaleString()}
                </td>
                <td />
                <td className="stat-figure px-4 py-2.5 text-right text-xs">
                  {years.reduce((sum, year) => sum + year.finished, 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="mt-4">
          <ConfidenceNote>
            No hours column, deliberately.{' '}
            {formatHours(data.playtime.unattributedMinutes)} of playtime carries no date at all —
            a lifetime total says how long a game was played, never how much of it fell inside a
            given twelve months, and splitting it would be inventing a distribution.
          </ConfidenceNote>
        </p>
      </section>

      <section className="anim-rise mt-10">
        <SectionHeading>Platforms compared</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-3">
          {platforms.map((platform, index) => {
            const style = platformStyle(platform.provider);
            const share = platform.minutes / (data.playtime.totalMinutes || 1);
            return (
              <div
                key={platform.provider}
                style={{ '--i': index, '--bloom': style.bloom } as CSSProperties}
        className={`card bloom anim-rise stagger relative p-5 ring-1 ${style.ring}`}
              >
                <div className="relative">
                  <h3 className={`text-sm font-semibold ${style.text}`}>
                    {providerLabel(platform.provider)}
                  </h3>
                  <div className="stat-figure mt-2 text-3xl text-ink-100">
                    <Counter value={platform.minutes} kind="hours" />
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-850">
                    <div
                      className={`anim-grow stagger h-full rounded-full ${style.bar}`}
                      style={
                        {
                          width: `${Math.max(2, share * 100)}%`,
                          '--i': index,
                          '--stagger-step': '110ms',
                        } as CSSProperties
                      }
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-600">
                    {Math.round(share * 100)}% of your hours · {platform.games} games
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

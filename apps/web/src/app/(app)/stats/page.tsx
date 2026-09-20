import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatHours, providerLabel } from '@/lib/format';
import { ConfidenceNote, PageHeader, SectionHeading } from '@/components/ui';
import { Counter } from '@/components/counter';
import { PlatformPanel } from '@/components/platform-panel';
import { platformStyle } from '@/lib/platform';
import { playerRanks } from '@/lib/ranks';
import type { CSSProperties } from 'react';

/**
 * Statistics: what a decade of playing adds up to.
 *
 * Laid out as a status screen rather than a report. The player card leads —
 * the hours set huge on paper with five ranked stats beside them, the way a
 * game's own menu sizes up a character — then the genres as a ranked
 * results list, the years as a ledger, and the platforms in their own
 * panels. Every rank on the card sits over the figure it was read from;
 * the reading is the decoration, the number is the fact.
 */

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
  crossPlatform: Array<{
    name: string;
    slug: string;
    coverImage?: string | null;
    providers: string[];
    minutes: number;
  }>;
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

  const totalMinutes = data.playtime.totalMinutes || 1;
  const topGenre = data.genres[0];
  const genrePeak = topGenre?.minutes || 1;
  const busiest = years.reduce(
    (top, year) => (!top || year.activeDays > top.activeDays ? year : top),
    years[0],
  );
  const activeDays = years.reduce((sum, year) => sum + year.activeDays, 0);
  const maxDays = Math.max(...years.map((year) => year.activeDays), 1);
  const span = years.length > 0 ? `${years[years.length - 1]?.year}–${years[0]?.year}` : null;

  const ranks = playerRanks({
    hours: data.playtime.totalMinutes / 60,
    gamesPlayed: data.library.gamesPlayed,
    completed: data.library.completed,
    unlocks: data.unlocks.unlocked,
    genresInPlay: data.genres.filter((genre) => genre.minutes / totalMinutes >= 0.02).length,
  });

  return (
    <>
      <PageHeader
        art="/backdrop/menu/statistics.jpg"
        eyebrow="The shape of a decade"
        title="Statistics"
        subtitle={`What ${years.length} years of playing adds up to.`}
      />

      {/* ── The player card: a paper plate with the hours set huge and,
          beside them, five stats ranked the way a status screen ranks a
          character. ── */}
      <div className="hard-shadow anim-rise">
        <div className="paper cut grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] lg:divide-x lg:divide-ink-950/10">
          <div className="flex flex-col justify-between gap-6 px-6 py-6 sm:px-8">
            <div>
              <div className="eyebrow text-ink-700">Hours on record</div>
              <div className="display mt-1 text-[clamp(4rem,8vw,7.5rem)] leading-none text-ink-950">
                <Counter value={data.playtime.totalMinutes} kind="hours" />
              </div>
              {span ? <div className="mt-1 text-[13px] text-ink-700">{span}, across every platform</div> : null}
            </div>

            {/* Where the hours came from, in the legend the whole app uses. */}
            <div>
              <div className="flex h-3 -skew-x-[20deg] overflow-hidden bg-ink-950/10" aria-hidden>
                {platforms.map((platform, index) => (
                  <div
                    key={platform.provider}
                    className={`anim-grow stagger h-full ${platformStyle(platform.provider).bar}`}
                    style={
                      {
                        width: `${(platform.minutes / totalMinutes) * 100}%`,
                        '--i': index,
                        '--stagger-step': '120ms',
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
                {platforms.map((platform) => (
                  <div key={platform.provider} className="flex items-center gap-1.5 text-[13px]">
                    <span className={`size-2 -skew-x-[20deg] ${platformStyle(platform.provider).bar}`} aria-hidden />
                    <dt className="text-ink-700">{providerLabel(platform.provider)}</dt>
                    <dd className="stat-figure font-semibold text-ink-950">{formatHours(platform.minutes)}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-ink-950/10 pt-4">
              <Small label="Games played" value={data.library.gamesPlayed} note={`of ${data.library.totalGames}`} />
              <Small label="Finished" value={data.library.completed} note={`${Math.round(data.library.completionRate * 100)}% of played`} />
              <Small
                label="Busiest year"
                value={busiest ? String(busiest.year) : '—'}
                note={busiest ? `${busiest.activeDays} active days` : ''}
              />
            </div>
          </div>

          {/* The five stats. Each rank is five slanted blocks, the filled
              ones in gold, with the title beside and the figure it was read
              from beneath — the reading never stands without its number. */}
          <ol className="grid content-center gap-x-8 gap-y-4 px-6 py-6 sm:grid-cols-2 sm:px-8 xl:gap-y-5">
            {ranks.map((stat, index) => (
              <li
                key={stat.id}
                className="anim-rise stagger"
                style={{ '--i': index + 1, '--stagger-step': '90ms' } as CSSProperties}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="display text-xl text-ink-950">{stat.label}</span>
                  <span className="font-display text-xs font-bold uppercase tracking-wider text-accent-strong">
                    {stat.title}
                  </span>
                </div>
                <div className="mt-1.5 flex gap-1" aria-label={`Rank ${stat.rank} of 5`}>
                  {Array.from({ length: 5 }, (_, block) => (
                    <span
                      key={block}
                      className={`anim-pop stagger h-3 flex-1 -skew-x-[20deg] ${
                        block < stat.rank ? 'bg-accent-strong' : 'bg-ink-950/10'
                      }`}
                      style={{ '--i': index * 5 + block, '--stagger-step': '35ms' } as CSSProperties}
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex items-baseline gap-1.5 text-[12px] text-ink-700">
                  <span className="stat-figure font-semibold text-ink-950">{stat.figure}</span>
                  {stat.basis}
                </div>
              </li>
            ))}
            <li className="self-end text-[11px] leading-snug text-ink-700 sm:col-span-2">
              Ranks are fixed steps read from your own figures — nobody else&rsquo;s play moves
              them.
            </li>
          </ol>
        </div>
      </div>

      {/* ── Gaming DNA, over everything rather than this year. Weighted by
          time so one 200-hour RPG outranks twelve unplayed platformers —
          which is the whole point of asking what kind of player someone
          is. Laid out as a results list: the rank in an ink block, the
          genre in display type, the bar in gold. ── */}
      {data.genres.length > 0 ? (
        <section className="anim-rise mt-10">
          <SectionHeading>Gaming DNA</SectionHeading>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="card hud-corners p-6">
              <ol className="space-y-3">
                {data.genres.map((genre, index) => {
                  const share = genre.minutes / genrePeak;
                  const ofAll = genre.minutes / totalMinutes;
                  return (
                    <li
                      key={genre.genre}
                      style={{ '--i': index, '--stagger-step': '60ms' } as CSSProperties}
                      className="group anim-rise stagger flex items-center gap-4"
                    >
                      <span
                        className={`display flex h-10 w-10 shrink-0 -skew-x-[14deg] items-center justify-center text-lg ${
                          index === 0 ? 'bg-accent text-ink-950' : 'bg-ink-850 text-ink-300'
                        }`}
                      >
                        <span className="skew-x-[14deg]">{index + 1}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="display truncate text-lg text-ink-100 transition-colors group-hover:text-accent">
                            {genre.genre}
                          </span>
                          <span className="flex shrink-0 items-baseline gap-2">
                            <span className="text-[11px] text-ink-500">{genre.games} games</span>
                            <span className="stat-figure text-sm text-ink-100">{formatHours(genre.minutes)}</span>
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-2 flex-1 -skew-x-[20deg] overflow-hidden bg-ink-850">
                            <div
                              className={`anim-grow stagger h-full ${index === 0 ? 'bg-accent' : 'bg-ink-400'}`}
                              style={
                                {
                                  width: `${Math.max(2, share * 100)}%`,
                                  '--i': index,
                                  '--stagger-step': '60ms',
                                } as CSSProperties
                              }
                            />
                          </div>
                          <span className="stat-figure w-9 shrink-0 text-right text-[11px] text-ink-500">
                            {Math.round(ofAll * 100)}%
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="space-y-4">
              {topGenre ? (
                <div className="hard-shadow">
                  <div className="paper cut p-6">
                    <div className="eyebrow text-ink-700">Most of your time</div>
                    <div className="display mt-1 text-[clamp(2rem,3vw,2.75rem)] leading-none text-ink-950">
                      {topGenre.genre}
                    </div>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="display text-4xl text-accent-strong">
                        {Math.round((topGenre.minutes / totalMinutes) * 100)}%
                      </span>
                      <span className="text-[13px] text-ink-700">of everything you have played</span>
                    </div>
                    <p className="mt-2 text-[13px] text-ink-700">
                      {formatHours(topGenre.minutes)} across {topGenre.games} games.
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="card hud-corners p-6">
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
                      className="anim-fade stagger flex items-baseline justify-between gap-3 border-b border-ink-850 pb-2 last:border-0 last:pb-0"
                    >
                      <dt className="text-sm text-ink-400">{label}</dt>
                      <dd className="display text-xl text-ink-100">
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

      {/* ── Year by year: a ledger. Everything the data can honestly date,
          one row per year. No hours column: a lifetime total says how
          long a game was played, never how much of it fell inside a given
          twelve months. ── */}
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

        <div className="card hud-corners overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-accent font-display text-[11px] font-bold uppercase tracking-wider text-ink-950">
                <th scope="col" className="px-4 py-2.5 text-left">Year</th>
                <th scope="col" className="px-4 py-2.5 text-left">Active days</th>
                <th scope="col" className="px-4 py-2.5 text-right">Games</th>
                <th scope="col" className="px-4 py-2.5 text-right">Unlocks</th>
                <th scope="col" className="px-4 py-2.5 text-right">Started</th>
                <th scope="col" className="px-4 py-2.5 text-right">Finished</th>
              </tr>
            </thead>
            <tbody>
              {years.map((year, index) => (
                <tr
                  key={year.year}
                  style={{ '--i': index, '--stagger-step': '45ms' } as CSSProperties}
                  className={`anim-fade stagger border-b border-ink-850/60 transition-colors last:border-0 hover:bg-ink-850/40 ${
                    busiest && year.year === busiest.year ? 'bg-accent/[0.06]' : ''
                  }`}
                >
                  <th scope="row" className="display px-4 py-2.5 text-left text-xl text-ink-100">
                    {year.year}
                    {busiest && year.year === busiest.year ? (
                      <span className="ml-2 align-middle font-display text-[10px] font-bold uppercase tracking-wider text-accent">
                        Busiest
                      </span>
                    ) : null}
                  </th>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2 flex-1 -skew-x-[20deg] overflow-hidden bg-ink-850">
                        <span
                          className="anim-grow stagger block h-full bg-accent"
                          style={
                            {
                              width: `${Math.max(3, (year.activeDays / maxDays) * 100)}%`,
                              '--i': index,
                              '--stagger-step': '45ms',
                            } as CSSProperties
                          }
                        />
                      </span>
                      <span className="stat-figure w-8 shrink-0 text-right text-xs text-ink-200">
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
              <tr className="border-t border-ink-700 text-ink-300">
                <th scope="row" className="px-4 py-2.5 text-left font-display text-[11px] font-bold uppercase tracking-wider">
                  Total
                </th>
                <td className="stat-figure px-4 py-2.5 text-xs">{activeDays.toLocaleString()} days</td>
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

      {/* ── Platforms compared, each in its own identity panel. ── */}
      <section className="anim-rise mt-10">
        <SectionHeading>Platforms compared</SectionHeading>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {platforms.map((platform, index) => {
            const style = platformStyle(platform.provider);
            const share = platform.minutes / totalMinutes;
            return (
              <PlatformPanel
                key={platform.provider}
                provider={platform.provider}
                index={index}
                aside={`${platform.games} games`}
              >
                <div className="eyebrow text-ink-500">Hours</div>
                <div className={`display mt-1 text-[2.6rem] leading-none ${style.text}`}>
                  <Counter value={platform.minutes} kind="hours" />
                </div>
                <div className="mt-3 h-1.5 -skew-x-[20deg] overflow-hidden bg-ink-850">
                  <div
                    className={`anim-grow stagger h-full ${style.bar}`}
                    style={
                      {
                        width: `${Math.max(2, share * 100)}%`,
                        '--i': index,
                        '--stagger-step': '110ms',
                      } as CSSProperties
                    }
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {Math.round(share * 100)}% of your hours
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-800 pt-3 text-xs">
                  <div>
                    <dt className="text-ink-500">Games</dt>
                    <dd className="stat-figure mt-0.5 text-sm text-ink-100">{platform.games}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Per game</dt>
                    <dd className="stat-figure mt-0.5 text-sm text-ink-100">
                      {platform.games > 0 ? formatHours(platform.minutes / platform.games) : '—'}
                    </dd>
                  </div>
                </dl>
              </PlatformPanel>
            );
          })}
        </div>
      </section>

      {/* ── Games that crossed platforms: the thing a unified library can
          say that no single platform can. ── */}
      {data.crossPlatform.length > 0 ? (
        <section className="anim-rise mt-10">
          <SectionHeading>Played on more than one platform</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {data.crossPlatform.map((game, index) => (
              <Link
                key={game.slug}
                href={`/game/${game.slug}`}
                style={{ '--i': index, '--stagger-step': '60ms' } as CSSProperties}
                className="card group anim-rise stagger lift relative overflow-hidden p-4"
              >
                <div className="display line-clamp-2 text-base leading-tight text-ink-100 transition-colors group-hover:text-accent">
                  {game.name}
                </div>
                <div className="stat-figure mt-2 text-xs text-ink-400">{formatHours(game.minutes)}</div>
                <div className="mt-3 flex gap-1" aria-label={game.providers.map(providerLabel).join(', ')}>
                  {game.providers.map((provider) => (
                    <span
                      key={provider}
                      className={`h-1.5 flex-1 -skew-x-[20deg] ${platformStyle(provider).bar}`}
                      aria-hidden
                    />
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/** A small figure on the player card's paper. */
function Small({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div>
      <div className="eyebrow text-ink-700">{label}</div>
      <div className="display mt-1 text-[1.75rem] leading-none text-ink-950">
        {typeof value === 'number' ? <Counter value={value} /> : value}
      </div>
      <div className="mt-1 text-[12px] text-ink-700">{note}</div>
    </div>
  );
}

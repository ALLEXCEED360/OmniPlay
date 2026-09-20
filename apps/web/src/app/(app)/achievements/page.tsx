import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatDate, providerLabel } from '@/lib/format';
import { ConfidenceNote, EmptyState, PageHeader } from '@/components/ui';
import { Counter } from '@/components/counter';
import { PlatformPanel } from '@/components/platform-panel';
import { platformStyle } from '@/lib/platform';
import type { CSSProperties, ReactNode } from 'react';
import { AchievementBand } from '@/components/achievement-band';

/**
 * Achievements (spec 15).
 *
 * The page earns its place because unlocks are the only thing most providers
 * give us that is both a real event and precisely dated. A Steam library can
 * hold hundreds of hours with no timeline at all, while the unlocks beneath it
 * know exactly when each one happened.
 *
 * Laid out as a trophy room rather than a report. A tally strip of the
 * figures that matter runs under the title; the single rarest thing in the
 * whole collection gets a showcase of its own, because one trophy that
 * 0.1% of players hold says more than any total; each platform reports on
 * its own terms in its own panel; and the games are banded by how close
 * they are to done, since "what could I finish?" is the question a player
 * actually brings here.
 */

interface RareUnlock {
  name: string;
  description: string | null;
  iconUrl: string | null;
  provider: string;
  rate: number | null;
  unlockedAt: string | null;
  game: { name: string; slug: string; coverImage: string | null };
}

interface GameProgress {
  gameId: string;
  name: string;
  slug: string;
  coverImage: string | null;
  provider: string;
  total: number;
  unlocked: number;
  points: number;
  totalPoints: number | null;
  lastUnlockedAt: string | null;
  detailed: boolean;
  totalKnown: boolean;
}

interface ProviderSummary {
  provider: string;
  unlocked: number;
  tracked: number;
  games: number;
  perfect: number;
  points: number | null;
}

interface YearSlice {
  year: number;
  providers: Record<string, number>;
  total: number;
}

interface Highlight {
  provider: string;
  basis: 'rarity' | 'points';
  items: Array<{
    name: string;
    iconUrl: string | null;
    rate: number | null;
    points: number | null;
    gameName: string;
    gameSlug: string;
    coverImage: string | null;
  }>;
}

interface AchievementsOverview {
  unlocked: number;
  tracked: number;
  gamesWithAchievements: number;
  gamesStarted: number;
  perfectGames: number;
  awaitingDetail: number;
  providers: ProviderSummary[];
  yearsByProvider: YearSlice[];
  highlights: Highlight[];
  rarest: RareUnlock[];
  tiers: { platinum: number; gold: number; silver: number; bronze: number };
  byYear: Array<{ year: number; count: number }>;
  recent: Array<{
    name: string;
    iconUrl: string | null;
    provider: string;
    unlockedAt: string | null;
    game: { name: string; slug: string; coverImage: string | null };
  }>;
  byGame: GameProgress[];
}

/**
 * How close a game is to done.
 *
 * Bands rather than a single ordered list, because the question a player
 * actually brings here is "what could I finish?" — and a game at 92% is a
 * different proposition from one at 8%, however adjacent they sit when sorted.
 */
const BANDS = [
  { id: 'perfect', label: 'Complete', hint: 'Every achievement unlocked', min: 1 },
  { id: 'close', label: 'Almost there', hint: '75% and up', min: 0.75 },
  { id: 'halfway', label: 'Past halfway', hint: '50–74%', min: 0.5 },
  { id: 'started', label: 'Under way', hint: '25–49%', min: 0.25 },
  { id: 'early', label: 'Just started', hint: 'Under 25%', min: 0 },
] as const;

function fractionOf(game: GameProgress): number {
  if (game.totalKnown && game.total > 0) return game.unlocked / game.total;
  // No trustworthy total: the gamerscore ratio stands in where one exists.
  if (game.totalPoints && game.totalPoints > 0) {
    return Math.min(1, (game.points ?? 0) / game.totalPoints);
  }
  return 0;
}

/** A rarity as a person would say it: "0.1%" for the rare, "12%" for the rest. */
function rateLabel(rate: number): string {
  const percent = rate * 100;
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

export default async function AchievementsPage() {
  const data = await apiFetch<AchievementsOverview>('/achievements');

  if (data.tracked === 0) {
    return (
      <>
        <PageHeader title="Achievements" subtitle="Everything you have unlocked." />
        <EmptyState
          title="No achievement data yet"
          description="Connect a platform that reports achievements, then sync. Steam, Xbox and PlayStation all do."
          action={
            <Link href="/settings" className="btn-primary">
              Connect an account
            </Link>
          }
        />
      </>
    );
  }

  const started = data.byGame.filter((game) => game.unlocked > 0);
  const untouched = data.byGame.filter((game) => game.unlocked === 0);

  const banded = BANDS.map((band, index) => {
    const upper = index === 0 ? Infinity : BANDS[index - 1]!.min;
    return {
      ...band,
      games: started
        .filter((game) => {
          const fraction = fractionOf(game);
          return fraction >= band.min && fraction < upper;
        })
        .sort((a, b) => fractionOf(b) - fractionOf(a)),
    };
  }).filter((band) => band.games.length > 0);

  const rarest = data.rarest[0];
  const runnersUp = data.rarest.slice(1, 4).filter((item) => item.rate != null);
  const psnGames = data.providers.find((platform) => platform.provider === 'psn')?.games ?? 0;
  const years = data.yearsByProvider;
  const span = years.length > 0 ? `${years[0]?.year}–${years[years.length - 1]?.year}` : null;
  const tierTotal =
    data.tiers.platinum + data.tiers.gold + data.tiers.silver + data.tiers.bronze;

  return (
    <>
      <PageHeader
        art="/backdrop/menu/achievements.jpg"
        eyebrow="Everything you have earned"
        title="Achievements"
        subtitle={
          span
            ? `${data.unlocked.toLocaleString()} unlocked across ${started.length} games, ${span}`
            : `${data.unlocked.toLocaleString()} unlocked across ${started.length} games`
        }
      />

      {/* ── The tally: a paper strip of figures that are each a fact, not a
          ratio over a denominator nobody chose. The old "completion rate"
          divided by every achievement of every owned game, including the
          ones never launched, which made a serious player look like a 9%
          one. The total leads, split by platform beneath it so the loudest
          number on the page also says where it came from. ── */}
      <div className="hard-shadow anim-rise">
        <div className="paper cut grid grid-cols-2 divide-ink-950/10 sm:grid-cols-3 sm:divide-x lg:grid-cols-[1.7fr_repeat(4,minmax(0,1fr))]">
          <div className="col-span-2 px-5 py-5 sm:col-span-3 lg:col-span-1 2xl:px-6">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <div className="eyebrow text-ink-700">Unlocked</div>
                <div className="display mt-1 text-[clamp(3.5rem,6vw,5.5rem)] leading-none text-ink-950">
                  <Counter value={data.unlocked} />
                </div>
              </div>
              <div className="pb-1 text-[12px] text-ink-700">
                of {data.tracked.toLocaleString()} in the {started.length} games
                <br className="hidden sm:block" /> you have started
              </div>
            </div>

            {/* The total, split: one segment per platform, in the legend
                the whole app uses. */}
            <div className="mt-4 flex h-2.5 -skew-x-[20deg] overflow-hidden bg-ink-950/10" aria-hidden>
              {data.providers.map((platform, index) => (
                <div
                  key={platform.provider}
                  className={`anim-grow stagger h-full ${platformStyle(platform.provider).bar}`}
                  style={
                    {
                      width: `${(platform.unlocked / Math.max(1, data.unlocked)) * 100}%`,
                      '--i': index,
                      '--stagger-step': '120ms',
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
              {data.providers.map((platform) => (
                <div key={platform.provider} className="flex items-center gap-1.5 text-[12px]">
                  <span className={`size-2 -skew-x-[20deg] ${platformStyle(platform.provider).bar}`} aria-hidden />
                  <dt className="text-ink-700">{providerLabel(platform.provider)}</dt>
                  <dd className="stat-figure font-semibold text-ink-950">{platform.unlocked.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </div>

          <Tally
            label="Complete"
            value={data.perfectGames}
            note={`of ${started.length} started`}
            share={started.length > 0 ? data.perfectGames / started.length : undefined}
          />
          <Tally
            label="Games started"
            value={started.length}
            note={`of ${data.gamesWithAchievements} with achievements`}
            share={data.gamesWithAchievements > 0 ? started.length / data.gamesWithAchievements : undefined}
          />
          {data.tiers.platinum > 0 ? (
            <Tally
              label="Platinums"
              value={data.tiers.platinum}
              note={psnGames > 0 ? `of ${psnGames} PlayStation games` : 'PlayStation'}
              tone="text-[oklch(0.5_0.12_230)]"
              bar="bg-[oklch(0.5_0.12_230)]"
              share={psnGames > 0 ? Math.min(1, data.tiers.platinum / psnGames) : undefined}
            />
          ) : (
            <Tally label="Tracked" value={data.tracked} note="achievements in started games" />
          )}
          <Tally
            label="Rarest"
            value={rarest?.rate != null ? rateLabel(rarest.rate) : '—'}
            note={rarest ? 'of players hold it' : 'no rarity reported'}
            tone="text-accent-strong"
            bar="bg-accent-strong"
            share={rarest?.rate ?? undefined}
          />
        </div>
      </div>

      {data.awaitingDetail > 0 ? (
        <p className="mt-4">
          <ConfidenceNote>
            {data.awaitingDetail} {data.awaitingDetail === 1 ? 'game shows' : 'games show'} the
            platform&rsquo;s own progress count. Individual achievements cost one request per
            game and arrive a few at a time — run a sync again to fetch more.
          </ConfidenceNote>
        </p>
      ) : null}

      {/* ── The showcase: the rarest things in the collection, given the
          room a trophy cabinet gives its centrepiece. The rarest of all
          stands on its own game's art with its rate set huge in gold; the
          next few line up beside it, so the row reads as a podium rather
          than a single figure with nothing to measure it against. ── */}
      {rarest && rarest.rate != null ? (
        <section className="anim-rise mt-10">
          <Heading>The rarest things you own</Heading>
          <div
            className={`grid gap-4 ${runnersUp.length > 0 ? 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''}`}
          >
            <Link
              href={`/game/${rarest.game.slug}`}
              className="card hud-corners group relative flex min-h-[17rem] flex-col justify-center overflow-hidden p-6 sm:p-8"
            >
              {/* The game's own cover, blown out and graded, as the
                  cabinet's back wall. */}
              {rarest.game.coverImage ? (
                <div className="absolute inset-0 -z-0" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={rarest.game.coverImage}
                    alt=""
                    className="size-full scale-125 object-cover opacity-50 blur-2xl saturate-[0.7] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.35]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-ink-950/65 to-ink-950/40" />
                  <div className="absolute inset-0 halftone opacity-40" />
                </div>
              ) : null}

              {/* A gold ribbon across the corner: first place. */}
              <span
                className="absolute -right-11 top-5 w-40 rotate-45 bg-accent py-1 text-center font-display text-xs font-extrabold uppercase tracking-[0.2em] text-ink-950 shadow-[0_2px_0_var(--color-ink-950)]"
                aria-hidden
              >
                Rarest
              </span>

              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
                {rarest.game.coverImage ? (
                  <div className="hard-shadow hidden shrink-0 sm:block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={rarest.game.coverImage} alt="" className="cut w-32 2xl:w-36" />
                  </div>
                ) : null}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
                    <div className="display text-[clamp(4rem,7vw,6.5rem)] leading-none text-accent [text-shadow:0.04em_0.04em_0_var(--color-ink-950)]">
                      {rateLabel(rarest.rate)}
                    </div>
                    <div className="eyebrow pb-2 text-ink-300">of players hold it</div>
                  </div>

                  <div className="mt-5 flex items-center gap-4">
                    {rarest.iconUrl ? (
                      <div className="hard-shadow shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={rarest.iconUrl}
                          alt=""
                          className="cut-sm size-16 object-cover transition-transform duration-300 group-hover:scale-105 sm:size-20"
                        />
                      </div>
                    ) : null}
                    <div className="min-w-0">
                      <div className="display truncate text-2xl leading-tight text-ink-100 transition-colors group-hover:text-accent sm:text-3xl">
                        {rarest.name}
                      </div>
                      {rarest.description ? (
                        <p className="mt-1 line-clamp-2 text-sm leading-snug text-ink-200">{rarest.description}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-300">
                        <span className="flex items-center gap-1.5">
                          <span className={`size-2 -skew-x-[20deg] ${platformStyle(rarest.provider).bar}`} aria-hidden />
                          {rarest.game.name}
                        </span>
                        {rarest.unlockedAt ? <span>· {formatDate(rarest.unlockedAt)}</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Link>

            {runnersUp.length > 0 ? (
              <ol className="card hud-corners flex flex-col divide-y divide-ink-800">
                {runnersUp.map((item, index) => (
                  <li key={`${item.game.slug}-${index}`} className="flex-1">
                    <Link
                      href={`/game/${item.game.slug}`}
                      className="group anim-fade stagger flex h-full items-center gap-4 px-5 py-3.5 transition-colors hover:bg-ink-850/60"
                      style={{ '--i': index + 1, '--stagger-step': '80ms' } as CSSProperties}
                    >
                      <span className="display w-7 shrink-0 text-xl text-ink-600">{index + 2}</span>
                      {item.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.iconUrl}
                          alt=""
                          loading="lazy"
                          className="size-12 shrink-0 cut-sm object-cover transition-transform duration-200 group-hover:scale-110"
                        />
                      ) : (
                        <span className="size-12 shrink-0 cut-sm bg-ink-850" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-ink-100 transition-colors group-hover:text-accent">
                          {item.name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-ink-500">
                          <span className={`size-1.5 shrink-0 -skew-x-[20deg] ${platformStyle(item.provider).bar}`} aria-hidden />
                          <span className="truncate">{item.game.name}</span>
                        </div>
                      </div>
                      <span className="display shrink-0 text-2xl text-accent">
                        {item.rate != null ? rateLabel(item.rate) : '—'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── Every platform, on its own terms.
          Rarity and trophy tiers are PlayStation-only, so leading with them
          left a library holding 517 Steam unlocks and 198 Xbox ones with no
          mention of either. Counts, games and completions are reported by all
          three, so the comparison is built from those — and each platform's
          own signature figure rides alongside rather than instead. ── */}
      <section className="anim-rise mt-10">
        <Heading>By platform</Heading>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.providers.map((platform, index) => {
            const style = platformStyle(platform.provider);
            const percent =
              platform.tracked > 0 ? (platform.unlocked / platform.tracked) * 100 : 0;

            return (
              <PlatformPanel
                key={platform.provider}
                provider={platform.provider}
                index={index}
                aside={`${platform.games} games`}
              >
                <div className="eyebrow text-ink-500">Unlocked</div>
                <div className={`display mt-1 text-[2.6rem] leading-none ${style.text}`}>
                  <Counter value={platform.unlocked} />
                </div>

                <div className="mt-3 h-1.5 -skew-x-[20deg] overflow-hidden bg-ink-850">
                  <div
                    className={`anim-grow stagger h-full ${style.bar}`}
                    style={
                      {
                        width: `${Math.max(2, percent)}%`,
                        '--i': index,
                        '--stagger-step': '110ms',
                      } as CSSProperties
                    }
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {Math.round(percent)}% of the {platform.tracked.toLocaleString()} in games you
                  have started
                </p>

                <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-ink-800 pt-3 text-xs">
                  <div>
                    <dt className="text-ink-500">Games</dt>
                    <dd className="stat-figure mt-0.5 text-sm text-ink-100">{platform.games}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Complete</dt>
                    <dd
                      className={`stat-figure mt-0.5 text-sm ${
                        platform.perfect > 0 ? style.text : 'text-ink-600'
                      }`}
                    >
                      {platform.perfect}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">
                      {platform.provider === 'xbox' ? 'Gamerscore' : 'Points'}
                    </dt>
                    <dd className="stat-figure mt-0.5 text-sm text-ink-100">
                      {platform.points === null ? (
                        <span className="text-ink-600">none</span>
                      ) : (
                        platform.points.toLocaleString()
                      )}
                    </dd>
                  </div>
                </dl>
              </PlatformPanel>
            );
          })}
        </div>
        <p className="mt-4">
          <ConfidenceNote>
            Scores are never added across platforms. Xbox gamerscore and PlayStation trophy
            weights are different units, and Steam reports no score at all — a combined total
            would be a number that means nothing.
          </ConfidenceNote>
        </p>
      </section>

      {/* ── Standouts and trophy tiers side by side: the two "best of"
          views, each on its own terms. ── */}
      {data.highlights.length > 0 || tierTotal > 0 ? (
        <section className="anim-rise mt-10 grid gap-8 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {data.highlights.length > 0 ? (
            <div>
              <Heading>Standouts</Heading>

              {/* One column per platform, each ranked by what that platform
                  actually reports. A single global "rarest" list was always
                  PlayStation — its trophies really are rarer — so Steam never
                  placed even though Steam publishes rarity too, and Xbox, which
                  publishes none, could never appear at all. */}
              <div className="grid gap-4 md:grid-cols-3">
                {data.highlights.map((group, index) => {
                  const style = platformStyle(group.provider);
                  return (
                    <PlatformPanel
                      key={group.provider}
                      provider={group.provider}
                      index={index}
                      aside={group.basis === 'rarity' ? 'Rarest' : 'Highest score'}
                      watermark="none"
                    >
                      <ol className="-mt-1 space-y-1">
                        {group.items.map((item, rank) => (
                          <li
                            key={`${item.gameSlug}-${rank}`}
                            className="anim-fade stagger"
                            style={{ '--i': rank + index, '--stagger-step': '60ms' } as CSSProperties}
                          >
                            <Link
                              href={`/game/${item.gameSlug}`}
                              className="group -mx-2 flex items-center gap-3 px-2 py-1.5 transition-colors hover:bg-ink-850/60"
                            >
                              <span className="stat-figure w-4 shrink-0 text-[11px] text-ink-600">
                                {rank + 1}
                              </span>
                              {item.iconUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.iconUrl}
                                  alt=""
                                  loading="lazy"
                                  className="size-11 shrink-0 cut-sm object-cover transition-transform duration-200 group-hover:scale-110"
                                />
                              ) : (
                                <span className="size-11 shrink-0 cut-sm bg-ink-850" />
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-ink-100 transition-colors group-hover:text-accent">
                                  {item.name}
                                </div>
                                <div className="truncate text-[11px] text-ink-500">{item.gameName}</div>
                              </div>

                              <span className={`display shrink-0 text-lg ${style.text}`}>
                                {group.basis === 'rarity' && item.rate != null
                                  ? rateLabel(item.rate)
                                  : item.points != null
                                    ? `${item.points}G`
                                    : '—'}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ol>

                      <p className="mt-3 border-t border-ink-800 pt-3 text-[11px] leading-snug text-ink-500">
                        {group.basis === 'rarity'
                          ? 'Share of players worldwide holding each one.'
                          : 'Gamerscore. Xbox publishes no rarity, so its standouts are ranked by score instead.'}
                      </p>
                    </PlatformPanel>
                  );
                })}
              </div>
            </div>
          ) : null}

          {tierTotal > 0 ? (
            <div>
              <Heading>Trophy case</Heading>

              {/* The case as a stack: platinum at the top, bronze at the
                  foot, each row as wide as its share. Bronze being most of a
                  trophy case is a shape, not a figure — and a stack shows
                  the shape. */}
              <div className="card hud-corners p-5">
                <div className="space-y-2.5">
                  {(
                    [
                      ['Platinum', data.tiers.platinum, 'bg-[oklch(0.85_0.06_230)]', 'text-[oklch(0.85_0.06_230)]'],
                      ['Gold', data.tiers.gold, 'bg-accent', 'text-accent'],
                      ['Silver', data.tiers.silver, 'bg-ink-300', 'text-ink-300'],
                      ['Bronze', data.tiers.bronze, 'bg-[oklch(0.62_0.12_55)]', 'text-[oklch(0.7_0.12_55)]'],
                    ] as const
                  ).map(([label, count, bar, text], index) => {
                    const share = count / tierTotal;
                    return (
                      <div
                        key={label}
                        className="anim-rise stagger"
                        style={{ '--i': index, '--stagger-step': '80ms' } as CSSProperties}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={`font-display text-xs font-bold uppercase tracking-wider ${count > 0 ? text : 'text-ink-600'}`}>
                            {label}
                          </span>
                          <span className={`display text-2xl leading-none ${count > 0 ? text : 'text-ink-600'}`}>
                            <Counter value={count} />
                          </span>
                        </div>
                        <div className="mt-1.5 h-3 -skew-x-[20deg] overflow-hidden bg-ink-850">
                          <div
                            className={`anim-grow stagger h-full ${bar}`}
                            style={
                              {
                                width: `${Math.max(1.5, share * 100)}%`,
                                '--i': index,
                                '--stagger-step': '80ms',
                              } as CSSProperties
                            }
                          />
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-600">{Math.round(share * 100)}% of trophies</div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-4 border-t border-ink-800 pt-3 text-[11px] leading-snug text-ink-500">
                  PlayStation only. Xbox reports gamerscore instead, a different unit — adding the
                  two together would produce a number that means nothing.
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {data.yearsByProvider.length > 0 ? (
        <section className="anim-rise mt-10">
          <Heading>A decade, by platform</Heading>
          <div className="card hud-corners p-6 sm:p-7">
            {/* One row per platform rather than one bar per year.
                Stacked bars answered "how many that year" and buried the far
                more interesting fact, which is *which platform* — this library
                is pure PlayStation until 2024, Steam takes over in 2025, and
                Xbox appears only in 2026. Laid out as rows, that migration is
                the first thing you see. */}
            <div className="overflow-x-auto">
              <div className="min-w-[540px]">
                <div
                  className="grid gap-1 text-[10px] text-ink-600"
                  style={{ gridTemplateColumns: `5.5rem repeat(${data.yearsByProvider.length}, minmax(0, 1fr))` }}
                >
                  <span />
                  {data.yearsByProvider.map((slice) => (
                    <span key={slice.year} className="stat-figure text-center">
                      {String(slice.year).slice(2)}
                    </span>
                  ))}
                </div>

                {data.providers.map((platform, row) => {
                  const style = platformStyle(platform.provider);
                  const peak = Math.max(
                    ...data.yearsByProvider.map((slice) => slice.providers[platform.provider] ?? 0),
                    1,
                  );

                  return (
                    <div
                      key={platform.provider}
                      className="mt-1 grid items-center gap-1"
                      style={{ gridTemplateColumns: `5.5rem repeat(${data.yearsByProvider.length}, minmax(0, 1fr))` }}
                    >
                      <span className={`truncate font-display text-xs font-bold uppercase tracking-wider ${style.text}`}>
                        {providerLabel(platform.provider)}
                      </span>

                      {data.yearsByProvider.map((slice, column) => {
                        const count = slice.providers[platform.provider] ?? 0;
                        // Scaled within the platform's own peak: PlayStation's
                        // 742 would otherwise flatten every Xbox year to nothing.
                        const share = count / peak;
                        return (
                          <div
                            key={slice.year}
                            title={`${providerLabel(platform.provider)} · ${slice.year} · ${count} unlocked`}
                            className={`anim-pop stagger flex h-11 -skew-x-[8deg] items-center justify-center text-[11px] transition-transform duration-200 hover:scale-110 ${
                              count > 0 ? style.bar : 'bg-ink-850/60'
                            }`}
                            style={
                              {
                                // Reading order: the migration between platforms
                                // is a left-to-right story, so the cells fill
                                // that way rather than all at once. The stride
                                // has to be the row count — at a fixed 2 the
                                // third platform's cell shared a slot with the
                                // next column's first, and the sweep folded back
                                // on itself instead of crossing the decade once.
                                '--i': column * data.providers.length + row,
                                '--stagger-step': '22ms',
                                ...(count > 0 ? { opacity: 0.35 + share * 0.65 } : {}),
                              } as CSSProperties
                            }
                          >
                            <span
                              className={`stat-figure skew-x-[8deg] font-medium ${
                                count > 0 ? 'text-ink-950' : 'text-ink-700'
                              }`}
                            >
                              {count > 0 ? count : '·'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <div
                  className="mt-2 grid gap-1 text-[10px] text-ink-500"
                  style={{ gridTemplateColumns: `5.5rem repeat(${data.yearsByProvider.length}, minmax(0, 1fr))` }}
                >
                  <span className="text-ink-600">Total</span>
                  {data.yearsByProvider.map((slice) => (
                    <span key={slice.year} className="stat-figure text-center text-ink-300">
                      {slice.total}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <p className="mt-5">
              <ConfidenceNote>
                Shading is relative to each platform&rsquo;s own busiest year, so a quiet platform
                is still readable beside a loud one. Unlock dates come straight from the provider
                — playtime usually arrives as an undated lifetime total.
              </ConfidenceNote>
            </p>
          </div>
        </section>
      ) : null}

      {data.recent.length > 0 ? (
        <section className="anim-rise mt-10">
          <Heading>Recently unlocked</Heading>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.recent.slice(0, 8).map((achievement, index) => {
              const style = platformStyle(achievement.provider);
              return (
                <Link
                  key={`${achievement.game.slug}-${index}`}
                  href={`/game/${achievement.game.slug}`}
                  style={{ '--i': index, '--stagger-step': '50ms' } as CSSProperties}
                  className={`card group anim-rise stagger lift flex items-center gap-3 border-l-4 p-3 ${style.edge}`}
                >
                  {achievement.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={achievement.iconUrl}
                      alt=""
                      loading="lazy"
                      className="size-12 shrink-0 cut-sm object-cover transition-transform duration-200 group-hover:scale-110"
                    />
                  ) : (
                    <span className="size-12 shrink-0 cut-sm bg-ink-850" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink-100 transition-colors group-hover:text-accent">
                      {achievement.name}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-500">{achievement.game.name}</div>
                    <div className="mt-0.5 stat-figure text-[11px] text-ink-600">
                      {formatDate(achievement.unlockedAt)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="anim-rise mt-10">
        <Heading>Progress by game</Heading>

        {/* Poster tiles rather than rows, and collapsed by default. 141 tiles
            at once is wallpaper: "Just started" alone holds 51, which buried
            the twelve in "Almost there" that are actually worth acting on. */}
        <div className="space-y-8">
          {banded.map((band) => (
            <AchievementBand
              key={band.id}
              label={band.label}
              hint={band.hint}
              defaultOpen={band.id === 'close'}
              tallies={[...new Set(band.games.map((game) => game.provider))].map((provider) => ({
                provider,
                count: band.games.filter((game) => game.provider === provider).length,
                bar: platformStyle(provider).bar,
              }))}
              games={band.games.map((game) => ({
                gameId: game.gameId,
                name: game.name,
                slug: game.slug,
                coverImage: game.coverImage,
                provider: game.provider,
                total: game.total,
                unlocked: game.unlocked,
                totalKnown: game.totalKnown,
                percent: fractionOf(game) * 100,
                bar: platformStyle(game.provider).bar,
              }))}
            />
          ))}
        </div>

        {untouched.length > 0 ? (
          <p className="mt-6 text-xs text-ink-600">
            {untouched.length} more {untouched.length === 1 ? 'game has' : 'games have'}{' '}
            achievements you have not started.
          </p>
        ) : null}
      </section>
    </>
  );
}

/** A section title in the page's own voice: display type behind a gold slash. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 className="display mb-4 flex items-center gap-2.5 text-[1.5rem] text-ink-100">
      <span className="slash" aria-hidden />
      {children}
    </h2>
  );
}

/**
 * One cell of the tally strip: the figure set large and centred in its
 * cell, and beneath it a bar of what it is a share of, so the cell is a
 * shape as well as a number.
 */
function Tally({
  label,
  value,
  note,
  tone = 'text-ink-950',
  bar = 'bg-ink-950',
  /** 0–1, drawn as the bar's fill; no bar when there is nothing to be a share of. */
  share,
}: {
  label: string;
  value: string | number;
  note: string;
  tone?: string;
  bar?: string;
  share?: number | undefined;
}) {
  return (
    <div className="flex flex-col justify-center px-5 py-5 2xl:px-6">
      <div className="eyebrow text-ink-700">{label}</div>
      <div className={`display mt-2 text-[clamp(2.6rem,3.4vw,3.6rem)] leading-none ${tone}`}>
        {typeof value === 'number' ? <Counter value={value} /> : value}
      </div>
      {share !== undefined ? (
        <div className="mt-3 h-2 -skew-x-[20deg] overflow-hidden bg-ink-950/10" aria-hidden>
          <div className={`anim-grow h-full ${bar}`} style={{ width: `${Math.max(2, share * 100)}%` }} />
        </div>
      ) : null}
      <div className="mt-2 text-[13px] text-ink-700">{note}</div>
    </div>
  );
}

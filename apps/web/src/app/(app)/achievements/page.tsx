import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatDate, providerLabel } from '@/lib/format';
import { ConfidenceNote, EmptyState, PageHeader, SectionHeading, StatCard } from '@/components/ui';
import { AchievementBand } from '@/components/achievement-band';

/**
 * Achievements (spec 15).
 *
 * The page earns its place because unlocks are the only thing most providers
 * give us that is both a real event and precisely dated. A Steam library can
 * hold hundreds of hours with no timeline at all, while the unlocks beneath it
 * know exactly when each one happened.
 *
 * Rebuilt because the first version was a wall: one flat list of every started
 * game, 141 rows deep, with nothing to distinguish the twelve sitting at 90%
 * from the fifty barely touched. A list that long is not a ranking, it is a
 * scroll — so the games are banded by how close they are to done, and the two
 * genuinely interesting figures an achievement dataset holds are given room:
 * what is rarest, and what is finished.
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

/**
 * A colour per platform, used everywhere a platform appears.
 *
 * Each is the colour the platform is actually known by — PlayStation blue,
 * Xbox green, Steam's violet — so the stacked chart, the cards and the badges
 * all read as one system rather than three arbitrary hues.
 */
const PROVIDER_STYLE: Record<string, { bar: string; text: string; ring: string }> = {
  psn: { bar: 'bg-accent', text: 'text-accent', ring: 'ring-accent/40' },
  xbox: { bar: 'bg-positive', text: 'text-positive', ring: 'ring-positive/40' },
  steam: { bar: 'bg-violet', text: 'text-violet', ring: 'ring-violet/40' },
};

const styleFor = (provider: string) =>
  PROVIDER_STYLE[provider] ?? { bar: 'bg-ink-500', text: 'text-ink-300', ring: 'ring-ink-600' };

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
            <Link
              href="/settings"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 hover:bg-accent-strong"
            >
              Connect an account
            </Link>
          }
        />
      </>
    );
  }

  const started = data.byGame.filter((game) => game.unlocked > 0);
  const untouched = data.byGame.filter((game) => game.unlocked === 0);
  const maxYear = Math.max(...data.yearsByProvider.map((slice) => slice.total), 1);

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
  const years = data.yearsByProvider;
  const span = years.length > 0 ? `${years[0]?.year}–${years[years.length - 1]?.year}` : null;
  const tierTotal =
    data.tiers.platinum + data.tiers.gold + data.tiers.silver + data.tiers.bronze;

  return (
    <>
      <PageHeader
        title="Achievements"
        subtitle={
          span
            ? `${data.unlocked.toLocaleString()} unlocked across ${started.length} games, ${span}`
            : `${data.unlocked.toLocaleString()} unlocked across ${started.length} games`
        }
      />

      {/* Four figures that are each a fact, not a ratio over a denominator
          nobody chose. The old "completion rate" divided by every achievement
          of every owned game, including the ones never launched, which made a
          serious player look like a 9% one. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Unlocked" value={data.unlocked.toLocaleString()} accent />
        <StatCard
          label="Complete"
          value={data.perfectGames}
          hint={`of ${started.length} started`}
        />
        {data.tiers.platinum > 0 ? (
          <StatCard label="Platinums" value={data.tiers.platinum} hint="PlayStation" />
        ) : (
          <StatCard label="Games started" value={started.length} />
        )}
        <StatCard
          label="Rarest"
          value={rarest?.rate != null ? `${(rarest.rate * 100).toFixed(1)}%` : '—'}
          hint={rarest?.game.name}
        />
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

      {/* Every platform, on its own terms.
          Rarity and trophy tiers are PlayStation-only, so leading with them
          left a library holding 517 Steam unlocks and 198 Xbox ones with no
          mention of either. Counts, games and completions are reported by all
          three, so the comparison is built from those — and each platform's
          own signature figure rides alongside rather than instead. */}
      <section className="mt-10">
        <SectionHeading>By platform</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.providers.map((platform) => {
            const style = styleFor(platform.provider);
            const percent =
              platform.tracked > 0 ? (platform.unlocked / platform.tracked) * 100 : 0;

            return (
              <div
                key={platform.provider}
                className={`card relative overflow-hidden p-5 ring-1 ${style.ring}`}
              >
                {/* A wash of the platform's colour, so the card is
                    recognisable before a word of it is read. */}
                <div
                  className={`pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-[0.12] blur-2xl ${style.bar}`}
                  aria-hidden
                />

                <div className="relative">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className={`text-sm font-semibold ${style.text}`}>
                      {providerLabel(platform.provider)}
                    </h3>
                    <span className="stat-figure text-2xl text-ink-100">
                      {platform.unlocked.toLocaleString()}
                    </span>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-850">
                    <div
                      className={`h-full rounded-full ${style.bar}`}
                      style={{ width: `${Math.max(2, percent)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-600">
                    {Math.round(percent)}% of the {platform.tracked.toLocaleString()} in games
                    you have started
                  </p>

                  <dl className="mt-4 flex gap-5 text-xs">
                    <div>
                      <dt className="text-ink-600">Games</dt>
                      <dd className="stat-figure mt-0.5 text-sm text-ink-200">{platform.games}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-600">Complete</dt>
                      <dd
                        className={`stat-figure mt-0.5 text-sm ${
                          platform.perfect > 0 ? style.text : 'text-ink-700'
                        }`}
                      >
                        {platform.perfect}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-600">
                        {platform.provider === 'xbox' ? 'Gamerscore' : 'Points'}
                      </dt>
                      <dd className="stat-figure mt-0.5 text-sm text-ink-200">
                        {platform.points === null ? (
                          <span className="text-ink-700">not reported</span>
                        ) : (
                          platform.points.toLocaleString()
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
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

      {data.yearsByProvider.length > 0 ? (
        <section className="mt-10 card p-6 sm:p-7">
          <SectionHeading>A decade, by platform</SectionHeading>

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

              {data.providers.map((platform) => {
                const style = styleFor(platform.provider);
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
                    <span className={`truncate text-xs font-medium ${style.text}`}>
                      {providerLabel(platform.provider)}
                    </span>

                    {data.yearsByProvider.map((slice) => {
                      const count = slice.providers[platform.provider] ?? 0;
                      // Scaled within the platform's own peak: PlayStation's
                      // 742 would otherwise flatten every Xbox year to nothing.
                      const share = count / peak;
                      return (
                        <div
                          key={slice.year}
                          title={`${providerLabel(platform.provider)} · ${slice.year} · ${count} unlocked`}
                          className={`flex h-11 items-center justify-center rounded-md text-[11px] transition-transform hover:scale-105 ${
                            count > 0 ? style.bar : 'bg-ink-850/60'
                          }`}
                          style={count > 0 ? { opacity: 0.35 + share * 0.65 } : undefined}
                        >
                          <span
                            className={`stat-figure font-medium ${
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
        </section>
      ) : null}

      {data.highlights.length > 0 ? (
        <section className="mt-10">
          <SectionHeading>Standouts</SectionHeading>

          {/* One column per platform, each ranked by what that platform
              actually reports. A single global "rarest" list was always
              PlayStation — its trophies really are rarer — so Steam never
              placed even though Steam publishes rarity too, and Xbox, which
              publishes none, could never appear at all. */}
          <div className="grid gap-4 lg:grid-cols-3">
            {data.highlights.map((group) => {
              const style = styleFor(group.provider);
              return (
                <div key={group.provider} className={`card p-5 ring-1 ${style.ring}`}>
                  <div className="mb-4 flex items-baseline justify-between gap-3">
                    <h3 className={`text-sm font-semibold ${style.text}`}>
                      {providerLabel(group.provider)}
                    </h3>
                    <span className="text-[11px] uppercase tracking-wider text-ink-600">
                      {group.basis === 'rarity' ? 'Rarest' : 'Highest score'}
                    </span>
                  </div>

                  <ol className="space-y-3">
                    {group.items.map((item, index) => (
                      <li key={`${item.gameSlug}-${index}`}>
                        <Link
                          href={`/game/${item.gameSlug}`}
                          className="group flex items-center gap-3 transition-opacity hover:opacity-90"
                        >
                          {item.iconUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.iconUrl}
                              alt=""
                              loading="lazy"
                              className="size-11 shrink-0 rounded-lg shadow"
                            />
                          ) : (
                            <span className="size-11 shrink-0 rounded-lg bg-ink-850" />
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-ink-100">{item.name}</div>
                            <div className="truncate text-[11px] text-ink-500">
                              {item.gameName}
                            </div>
                          </div>

                          <span className={`stat-figure shrink-0 text-base font-semibold ${style.text}`}>
                            {group.basis === 'rarity' && item.rate != null
                              ? `${(item.rate * 100).toFixed(1)}%`
                              : item.points != null
                                ? `${item.points}G`
                                : '—'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>

                  <p className="mt-4 text-[11px] leading-snug text-ink-600">
                    {group.basis === 'rarity'
                      ? 'Share of players worldwide holding each one.'
                      : 'Gamerscore. Xbox publishes no rarity, so its standouts are ranked by score instead.'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {tierTotal > 0 ? (
        <section className="mt-10">
          <SectionHeading>Trophy tiers</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['Platinum', data.tiers.platinum, 'from-accent/20', 'text-accent'],
                ['Gold', data.tiers.gold, 'from-warning/20', 'text-warning'],
                ['Silver', data.tiers.silver, 'from-ink-400/20', 'text-ink-300'],
                ['Bronze', data.tiers.bronze, 'from-violet/20', 'text-violet'],
              ] as const
            ).map(([label, count, wash, text]) => (
              <div
                key={label}
                className={`card bg-gradient-to-b ${wash} to-transparent p-5`}
              >
                <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
                <div className={`stat-figure mt-1 text-3xl ${count > 0 ? text : 'text-ink-700'}`}>
                  {count.toLocaleString()}
                </div>
                <div className="mt-1 text-[11px] text-ink-600">
                  {Math.round((count / tierTotal) * 100)}% of trophies
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4">
            <ConfidenceNote>
              PlayStation only. Xbox reports gamerscore instead, which is a different unit —
              adding the two together would produce a number that means nothing.
            </ConfidenceNote>
          </p>
        </section>
      ) : null}

      {data.recent.length > 0 ? (
        <section className="mt-10">
          <SectionHeading>Recently unlocked</SectionHeading>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.recent.slice(0, 8).map((achievement, index) => (
              <Link
                key={`${achievement.game.slug}-${index}`}
                href={`/game/${achievement.game.slug}`}
                className="card flex items-center gap-3 p-3 transition-colors hover:bg-ink-850/50"
              >
                {achievement.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={achievement.iconUrl}
                    alt=""
                    loading="lazy"
                    className="size-11 shrink-0 rounded-lg"
                  />
                ) : (
                  <span className="size-11 shrink-0 rounded-lg bg-ink-850" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink-100">{achievement.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${styleFor(achievement.provider).bar}`}
                      aria-hidden
                    />
                    <span className="truncate">{achievement.game.name}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-600">
                    {formatDate(achievement.unlockedAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <SectionHeading>Progress by game</SectionHeading>

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
                bar: styleFor(provider).bar,
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
                bar: styleFor(game.provider).bar,
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

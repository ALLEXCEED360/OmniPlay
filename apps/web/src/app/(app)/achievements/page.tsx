import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatDate, providerLabel } from '@/lib/format';
import { ConfidenceNote, EmptyState, PageHeader, SectionHeading, StatCard } from '@/components/ui';

/**
 * Achievements (spec 15).
 *
 * The page earns its place because unlocks are the only thing most providers
 * give us that is both a real event and precisely dated. A Steam library can
 * hold hundreds of hours with no timeline at all, while the unlocks beneath it
 * know exactly when each one happened.
 */

interface AchievementsOverview {
  unlocked: number;
  tracked: number;
  completionRate: number;
  gamesWithAchievements: number;
  gamesStarted: number;
  perfectGames: number;
  awaitingDetail: number;
  points: number;
  byYear: Array<{ year: number; count: number }>;
  recent: Array<{
    name: string;
    description: string | null;
    iconUrl: string | null;
    provider: string;
    unlockedAt: string | null;
    game: { name: string; slug: string; coverImage: string | null };
  }>;
  byGame: Array<{
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
    /** False when this row is the provider's summary, not counted achievements. */
    detailed: boolean;
    /** False when the provider did not give a trustworthy total. */
    totalKnown: boolean;
  }>;
}

export default async function AchievementsPage() {
  const data = await apiFetch<AchievementsOverview>('/achievements');

  if (data.tracked === 0) {
    return (
      <>
        <PageHeader title="Achievements" subtitle="Everything you have unlocked." />
        <EmptyState
          title="No achievement data yet"
          description="Connect a platform that reports achievements, then sync. Steam and Xbox both do; PlayStation trophies need an import."
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
  const maxYear = Math.max(...data.byYear.map((entry) => entry.count), 1);

  return (
    <>
      <PageHeader
        title="Achievements"
        subtitle={`${data.unlocked.toLocaleString()} unlocked across ${started.length} games`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Unlocked" value={data.unlocked} accent />
        <StatCard
          label="Completion"
          value={`${Math.round(data.completionRate * 100)}%`}
          hint={`of ${data.tracked.toLocaleString()} tracked`}
        />
        <StatCard label="Games started" value={started.length} hint={`of ${data.byGame.length} with achievements`} />
        <StatCard label="Perfect games" value={data.perfectGames} hint="100% complete" />
      </div>

      {data.awaitingDetail > 0 ? (
        <p className="mt-4">
          <ConfidenceNote>
            {data.awaitingDetail} {data.awaitingDetail === 1 ? 'game shows' : 'games show'} the
            platform&rsquo;s own progress count. Individual achievements and unlock dates cost one
            request per game and arrive a few at a time — run a sync again to fetch more.
          </ConfidenceNote>
        </p>
      ) : null}

      {data.byYear.length > 0 ? (
        <section className="mt-10 card p-6">
          <SectionHeading>Unlocks by year</SectionHeading>
          <div className="flex h-32 items-end gap-3">
            {data.byYear.map((entry) => (
              <div key={entry.year} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <span className="stat-figure text-xs text-ink-400">{entry.count}</span>
                <div
                  className="w-full rounded-t bg-gradient-to-t from-violet/40 to-violet"
                  style={{ height: `${Math.max(4, (entry.count / maxYear) * 100)}%` }}
                />
                <span className="stat-figure text-[10px] text-ink-500">{entry.year}</span>
              </div>
            ))}
          </div>
          <p className="mt-4">
            <ConfidenceNote>
              Unlock dates come straight from the provider, which makes them the most precisely
              dated thing in your library — playtime usually arrives as an undated lifetime total.
            </ConfidenceNote>
          </p>
        </section>
      ) : null}

      {data.recent.length > 0 ? (
        <section className="mt-10">
          <SectionHeading>Recently unlocked</SectionHeading>
          <div className="card divide-y divide-ink-850">
            {data.recent.map((achievement, index) => (
              <div key={`${achievement.game.slug}-${index}`} className="flex items-center gap-4 p-4">
                {achievement.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={achievement.iconUrl}
                    alt=""
                    className="size-10 shrink-0 rounded"
                    loading="lazy"
                  />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded bg-ink-850 text-ink-600">
                    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
                      <path d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3 6.2 19.8l1.6-6.6L2.6 8.8l6.8-.5z" />
                    </svg>
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink-100">{achievement.name}</div>
                  <div className="mt-0.5 truncate text-xs text-ink-500">
                    <Link href={`/game/${achievement.game.slug}`} className="hover:text-accent">
                      {achievement.game.name}
                    </Link>
                    {' · '}
                    {formatDate(achievement.unlockedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <SectionHeading>Progress by game</SectionHeading>
        <div className="card divide-y divide-ink-850">
          {started.map((game) => {
            // With no trustworthy total there is no meaningful bar, so the
            // gamerscore ratio stands in where the provider gave one.
            const percent = game.totalKnown && game.total > 0
              ? (game.unlocked / game.total) * 100
              : game.totalPoints && game.totalPoints > 0
                ? Math.min(100, (game.points ?? 0) / game.totalPoints * 100)
                : 0;
            return (
              <Link
                key={game.gameId}
                href={`/game/${game.slug}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-ink-850/40"
              >
                {game.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={game.coverImage}
                    alt=""
                    className="h-14 w-10 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="h-14 w-10 shrink-0 rounded bg-ink-850" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-ink-100">{game.name}</span>
                    <span className="stat-figure shrink-0 text-xs text-ink-400">
                      {game.totalKnown
                        ? `${game.unlocked} / ${game.total}`
                        : `${game.unlocked} unlocked`}
                    </span>
                  </div>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-850">
                    <div
                      className={`h-full rounded-full ${
                        percent === 100 ? 'bg-positive' : 'bg-accent'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <div className="mt-1.5 text-xs text-ink-600">
                    {providerLabel(game.provider)}
                    {game.lastUnlockedAt ? ` · last ${formatDate(game.lastUnlockedAt)}` : ''}
                    {/* Says plainly that this row is the provider's own count
                        rather than achievements we hold, so an absent list of
                        names reads as pending rather than as missing data. */}
                    {!game.detailed ? ' · details not fetched yet' : ''}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {untouched.length > 0 ? (
          <p className="mt-3 text-xs text-ink-600">
            {untouched.length} more {untouched.length === 1 ? 'game has' : 'games have'} achievements
            you have not started.
          </p>
        ) : null}
      </section>
    </>
  );
}

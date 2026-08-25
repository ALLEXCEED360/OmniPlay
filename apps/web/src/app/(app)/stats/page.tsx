import { apiFetch } from '@/lib/api';
import { formatHours, providerLabel } from '@/lib/format';
import { ConfidenceNote, PageHeader, ProportionBar, SectionHeading, StatCard } from '@/components/ui';

/**
 * Statistics (spec 4.4, 4.5).
 *
 * Answers "what kind of gamer am I?" from deterministic aggregates. No model,
 * no inference beyond what the data supports - the Gaming DNA panel is
 * heuristics over recorded time, exactly as the spec describes.
 */

interface Overview {
  library: {
    totalGames: number;
    currentlyOwned: number;
    previouslyOwned: number;
    gamesPlayed: number;
    completed: number;
    abandoned: number;
    backlog: number;
    completionRate: number;
    gamesByProvider: Record<string, number>;
  };
  playtime: {
    totalMinutes: number;
    byProvider: Record<string, number>;
    byYear: Record<string, number>;
    unattributedMinutes: number;
  };
}

interface YearStats {
  year: number;
  gamesPlayed: number;
  totalMinutes: number;
  completed: number;
  newGames: number;
  topGenres: Array<{ genre: string; minutes: number }>;
  topGames: Array<{ name?: string; slug?: string; minutes: number }>;
}

export default async function StatsPage() {
  const currentYear = new Date().getFullYear();
  const [overview, thisYear] = await Promise.all([
    apiFetch<Overview>('/stats/overview'),
    apiFetch<YearStats>(`/stats/year/${currentYear}`),
  ]);

  const providerMinutes = Object.entries(overview.playtime.byProvider).sort((a, b) => b[1] - a[1]);
  const maxProviderMinutes = Math.max(1, ...providerMinutes.map(([, m]) => m));
  const maxGenreMinutes = Math.max(1, ...thisYear.topGenres.map((g) => g.minutes));

  return (
    <>
      <PageHeader title="Statistics" subtitle="What your gaming history adds up to." />

      <section>
        <SectionHeading>All time</SectionHeading>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total hours" value={formatHours(overview.playtime.totalMinutes)} accent />
          <StatCard label="Games played" value={overview.library.gamesPlayed} hint={`of ${overview.library.totalGames} owned`} />
          <StatCard label="Completed" value={overview.library.completed} />
          <StatCard
            label="Completion rate"
            value={`${Math.round(overview.library.completionRate * 100)}%`}
            hint="of games started"
          />
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading>Your {currentYear}</SectionHeading>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Games played" value={thisYear.gamesPlayed} />
          <StatCard label="Hours" value={formatHours(thisYear.totalMinutes)} />
          <StatCard label="Completed" value={thisYear.completed} />
          <StatCard label="New games" value={thisYear.newGames} />
        </div>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <SectionHeading>Time by platform</SectionHeading>
          {providerMinutes.length === 0 ? (
            <p className="text-sm text-ink-500">No playtime recorded yet.</p>
          ) : (
            <div className="space-y-4">
              {providerMinutes.map(([provider, minutes]) => (
                <ProportionBar
                  key={provider}
                  label={providerLabel(provider)}
                  value={minutes}
                  max={maxProviderMinutes}
                  caption={formatHours(minutes)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Gaming DNA: deterministic, not a model (spec 4.5). */}
        <section className="card p-6">
          <SectionHeading>Gaming DNA</SectionHeading>
          {thisYear.topGenres.length === 0 ? (
            <p className="text-sm text-ink-500">
              Not enough genre data yet. Metadata arrives as games are matched against IGDB.
            </p>
          ) : (
            <div className="space-y-4">
              {thisYear.topGenres.map((genre) => (
                <ProportionBar
                  key={genre.genre}
                  label={genre.genre}
                  value={genre.minutes}
                  max={maxGenreMinutes}
                  caption={formatHours(genre.minutes)}
                  tone="violet"
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-10">
        <SectionHeading>Library breakdown</SectionHeading>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Owned now" value={overview.library.currentlyOwned} />
          <StatCard label="Previously owned" value={overview.library.previouslyOwned} />
          <StatCard label="Backlog" value={overview.library.backlog} hint="Never started" />
          <StatCard label="Abandoned" value={overview.library.abandoned} />
        </div>
      </section>

      {overview.playtime.unattributedMinutes > 0 ? (
        <p className="mt-6">
          <ConfidenceNote>
            {formatHours(overview.playtime.unattributedMinutes)} of your total is reported by
            providers as a lifetime figure with no dates, so it is counted in your all-time hours
            but cannot appear in any yearly breakdown.
          </ConfidenceNote>
        </p>
      ) : null}
    </>
  );
}

import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatHours, formatRelative, providerLabel } from '@/lib/format';
import {
  ConfidenceNote,
  EmptyState,
  PageHeader,
  ProportionBar,
  SectionHeading,
  StatCard,
} from '@/components/ui';
import { SyncButton } from '@/components/sync-button';

/**
 * Overview (spec 16).
 *
 * Answers one question - "what is happening with my gaming life?" - and
 * deliberately stops there. The spec is explicit that this must not become a
 * data dump; anything exhaustive belongs on Library or Statistics.
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
    byYear: Record<string, number>;
    unattributedMinutes: number;
  };
  accounts: Array<{
    provider: string;
    displayName: string | null;
    status: string;
    lastSyncAt: string | null;
  }>;
  currentlyPlaying: Array<{ name: string; slug: string; coverImage: string | null }>;
  mostPlayed: Array<{ name: string; slug: string; coverImage: string | null; minutes: number }>;
  lastSyncAt: string | null;
}

export default async function DashboardPage() {
  const data = await apiFetch<Overview>('/stats/overview');

  if (data.accounts.length === 0) {
    return (
      <>
        <PageHeader title={greeting()} subtitle="Let's build your gaming identity." />
        <EmptyState
          title="Connect your first account"
          description="OMNIPLAY reads your library, playtime and achievements from the platforms you play on, then unifies them into one history."
          action={
            <Link
              href="/settings"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-accent-strong"
            >
              Connect an account
            </Link>
          }
        />
      </>
    );
  }

  // Every platform that contributed either games or hours, ordered by hours.
  // Hours lead because that is what the headline figure aggregates away: one
  // combined number cannot say that a library is mostly PlayStation.
  const providerEntries = [
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
    .sort((a, b) => b.minutes - a.minutes || b.games - a.games);

  const maxProviderMinutes = Math.max(1, ...providerEntries.map((entry) => entry.minutes));
  const years = Object.entries(data.playtime.byYear)
    .map(([year, minutes]) => ({ year: Number(year), minutes }))
    .sort((a, b) => a.year - b.year);

  return (
    <>
      <PageHeader
        title={greeting()}
        subtitle={
          data.lastSyncAt
            ? `Last synced ${formatRelative(data.lastSyncAt)}`
            : 'No sync has completed yet.'
        }
        action={<SyncButton />}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Games" value={data.library.totalGames} hint={`${data.library.currentlyOwned} owned now`} />
        <StatCard label="Completed" value={data.library.completed} hint={`${Math.round(data.library.completionRate * 100)}% of started`} />
        <StatCard
          label="Hours played"
          value={formatHours(data.playtime.totalMinutes)}
          hint={`across ${providerEntries.filter((entry) => entry.minutes > 0).length} platforms`}
          accent
        />
        <StatCard label="Backlog" value={data.library.backlog} hint="Never started" />
      </div>

      {data.currentlyPlaying.length > 0 ? (
        <section className="mt-10">
          <SectionHeading>Currently playing</SectionHeading>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {data.currentlyPlaying.map((game) => (
              <Link
                key={game.slug}
                href={`/game/${game.slug}`}
                className="group overflow-hidden rounded-[var(--radius-card)] border border-ink-800 bg-ink-900 transition-colors hover:border-ink-600"
              >
                <div className="aspect-[3/4] overflow-hidden bg-ink-850">
                  {game.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={game.coverImage}
                      alt=""
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="line-clamp-2 px-2.5 py-2 text-xs text-ink-300">{game.name}</div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <SectionHeading>Hours by platform</SectionHeading>
          <div className="space-y-4">
            {providerEntries.map((entry) => (
              <ProportionBar
                key={entry.provider}
                label={providerLabel(entry.provider)}
                value={entry.minutes}
                max={maxProviderMinutes}
                caption={`${formatHours(entry.minutes)} · ${entry.games.toLocaleString()} games`}
              />
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-600">
            {formatHours(data.playtime.totalMinutes)} in total. Hours are only added across
            platforms, never within one — a game owned twice on the same platform counts each
            copy once.
          </p>
        </section>

        <section className="card p-6">
          {/* Five games is a teaser, and the question it prompts — "what
              about everything else?" — deserves an answer rather than a dead
              end. */}
          <SectionHeading
            action={
              <Link
                href="/most-played"
                className="shrink-0 text-xs font-normal normal-case tracking-normal text-ink-500 transition-colors hover:text-accent"
              >
                See all {data.library.totalGames} &rarr;
              </Link>
            }
          >
            Most played
          </SectionHeading>
          {data.mostPlayed.length === 0 ? (
            <p className="text-sm text-ink-500">No playtime recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {data.mostPlayed.map((game, index) => (
                <li key={game.slug} className="flex items-center gap-3">
                  <span className="stat-figure w-5 shrink-0 text-sm text-ink-600">{index + 1}</span>
                  <Link
                    href={`/game/${game.slug}`}
                    className="min-w-0 flex-1 truncate text-sm text-ink-200 hover:text-accent"
                  >
                    {game.name}
                  </Link>
                  <span className="stat-figure shrink-0 text-sm text-ink-400">
                    {formatHours(game.minutes)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="mt-10 card p-6">
        <SectionHeading>Activity by year</SectionHeading>
        {years.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-500">
              No dated activity yet. Your connected platforms report total playtime without telling
              us when those hours happened.
            </p>
            {data.playtime.unattributedMinutes > 0 ? (
              <ConfidenceNote>
                {formatHours(data.playtime.unattributedMinutes)} recorded without a date
              </ConfidenceNote>
            ) : null}
          </div>
        ) : (
          <>
            <YearChart years={years} />
            {data.playtime.unattributedMinutes > 0 ? (
              <div className="mt-4">
                <ConfidenceNote>
                  A further {formatHours(data.playtime.unattributedMinutes)} could not be placed in
                  time — providers report it as a lifetime total only.
                </ConfidenceNote>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

/** Bar chart rendered server-side; no client JS for a static visual. */
function YearChart({ years }: { years: Array<{ year: number; minutes: number }> }) {
  const max = Math.max(...years.map((y) => y.minutes), 1);

  return (
    <div className="flex h-40 items-end gap-2">
      {years.map((entry) => (
        <div key={entry.year} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div
            className="w-full rounded-t bg-gradient-to-t from-accent/40 to-accent transition-all"
            style={{ height: `${Math.max(4, (entry.minutes / max) * 100)}%` }}
            title={`${entry.year}: ${formatHours(entry.minutes)}`}
          />
          <span className="stat-figure text-[10px] text-ink-500">{entry.year}</span>
        </div>
      ))}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

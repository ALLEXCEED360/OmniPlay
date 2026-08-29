import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatHours, formatRelative, providerLabel } from '@/lib/format';
import { ConfidenceNote, EmptyState, PageHeader, SectionHeading } from '@/components/ui';
import { SyncButton } from '@/components/sync-button';

/**
 * Overview (spec 16).
 *
 * Answers one question — "what is happening with my gaming life?" — and
 * deliberately stops there. The spec is explicit that this must not become a
 * data dump; anything exhaustive belongs on Library or Statistics.
 *
 * Rebuilt around the one thing no storefront can tell you. Four loose stat
 * cards and a bar chart said nothing a single platform could not have said
 * better about itself; what only this app knows is that Apex Legends is 633
 * hours *once PlayStation and Steam are added together*, and that a decade of
 * history moved between three platforms. Those lead now.
 */

/**
 * A colour per platform, matching the achievements page.
 *
 * Each is the colour the platform is actually known by, so a reader who has
 * seen one screen can read the other without a legend.
 */
const PROVIDER_STYLE: Record<string, { bar: string; text: string; ring: string }> = {
  psn: { bar: 'bg-accent', text: 'text-accent', ring: 'ring-accent/40' },
  xbox: { bar: 'bg-positive', text: 'text-positive', ring: 'ring-positive/40' },
  steam: { bar: 'bg-violet', text: 'text-violet', ring: 'ring-violet/40' },
};

const styleFor = (provider: string) =>
  PROVIDER_STYLE[provider] ?? { bar: 'bg-ink-500', text: 'text-ink-300', ring: 'ring-ink-600' };

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
  activityByYear: Array<{ year: number; activeDays: number; unlocks: number; started: number }>;
  crossPlatform: Array<{
    name: string;
    slug: string;
    coverImage: string | null;
    providers: string[];
    minutes: number;
  }>;
  unlocks: { unlocked: number; years: number; first: string | null; last: string | null };
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
    .sort((a, b) => b.minutes - a.minutes || b.games - a.games);

  const totalMinutes = data.playtime.totalMinutes || 1;
  const years = data.activityByYear.slice().sort((a, b) => a.year - b.year);
  const maxDays = Math.max(...years.map((entry) => entry.activeDays), 1);
  const activeDays = years.reduce((sum, entry) => sum + entry.activeDays, 0);
  const span =
    years.length > 0 ? `${years[0]?.year}–${years[years.length - 1]?.year}` : '—';

  return (
    <>
      <PageHeader
        title={greeting()}
        subtitle={data.lastSyncAt ? `Last synced ${formatRelative(data.lastSyncAt)}` : 'Never synced'}
        action={<SyncButton />}
      />

      {/* The library in one line, then how it divides.
          A single combined total is the least interesting way to state a
          cross-platform history — it is precisely the number each storefront
          already refuses to give you, and it hides which platform the hours
          came from. */}
      <section className="card overflow-hidden p-0">
        <div className="grid gap-px bg-ink-850 sm:grid-cols-4">
          {[
            ['Hours played', formatHours(data.playtime.totalMinutes), `across ${platforms.length} platforms`],
            ['Games', data.library.totalGames.toLocaleString(), `${data.library.gamesPlayed} played`],
            ['Achievements', data.unlocks.unlocked.toLocaleString(), `${data.library.completed} games complete`],
            ['Active days', activeDays.toLocaleString(), span],
          ].map(([label, value, hint], index) => (
            <div key={label} className="bg-ink-900 p-5">
              <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
              <div
                className={`stat-figure mt-1 text-3xl ${index === 0 ? 'text-accent' : 'text-ink-100'}`}
              >
                {value}
              </div>
              <div className="mt-1 text-[11px] text-ink-600">{hint}</div>
            </div>
          ))}
        </div>

        {/* One bar, segmented by platform. The split is the point. */}
        <div className="border-t border-ink-850 p-5">
          <div className="flex h-3 overflow-hidden rounded-full bg-ink-850">
            {platforms.map((platform) => (
              <div
                key={platform.provider}
                className={styleFor(platform.provider).bar}
                style={{ width: `${(platform.minutes / totalMinutes) * 100}%` }}
                title={`${providerLabel(platform.provider)} · ${formatHours(platform.minutes)}`}
              />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {platforms.map((platform) => {
              const style = styleFor(platform.provider);
              return (
                <div key={platform.provider} className="flex items-baseline gap-2">
                  <span className={`size-2.5 rounded-sm ${style.bar}`} aria-hidden />
                  <span className="text-xs text-ink-300">{providerLabel(platform.provider)}</span>
                  <span className="stat-figure text-xs text-ink-100">
                    {formatHours(platform.minutes)}
                  </span>
                  <span className="text-[11px] text-ink-600">{platform.games} games</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {data.crossPlatform.length > 0 ? (
        <section className="mt-10">
          <SectionHeading
            action={
              <Link
                href="/library"
                className="shrink-0 text-xs font-normal normal-case tracking-normal text-ink-500 transition-colors hover:text-accent"
              >
                Open library &rarr;
              </Link>
            }
          >
            Played on more than one platform
          </SectionHeading>

          {/* The reason this app exists. Apex Legends is 633 hours only once
              two platforms are added together, and neither platform will ever
              show you that number. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {data.crossPlatform.map((game) => (
              <Link
                key={game.slug}
                href={`/game/${game.slug}`}
                className="group relative block overflow-hidden rounded-[var(--radius-card)] border border-ink-800 bg-ink-900 transition-transform hover:-translate-y-0.5"
              >
                <div className="aspect-[3/4] overflow-hidden bg-ink-850">
                  {game.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={game.coverImage}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : null}
                </div>

                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950 via-ink-950/85 to-transparent p-2 pt-8">
                  <div className="line-clamp-1 text-[11px] text-ink-200">{game.name}</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1">
                      {game.providers.map((provider) => (
                        <span
                          key={provider}
                          className={`size-2 rounded-full ${styleFor(provider).bar}`}
                          title={providerLabel(provider)}
                        />
                      ))}
                    </span>
                    <span className="stat-figure text-[11px] text-accent">
                      {formatHours(game.minutes)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <p className="mt-4">
            <ConfidenceNote>
              Hours are added across platforms because they describe different playthroughs —
              never added within one, where a provider re-reports the same running total.
            </ConfidenceNote>
          </p>
        </section>
      ) : null}

      {data.currentlyPlaying.length > 0 ? (
        <section className="mt-10">
          <SectionHeading>Currently playing</SectionHeading>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
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
                      loading="lazy"
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

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="card p-6">
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
              {data.mostPlayed.map((game, index) => {
                const top = data.mostPlayed[0]?.minutes || 1;
                return (
                  <li key={game.slug}>
                    <Link href={`/game/${game.slug}`} className="group flex items-center gap-3">
                      <span className="stat-figure w-4 shrink-0 text-xs text-ink-600">
                        {index + 1}
                      </span>
                      {game.coverImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={game.coverImage}
                          alt=""
                          loading="lazy"
                          className="h-11 w-8 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="h-11 w-8 shrink-0 rounded bg-ink-850" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm text-ink-200 group-hover:text-accent">
                            {game.name}
                          </span>
                          <span className="stat-figure shrink-0 text-xs text-ink-300">
                            {formatHours(game.minutes)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-850">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${Math.max(2, (game.minutes / top) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="card p-6">
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
            Activity by year
          </SectionHeading>

          {years.length === 0 ? (
            <p className="text-sm text-ink-500">
              No dated activity yet. Achievement unlocks carry dates, so they appear here as you
              earn them.
            </p>
          ) : (
            <>
              {/* Rows, not columns. Eleven vertical bars in a half-width card
                  leaves each one a few pixels across with the year turned
                  sideways underneath; laid out as rows the label, the bar and
                  the figure all sit on one line and the busy years are obvious
                  at a glance. */}
              <ol className="space-y-1">
                {[...years].reverse().map((entry) => {
                  const share = entry.activeDays / maxDays;
                  return (
                    <li
                      key={entry.year}
                      className="group grid grid-cols-[2.5rem_1fr_2.75rem] items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-ink-850/50"
                      title={
                        `${entry.year}: ${entry.activeDays} active days` +
                        (entry.unlocks > 0 ? `, ${entry.unlocks} unlocks` : '') +
                        (entry.started > 0 ? `, ${entry.started} games started` : '')
                      }
                    >
                      <span className="stat-figure text-xs text-ink-500 transition-colors group-hover:text-ink-200">
                        {entry.year}
                      </span>

                      <span className="relative block h-2.5 overflow-hidden rounded-full bg-ink-850">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent/50 to-accent transition-[width] duration-300"
                          style={{ width: `${Math.max(3, share * 100)}%` }}
                        />
                      </span>

                      <span className="stat-figure text-right text-xs text-ink-300">
                        {entry.activeDays}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-3 flex items-baseline justify-between border-t border-ink-850 pt-3 text-[11px] text-ink-600">
                <span>Days with recorded activity</span>
                <span className="stat-figure text-ink-400">
                  {activeDays.toLocaleString()} total
                </span>
              </div>

              {data.playtime.unattributedMinutes > 0 ? (
                <div className="mt-4">
                  {/* Days, not hours, and the reason is worth stating: nearly
                      all of this playtime is a lifetime total with no date, so
                      spreading it over years would invent a distribution. */}
                  <ConfidenceNote>
                    {formatHours(data.playtime.unattributedMinutes)} of playtime cannot be placed
                    in any year — providers report it as an undated lifetime total, so this
                    counts days rather than hours.
                  </ConfidenceNote>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up?';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

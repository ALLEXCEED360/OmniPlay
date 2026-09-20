import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatHours, formatRelative, providerLabel } from '@/lib/format';
import { ConfidenceNote, EmptyState, PageHeader, SectionHeading } from '@/components/ui';
import { SyncButton } from '@/components/sync-button';
import { Counter } from '@/components/counter';
import { Reveal, TiltLink } from '@/components/motion';
import { platformStyle, staggerStep } from '@/lib/platform';
import type { CSSProperties } from 'react';

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
              className="btn-primary"
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
        eyebrow="Overview"
        title={greeting()}
        subtitle={data.lastSyncAt ? `Last synced ${formatRelative(data.lastSyncAt)}` : 'Never synced'}
        action={<SyncButton />}
      />

      {/* The library in one line, then how it divides. The headline figure
          sits on paper, the three beside it in ink: one off-white cut-out
          per screen, and this is the one — the total no storefront can give
          you, in the largest type on the page. */}
      <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="hard-shadow anim-rise" style={{ '--i': 1 } as CSSProperties}>
          <div className="paper cut relative h-full overflow-hidden p-6 sm:p-7">
            <span className="pointer-events-none absolute -right-10 -top-10 size-40 rotate-12 bg-accent/10" aria-hidden />
            <div className="eyebrow text-accent">Hours played</div>
            <div className="display mt-3 text-[4rem] leading-none text-ink-950 sm:text-[5.5rem]">
              <Counter value={data.playtime.totalMinutes} kind="hours" />
            </div>
            <div className="mt-3 font-display text-sm font-semibold uppercase tracking-wider text-ink-700">
              across {platforms.length} platforms
            </div>
          </div>
        </div>

        {(
          [
            {
              label: 'Games',
              value: data.library.totalGames,
              hint: `${data.library.gamesPlayed} played`,
            },
            {
              label: 'Achievements',
              value: data.unlocks.unlocked,
              hint: `${data.library.completed} games complete`,
            },
            {
              label: 'Active days',
              value: activeDays,
              hint: span,
            },
          ]
        ).map((stat, index) => (
          <div
            key={stat.label}
            className="card anim-rise stagger group relative p-5"
            style={{ '--i': index + 2 } as CSSProperties}
          >
            <span
              className="absolute left-0 top-0 h-1.5 w-10 origin-left -skew-x-[20deg] bg-accent transition-transform duration-300 group-hover:scale-x-[2.5]"
              aria-hidden
            />
            <div className="eyebrow text-ink-500">{stat.label}</div>
            <div className="stat-figure mt-2 text-3xl text-ink-100 sm:text-[2.25rem]">
              <Counter value={stat.value} kind="count" />
            </div>
            <div className="mt-1 text-[11px] text-ink-600">{stat.hint}</div>
          </div>
        ))}
      </section>

      {/* One bar, segmented by platform. The split is the point. */}
      <section className="card anim-rise stagger mt-3 p-5" style={{ '--i': 5 } as CSSProperties}>
        <div className="flex h-3.5 -skew-x-[20deg] gap-0.5 overflow-hidden bg-ink-850">
          {platforms.map((platform, index) => (
            <div
              key={platform.provider}
              className={`anim-grow stagger ${platformStyle(platform.provider).bar}`}
              style={
                {
                  width: `${(platform.minutes / totalMinutes) * 100}%`,
                  '--i': index,
                  '--stagger-step': '90ms',
                } as CSSProperties
              }
              title={`${providerLabel(platform.provider)} · ${formatHours(platform.minutes)}`}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-7 gap-y-2">
          {platforms.map((platform, index) => {
            const style = platformStyle(platform.provider);
            const share = Math.round((platform.minutes / totalMinutes) * 100);
            return (
              <div
                key={platform.provider}
                className="anim-fade stagger flex items-baseline gap-2"
                style={{ '--i': index + 4 } as CSSProperties}
              >
                <span className={`size-2.5 -skew-x-[20deg] ${style.bar}`} aria-hidden />
                <span className="font-display text-sm font-semibold uppercase tracking-wider text-ink-300">
                  {providerLabel(platform.provider)}
                </span>
                <span className={`stat-figure text-sm ${style.text}`}>
                  {formatHours(platform.minutes)}
                </span>
                <span className="text-[11px] text-ink-600">
                  {share}% · {platform.games} games
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {data.crossPlatform.length > 0 ? (
        <Reveal className="mt-12">
          <SectionHeading action={<More href="/library">Open library</More>}>
            Played on more than one platform
          </SectionHeading>

          {/* The reason this app exists. Apex Legends is 633 hours only once
              two platforms are added together, and neither platform will ever
              show you that number. */}
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
            style={{ '--stagger-step': staggerStep(data.crossPlatform.length) } as CSSProperties}
          >
            {data.crossPlatform.map((game, index) => (
              <TiltLink
                key={game.slug}
                href={`/game/${game.slug}`}
                style={{ '--i': index } as CSSProperties}
                className="group anim-rise stagger cut-sm relative block overflow-hidden bg-ink-900"
              >
                {/* A red ribbon across the corner: this game's whole point is
                    that it lives on more than one platform. */}
                <span
                  className="pointer-events-none absolute -right-9 top-3 z-10 w-32 rotate-45 bg-accent py-0.5 text-center font-display text-[9px] font-bold uppercase tracking-[0.2em] text-ink-950"
                  aria-hidden
                >
                  {game.providers.length} platforms
                </span>
                <div className="aspect-[3/4] overflow-hidden bg-ink-850">
                  {game.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={game.coverImage}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
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
                          className={`size-2 -skew-x-[20deg] ${platformStyle(provider).bar}`}
                          title={providerLabel(provider)}
                        />
                      ))}
                    </span>
                    <span className="stat-figure text-[11px] text-accent">
                      {formatHours(game.minutes)}
                    </span>
                  </div>
                </div>
              </TiltLink>
            ))}
          </div>

          <p className="mt-4">
            <ConfidenceNote>
              Hours are added across platforms because they describe different playthroughs —
              never added within one, where a provider re-reports the same running total.
            </ConfidenceNote>
          </p>
        </Reveal>
      ) : null}

      {data.currentlyPlaying.length > 0 ? (
        <Reveal className="mt-12">
          <SectionHeading>Currently playing</SectionHeading>
          <div
            className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6"
            style={{ '--stagger-step': staggerStep(data.currentlyPlaying.length) } as CSSProperties}
          >
            {data.currentlyPlaying.map((game, index) => (
              <TiltLink
                key={game.slug}
                href={`/game/${game.slug}`}
                style={{ '--i': index } as CSSProperties}
                className="group anim-rise stagger cut-sm block overflow-hidden bg-ink-900"
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
                <div className="line-clamp-2 px-2.5 py-2 font-display text-sm font-semibold uppercase leading-tight tracking-wide text-ink-300">
                  {game.name}
                </div>
              </TiltLink>
            ))}
          </div>
        </Reveal>
      ) : null}

      <div className="mt-12 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Reveal className="card p-6">
          <SectionHeading action={<More href="/most-played">See all {data.library.totalGames}</More>}>
            Most played
          </SectionHeading>

          {data.mostPlayed.length === 0 ? (
            <p className="text-sm text-ink-500">No playtime recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {data.mostPlayed.map((game, index) => {
                const top = data.mostPlayed[0]?.minutes || 1;
                return (
                  <li
                    key={game.slug}
                    className="anim-rise stagger"
                    style={{ '--i': index } as CSSProperties}
                  >
                    <Link
                      href={`/game/${game.slug}`}
                      className="group -mx-2 flex items-center gap-3 px-2 py-1 transition-colors hover:bg-ink-850/60"
                    >
                      <span className="display w-6 shrink-0 text-xl text-ink-700 transition-colors group-hover:text-accent">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      {game.coverImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={game.coverImage}
                          alt=""
                          loading="lazy"
                          className="h-11 w-8 shrink-0 object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                      ) : (
                        <span className="h-11 w-8 shrink-0 bg-ink-850" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-display text-[15px] font-semibold uppercase tracking-wide text-ink-200 group-hover:text-accent">
                            {game.name}
                          </span>
                          <span className="stat-figure shrink-0 text-xs text-ink-300">
                            {formatHours(game.minutes)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 -skew-x-[20deg] overflow-hidden bg-ink-850">
                          <div
                            className="anim-grow stagger h-full bg-accent"
                            style={
                              {
                                width: `${Math.max(2, (game.minutes / top) * 100)}%`,
                                '--i': index,
                                '--stagger-step': '70ms',
                              } as CSSProperties
                            }
                          />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Reveal>

        <Reveal className="card p-6" index={2}>
          <SectionHeading action={<More href="/timeline">Open timeline</More>}>
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
              <ol className="space-y-1" style={{ '--stagger-step': '40ms' } as CSSProperties}>
                {[...years].reverse().map((entry, index) => {
                  const share = entry.activeDays / maxDays;
                  return (
                    <li
                      key={entry.year}
                      style={{ '--i': index } as CSSProperties}
                      className="group anim-fade stagger grid grid-cols-[2.5rem_1fr_2.75rem] items-center gap-3 px-1 py-1 transition-colors hover:bg-ink-850/50"
                      title={
                        `${entry.year}: ${entry.activeDays} active days` +
                        (entry.unlocks > 0 ? `, ${entry.unlocks} unlocks` : '') +
                        (entry.started > 0 ? `, ${entry.started} games started` : '')
                      }
                    >
                      <span className="stat-figure text-xs text-ink-500 transition-colors group-hover:text-ink-200">
                        {entry.year}
                      </span>

                      <span className="relative block h-2.5 -skew-x-[20deg] overflow-hidden bg-ink-850">
                        <span
                          className="anim-grow stagger absolute inset-y-0 left-0 bg-gradient-to-r from-violet to-accent"
                          style={
                            {
                              width: `${Math.max(3, share * 100)}%`,
                              '--i': index,
                              '--stagger-step': '55ms',
                            } as CSSProperties
                          }
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
        </Reveal>
      </div>
    </>
  );
}

/** The "see more" link a section heading carries, in the display cut. */
function More({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group shrink-0 font-display text-sm font-semibold uppercase tracking-wider text-ink-500 transition-colors hover:text-accent"
    >
      {children}{' '}
      <span className="inline-block transition-transform duration-200 group-hover:translate-x-1">
        &rarr;
      </span>
    </Link>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up?';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

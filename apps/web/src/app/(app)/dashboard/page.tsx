import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatHours, formatRelative, providerLabel } from '@/lib/format';
import { ConfidenceNote, EmptyState, PageHeader } from '@/components/ui';
import { SyncButton } from '@/components/sync-button';
import { Counter } from '@/components/counter';
import { TiltLink } from '@/components/motion';
import { platformStyle, staggerStep } from '@/lib/platform';
import type { CSSProperties } from 'react';

/**
 * Overview (spec 16).
 *
 * Answers one question — "what is happening with my gaming life?" — and
 * deliberately stops there. The spec is explicit that this must not become a
 * data dump; anything exhaustive belongs on Library or Statistics.
 *
 * Built around the one thing no storefront can tell you. What only this app
 * knows is that Apex Legends is 633 hours *once PlayStation and Steam are
 * added together*, and that a decade of history moved between three
 * platforms. Those lead; loose stat cards a single platform could show
 * better about itself do not.
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
        <PageHeader
          eyebrow="Overview"
          title={greeting()}
          subtitle="Let's build your gaming identity."
          art="/backdrop/menu/overview.jpg"
        />
        <EmptyState
          title="Connect your first account"
          description="OMNIPLAY reads your library, playtime and achievements from the platforms you play on, then unifies them into one history."
          action={
            <Link href="/settings" className="btn-primary">
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
  const topMinutes = data.mostPlayed[0]?.minutes || 1;

  return (
    <>
      {/* ── The hero: the greeting on the key art, the headline figure on
          paper beside it, and the platform split running under both. ── */}
      <PageHeader
        eyebrow="Overview"
        title={greeting()}
        subtitle={data.lastSyncAt ? `Last synced ${formatRelative(data.lastSyncAt)}` : 'Never synced'}
        action={<SyncButton />}
        art="/backdrop/menu/overview.jpg"
      />

      {/* ── The board. Three columns on a wide screen: the platforms and the
          years down the left, the games across the middle, the ranking and
          the counts down the right. Every panel is a readout, every readout
          is numbered, and the whole width of the screen is the board. ── */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(17rem,1fr)_minmax(0,2.6fr)_minmax(17rem,1fr)] 2xl:gap-5">
        {/* ── Left: platforms, then years ─────────────────────────── */}
        <div className="flex flex-col gap-4 2xl:gap-5">
          <Panel title="Hours played" tone="paper" className="anim-rise">
            <div className="display mt-1 text-[clamp(3.5rem,4.5vw,5.5rem)] leading-none text-ink-950">
              <Counter value={data.playtime.totalMinutes} kind="hours" />
            </div>
            <div className="mt-2 font-display text-sm font-semibold uppercase tracking-wider text-ink-700">
              across {platforms.length} platforms
            </div>

            {/* One bar, segmented by platform. The split is the point: it
                is precisely the number each storefront refuses to give you. */}
            <div className="mt-5 flex h-2.5 -skew-x-[20deg] gap-0.5 overflow-hidden bg-ink-950/10">
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
            <ol className="mt-4 space-y-2">
              {platforms.map((platform, index) => {
                const style = platformStyle(platform.provider);
                const share = Math.round((platform.minutes / totalMinutes) * 100);
                return (
                  <li
                    key={platform.provider}
                    className="anim-fade stagger flex items-baseline justify-between gap-3"
                    style={{ '--i': index + 3 } as CSSProperties}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`size-2.5 -skew-x-[20deg] ${style.bar}`} aria-hidden />
                      <span className="font-display text-sm font-semibold uppercase tracking-wider text-ink-800">
                        {providerLabel(platform.provider)}
                      </span>
                    </span>
                    <span className="stat-figure whitespace-nowrap text-right text-sm text-ink-900">
                      {formatHours(platform.minutes)}
                      <span className="block text-[11px] font-normal text-ink-600">
                        {share}% · {platform.games} games
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <Panel
            title="Days played"
            action={<More href="/timeline">Timeline</More>}
            className="anim-rise stagger"
            style={{ '--i': 2 } as CSSProperties}
          >
            {years.length === 0 ? (
              <p className="text-sm text-ink-500">
                No dated activity yet. Achievement unlocks carry dates, so they appear here as
                you earn them.
              </p>
            ) : (
              <>
                {/* Rows, not columns: the label, the bar and the figure all
                    sit on one line and the busy years are obvious at a
                    glance. */}
                {/* The unit is stated once at the head of the column, not
                    guessed at from the numbers: a 197 with no unit could be
                    hours, games or unlocks. */}
                <div className="mb-1.5 grid grid-cols-[2.5rem_1fr_2.75rem] gap-3 px-1">
                  <span className="eyebrow text-[10px] text-ink-600">Year</span>
                  <span />
                  <span className="eyebrow text-right text-[10px] text-ink-600">Days</span>
                </div>
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
                          <span className="text-[10px] text-ink-600">d</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-3 flex items-baseline justify-between border-t border-ink-800 pt-3 text-[11px] text-ink-600">
                  <span>Days on which you played something, {span}</span>
                  <span className="stat-figure text-ink-400">{activeDays.toLocaleString()} days</span>
                </div>
                {data.playtime.unattributedMinutes > 0 ? (
                  <div className="mt-3">
                    <ConfidenceNote>
                      {formatHours(data.playtime.unattributedMinutes)} of playtime cannot be placed
                      in any year — providers report it as an undated lifetime total, so this
                      counts days rather than hours.
                    </ConfidenceNote>
                  </div>
                ) : null}
              </>
            )}
          </Panel>
        </div>

        {/* ── Middle: the games ────────────────────────────────────── */}
        <div className="flex flex-col gap-4 2xl:gap-5">
          {data.currentlyPlaying.length > 0 ? (
            <Panel
              title="Currently playing"
              className="anim-rise stagger"
              style={{ '--i': 2 } as CSSProperties}
            >
              <div
                className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-4 2xl:grid-cols-6"
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
            </Panel>
          ) : null}
                  {data.crossPlatform.length > 0 ? (
            <Panel
              title="Played on more than one platform"
              action={<More href="/library">Open library</More>}
              className="anim-rise stagger"
              style={{ '--i': 1 } as CSSProperties}
            >
              {/* The reason this app exists. Apex Legends is 633 hours only
                  once two platforms are added together, and neither platform
                  will ever show you that number. */}
              <div
                className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-4 2xl:grid-cols-6"
                style={{ '--stagger-step': staggerStep(data.crossPlatform.length) } as CSSProperties}
              >
                {data.crossPlatform.map((game, index) => (
                  <TiltLink
                    key={game.slug}
                    href={`/game/${game.slug}`}
                    style={{ '--i': index } as CSSProperties}
                    className="group anim-rise stagger cut-sm relative block overflow-hidden bg-ink-900"
                  >
                    {/* The corner ribbon. Wide enough to carry the words at
                        a size that reads, and the words themselves kept
                        short — "2 platforms" at twelve pixels, not letter-
                        spaced, with a hair of ink around them so they hold
                        over a bright cover. */}
                    <span
                      className="pointer-events-none absolute -right-11 top-4 z-10 w-40 rotate-45 bg-accent py-1 text-center font-display text-xs font-bold uppercase leading-none text-ink-950 shadow-[0_1px_0_0_var(--color-ink-950)]"
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
                  Hours are added across platforms because they describe different playthroughs
                  — never added within one, where a provider re-reports the same running total.
                </ConfidenceNote>
              </p>
            </Panel>
          ) : null}

        </div>

        {/* ── Right: the counts, then the ranking ──────────────────── */}
        <div className="flex flex-col gap-4 2xl:gap-5">
          <div className="grid grid-cols-3 gap-4 xl:grid-cols-1 2xl:gap-5">
            {(
              [
                { label: 'Games', value: data.library.totalGames, hint: `${data.library.gamesPlayed} played` },
                { label: 'Achievements', value: data.unlocks.unlocked, hint: `${data.library.completed} games complete` },
                { label: 'Active days', value: activeDays, hint: span },
              ] as const
            ).map((stat, index) => (
              <div
                key={stat.label}
                className="card hud-corners anim-rise stagger group relative p-5"
                style={{ '--i': index + 2 } as CSSProperties}
              >
                <div className="eyebrow text-ink-500">{stat.label}</div>
                <div className="stat-figure mt-2 text-[2.25rem] leading-none text-ink-100">
                  <Counter value={stat.value} kind="count" />
                </div>
                <div className="mt-2 text-[11px] text-ink-600">{stat.hint}</div>
              </div>
            ))}
          </div>

          <Panel
            title="Most played"
            action={<More href="/most-played">All {data.library.totalGames}</More>}
            className="anim-rise stagger"
            style={{ '--i': 3 } as CSSProperties}
          >
            {data.mostPlayed.length === 0 ? (
              <p className="text-sm text-ink-500">No playtime recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {data.mostPlayed.map((game, index) => (
                  <li key={game.slug} className="anim-rise stagger" style={{ '--i': index } as CSSProperties}>
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
                                width: `${Math.max(2, (game.minutes / topMinutes) * 100)}%`,
                                '--i': index,
                                '--stagger-step': '70ms',
                              } as CSSProperties
                            }
                          />
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * A readout on the board: a cornered panel. `paper` is for the one figure
 * per screen allowed to shout.
 */
function Panel({
  title,
  action,
  tone = 'ink',
  className,
  style,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  tone?: 'ink' | 'paper';
  className?: string;
  style?: CSSProperties;
  children: React.ReactNode;
}) {
  const paper = tone === 'paper';
  const body = (
    <section
      className={`${paper ? 'paper cut' : 'card hud-corners'} relative p-5 2xl:p-6 ${paper ? '' : className ?? ''}`}
      style={paper ? undefined : style}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className={`display flex items-center gap-2.5 text-[1.25rem] ${paper ? 'text-ink-950' : 'text-ink-100'}`}>
          <span className={`slash ${paper ? 'bg-accent-strong' : ''}`} aria-hidden />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
  return paper ? (
    <div className={`hard-shadow ${className ?? ''}`} style={style}>
      {body}
    </div>
  ) : (
    body
  );
}

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

import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { formatDate, formatHours, providerLabel } from '@/lib/format';
import { platformStyle, staggerStep } from '@/lib/platform';
import { apiFetchOrNull } from '@/lib/api';
import { Wordmark } from '@/components/wordmark';
import { Backdrop } from '@/components/backdrop';
import { Hud } from '@/components/hud';
import { Motion } from '@/components/motion';
import { Counter } from '@/components/counter';
import { PageHeader, PlatformBadge, SectionHeading } from '@/components/ui';
import { PlatformPanel } from '@/components/platform-panel';
import { ShareLink } from '@/components/share-link';
import type { CSSProperties } from 'react';

/**
 * The public profile (spec 4.7): a player card.
 *
 * Outside the authenticated shell on purpose: this page is the shareable
 * artefact, and it must render for someone with no OMNIPLAY account. It
 * still dresses like every other screen — the city behind it, the HUD
 * across the top, the page's own art in the header — so a link out of the
 * app lands somewhere that is recognisably the same place. A signed-in
 * reader gets the real HUD; a stranger gets a bar with the way in.
 *
 * The session cookie is forwarded only so the owner can see their own page
 * before it is public; a stranger's request carries none.
 */

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface PublicProfile {
  username: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  memberSince: string;
  isPublic: boolean;
  isOwner: boolean;
  stats: {
    totalGames: number;
    completed: number;
    totalMinutes: number;
    gamesPlayed: number;
    completionRate: number;
    achievementsUnlocked: number;
    platinums: number;
    firstPlayedAt: string | null;
  };
  rarest: Array<{
    name: string;
    description: string | null;
    iconUrl: string | null;
    provider: string;
    rate: number | null;
    unlockedAt: string | null;
    game: { name: string; slug: string; coverImage: string | null };
  }>;
  genres: Array<{ genre: string; games: number; minutes: number }>;
  platforms: Array<{ provider: string; gameCount: number }>;
  favourites: Array<{ name: string; slug: string; coverImage: string | null; minutes: number }>;
  collections: Array<{
    name: string;
    slug: string;
    description: string | null;
    gameCount: number;
    covers: string[];
  }>;
}

interface Viewer {
  user: { username: string; displayName: string | null };
}

async function fetchProfile(username: string): Promise<PublicProfile | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get('omniplay_session');
  const response = await fetch(new URL(`/u/${encodeURIComponent(username)}`, API_URL), {
    headers: session ? { cookie: `${session.name}=${session.value}` } : {},
    // Profiles change only when the owner syncs; a minute of caching keeps a
    // shared link cheap without going noticeably stale.
    next: { revalidate: 60 },
  });
  return response.ok ? ((await response.json()) as PublicProfile) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await fetchProfile(username);
  if (!profile) return { title: 'Profile not found — OMNIPLAY' };

  const name = profile.displayName ?? profile.username;
  const description = `${formatHours(profile.stats.totalMinutes)} across ${
    profile.stats.gamesPlayed
  } games, ${(profile.stats.achievementsUnlocked ?? 0).toLocaleString()} achievements, ${
    profile.stats.completed
  } finished.`;

  return {
    title: `${name} — OMNIPLAY`,
    description,
    // Shareability is the point of this page (spec 4.8), so the card matters.
    openGraph: { title: `${name} on OMNIPLAY`, description, type: 'profile' },
    twitter: { card: 'summary', title: `${name} on OMNIPLAY`, description },
  };
}

/** A rarity as a person would say it. */
function rateLabel(rate: number): string {
  const percent = rate * 100;
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const [profile, viewer] = await Promise.all([
    fetchProfile(username),
    apiFetchOrNull<Viewer>('/auth/me'),
  ]);
  if (!profile) notFound();

  const name = profile.displayName ?? profile.username;
  const { stats } = profile;
  const totalMinutes = stats.totalMinutes || 1;
  // Defaults, because a cached response from before a field existed is a
  // real thing a deploy produces for a minute.
  const rarestAll = profile.rarest ?? [];
  const genres = (profile.genres ?? []).slice(0, 6);
  const genrePeak = genres[0]?.minutes || 1;

  const since = new Date(profile.memberSince);
  const firstPlayed = stats.firstPlayedAt ? new Date(stats.firstPlayedAt) : null;
  const playingSince = firstPlayed && firstPlayed < since ? firstPlayed : since;
  const yearsOfPlay = Math.max(
    1,
    Math.round((Date.now() - playingSince.getTime()) / (365.25 * 24 * 3600 * 1000)),
  );

  const [mostPlayed, ...shelf] = profile.favourites;
  const rarest = rarestAll[0];

  return (
    <Motion>
      <Backdrop />
      <div className="flex min-h-dvh flex-col">
        {viewer ? <Hud user={viewer.user} /> : <PublicBar />}

        <main className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-8 sm:pt-8 2xl:px-12">
          <div className="mx-auto max-w-[1920px]">
            <PageHeader
              art="/backdrop/menu/profile.jpg"
              eyebrow={`Player card · ${yearsOfPlay} ${yearsOfPlay === 1 ? 'year' : 'years'} of play`}
              title={name}
              subtitle={[`@${profile.username}`, profile.bio].filter(Boolean).join(' — ')}
              action={
                <div className="flex items-end gap-4">
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {profile.platforms.map((platform) => (
                        <span
                          key={platform.provider}
                          title={`${platform.gameCount.toLocaleString()} games on ${providerLabel(platform.provider)}`}
                        >
                          <PlatformBadge provider={platform.provider} />
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <ShareLink />
                      {profile.isOwner ? (
                        <Link href="/settings" className="btn-ghost btn-sm">
                          Edit
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <div className="hard-shadow shrink-0">
                    {profile.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.avatar} alt="" className="cut size-24 object-cover sm:size-28" />
                    ) : (
                      <span className="cut grid size-24 place-items-center bg-paper font-display text-4xl font-extrabold italic text-ink-950 sm:size-28">
                        {name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              }
            />

            {profile.isOwner && !profile.isPublic ? (
              <p className="anim-fade -mt-4 mb-8 cut-sm border-l-4 border-warning bg-warning/10 px-4 py-3 text-sm text-ink-200">
                <strong className="font-semibold">Only you can see this page.</strong> A link would
                show a stranger nothing. Turn on{' '}
                <Link href="/settings" className="text-accent underline underline-offset-2">
                  Public profile
                </Link>{' '}
                in Settings to share it.
              </p>
            ) : null}

            {/* ── The tally: the figures on paper, hours leading, the strip
                every figures page wears. ── */}
            <div className="hard-shadow anim-rise">
              <div className="paper cut grid grid-cols-2 divide-ink-950/10 sm:grid-cols-3 sm:divide-x lg:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))]">
                <div className="col-span-2 flex flex-col justify-center px-5 py-5 sm:col-span-3 lg:col-span-1 2xl:px-6">
                  <div className="eyebrow text-ink-700">Hours played</div>
                  <div className="display mt-1 text-[clamp(3.5rem,6vw,5.5rem)] leading-none text-ink-950">
                    <Counter value={stats.totalMinutes} kind="hours" />
                  </div>
                  <div className="mt-2 text-[12px] text-ink-700">
                    {profile.platforms.length > 1
                      ? `across ${profile.platforms.length} platforms, since ${playingSince.getFullYear()}`
                      : `since ${playingSince.getFullYear()}`}
                  </div>
                </div>
                <Tally label="Games played" value={stats.gamesPlayed} note={`of ${stats.totalGames} owned`} />
                <Tally
                  label="Finished"
                  value={stats.completed}
                  note={`${Math.round(stats.completionRate * 100)}% of played`}
                />
                <Tally
                  label="Achievements"
                  value={stats.achievementsUnlocked ?? 0}
                  note="unlocked, all platforms"
                />
                {stats.platinums > 0 ? (
                  <Tally
                    label="Platinums"
                    value={stats.platinums}
                    note="PlayStation"
                    tone="text-[oklch(0.5_0.12_230)]"
                  />
                ) : (
                  <Tally
                    label="Rarest"
                    value={rarest?.rate != null ? rateLabel(rarest.rate) : '—'}
                    note={rarest ? 'of players hold it' : 'no rarity reported'}
                    tone="text-accent-strong"
                  />
                )}
              </div>
            </div>

            {/* ── The board: three columns, the way the overview is laid
                out — the shelf in the middle where the eye lands, the
                platforms and the trophy either side. ── */}
            <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(17rem,1fr)_minmax(0,2.4fr)_minmax(17rem,1fr)] xl:items-start">
              <div className="space-y-8">
                {profile.platforms.length > 0 ? (
                  <section className="anim-rise stagger" style={{ '--i': 2 } as CSSProperties}>
                    <SectionHeading>Platforms</SectionHeading>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                      {profile.platforms.map((platform, index) => (
                        <PlatformPanel
                          key={platform.provider}
                          provider={platform.provider}
                          index={index}
                          watermark="none"
                        >
                          <div className="flex items-end justify-between gap-3">
                            <div>
                              <div className="eyebrow text-ink-500">Games</div>
                              <div className={`display mt-1 text-[2.4rem] leading-none ${platformStyle(platform.provider).text}`}>
                                <Counter value={platform.gameCount} />
                              </div>
                            </div>
                            <div className="text-right text-[11px] text-ink-500">
                              {Math.round((platform.gameCount / Math.max(1, stats.totalGames)) * 100)}% of the
                              library
                            </div>
                          </div>
                        </PlatformPanel>
                      ))}
                    </div>
                  </section>
                ) : null}

                {genres.length > 0 ? (
                  <section className="anim-rise stagger" style={{ '--i': 3 } as CSSProperties}>
                    <SectionHeading>Gaming DNA</SectionHeading>
                    <div className="card hud-corners p-5">
                      <ol className="space-y-3">
                        {genres.map((genre, index) => (
                          <li key={genre.genre}>
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="display truncate text-base text-ink-100">{genre.genre}</span>
                              <span className="stat-figure shrink-0 text-xs text-ink-300">
                                {Math.round((genre.minutes / totalMinutes) * 100)}%
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 -skew-x-[20deg] overflow-hidden bg-ink-850">
                              <div
                                className={`anim-grow stagger h-full ${index === 0 ? 'bg-accent' : 'bg-ink-400'}`}
                                style={
                                  {
                                    width: `${Math.max(2, (genre.minutes / genrePeak) * 100)}%`,
                                    '--i': index + 4,
                                    '--stagger-step': '60ms',
                                  } as CSSProperties
                                }
                              />
                            </div>
                          </li>
                        ))}
                      </ol>
                      <p className="mt-4 border-t border-ink-800 pt-3 text-[11px] leading-snug text-ink-500">
                        Weighted by hours played, not by how many games carry the label.
                      </p>
                    </div>
                  </section>
                ) : null}
              </div>

              {mostPlayed ? (
                <section className="anim-rise stagger" style={{ '--i': 2 } as CSSProperties}>
                  <SectionHeading>Most played</SectionHeading>
                  <Link
                    href={`/game/${mostPlayed.slug}`}
                    className="card hud-corners group relative flex overflow-hidden"
                  >
                    {mostPlayed.coverImage ? (
                      <div className="absolute inset-0" aria-hidden>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={mostPlayed.coverImage}
                          alt=""
                          className="size-full scale-125 object-cover opacity-50 blur-2xl saturate-[0.8] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.35]"
                        />
                        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-ink-950/60 to-ink-950/35" />
                      </div>
                    ) : null}
                    <div className="relative flex w-full items-center gap-5 p-5 sm:gap-7 sm:p-7">
                      {mostPlayed.coverImage ? (
                        <div className="hard-shadow shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mostPlayed.coverImage} alt="" className="cut-sm w-24 sm:w-32" />
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <div className="eyebrow text-accent">The one they kept coming back to</div>
                        <div className="display mt-1 text-2xl leading-tight text-ink-100 transition-colors group-hover:text-accent sm:text-4xl">
                          {mostPlayed.name}
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="display text-3xl text-accent sm:text-4xl">
                            {formatHours(mostPlayed.minutes)}
                          </span>
                          <span className="text-xs text-ink-400">
                            · {Math.round((mostPlayed.minutes / totalMinutes) * 100)}% of everything
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>

                  {shelf.length > 0 ? (
                    <div
                      className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5"
                      style={{ '--stagger-step': staggerStep(shelf.length) } as CSSProperties}
                    >
                      {shelf.map((game, index) => (
                        <Link
                          key={game.slug}
                          href={`/game/${game.slug}`}
                          title={`${game.name} — ${formatHours(game.minutes)}`}
                          style={{ '--i': index + 3 } as CSSProperties}
                          className="group anim-rise stagger lift cut-sm relative overflow-hidden bg-ink-900"
                        >
                          <div className="aspect-[3/4] overflow-hidden bg-ink-850">
                            {game.coverImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={game.coverImage}
                                alt=""
                                className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
                              />
                            ) : (
                              <div className="grid size-full place-items-center px-2 text-center text-[10px] text-ink-500">
                                {game.name}
                              </div>
                            )}
                          </div>
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950 via-ink-950/80 to-transparent px-2 pb-2 pt-6">
                            <div className="line-clamp-1 text-[11px] text-ink-200">{game.name}</div>
                            <div className="stat-figure text-[11px] text-ink-400">{formatHours(game.minutes)}</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  {profile.collections.length > 0 ? (
                    <div className="mt-8">
                      <SectionHeading>Collections</SectionHeading>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {profile.collections.map((collection, index) => (
                          <Link
                            key={collection.slug}
                            href={`/collections/${collection.slug}`}
                            style={{ '--i': index, '--stagger-step': '80ms' } as CSSProperties}
                            className="card group anim-rise stagger lift overflow-hidden"
                          >
                            <div className="grid aspect-[16/9] grid-cols-2 grid-rows-2 gap-px bg-ink-850">
                              {Array.from({ length: 4 }).map((_, tile) => {
                                const cover = collection.covers[tile];
                                return cover ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img key={tile} src={cover} alt="" className="size-full object-cover" />
                                ) : (
                                  <div key={tile} className="bg-ink-900" />
                                );
                              })}
                            </div>
                            <div className="p-4">
                              <h3 className="display text-lg text-ink-100 transition-colors group-hover:text-accent">
                                {collection.name}
                              </h3>
                              {collection.description ? (
                                <p className="mt-1 line-clamp-2 text-xs text-ink-500">{collection.description}</p>
                              ) : null}
                              <p className="stat-figure mt-2 text-xs text-ink-500">{collection.gameCount} games</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <div className="space-y-8">
                {rarest?.rate != null ? (
                  <section className="anim-rise stagger" style={{ '--i': 3 } as CSSProperties}>
                    <SectionHeading>Rarest trophy</SectionHeading>
                    <Link
                      href={`/game/${rarest.game.slug}`}
                      className="card hud-corners group relative block overflow-hidden p-5"
                    >
                      {rarest.game.coverImage ? (
                        <div className="absolute inset-0" aria-hidden>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={rarest.game.coverImage}
                            alt=""
                            className="size-full scale-125 object-cover opacity-40 blur-2xl saturate-[0.7]"
                          />
                          <div className="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-ink-950/75 to-ink-950/90" />
                        </div>
                      ) : null}
                      <div className="relative">
                        <div className="display text-[4rem] leading-none text-accent [text-shadow:0.04em_0.04em_0_var(--color-ink-950)]">
                          {rateLabel(rarest.rate)}
                        </div>
                        <div className="eyebrow mt-1 text-ink-300">of players have it</div>
                        <div className="mt-4 flex items-center gap-3">
                          {rarest.iconUrl ? (
                            <div className="hard-shadow shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={rarest.iconUrl} alt="" className="cut-sm size-14 object-cover" />
                            </div>
                          ) : null}
                          <div className="min-w-0">
                            <div className="display truncate text-xl leading-tight text-ink-100 transition-colors group-hover:text-accent">
                              {rarest.name}
                            </div>
                            {rarest.description ? (
                              <p className="mt-0.5 line-clamp-2 text-xs text-ink-300">{rarest.description}</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-400">
                          <span className="flex items-center gap-1.5">
                            <span className={`size-2 -skew-x-[20deg] ${platformStyle(rarest.provider).bar}`} aria-hidden />
                            {rarest.game.name}
                          </span>
                          {rarest.unlockedAt ? <span>· {formatDate(rarest.unlockedAt)}</span> : null}
                        </div>
                      </div>
                    </Link>
                    {rarestAll.length > 1 ? (
                      <ol className="card mt-3 divide-y divide-ink-850 px-4 text-sm">
                        {rarestAll.slice(1).map((item, index) => (
                          <li key={`${item.game.slug}-${index}`} className="flex items-center gap-3 py-2.5">
                            <span className="display w-5 text-base text-ink-600">{index + 2}</span>
                            {item.iconUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.iconUrl} alt="" className="size-9 shrink-0 cut-sm object-cover" />
                            ) : null}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-ink-100">{item.name}</span>
                              <span className="block truncate text-[11px] text-ink-500">{item.game.name}</span>
                            </span>
                            <span className="display text-lg text-accent">
                              {item.rate != null ? rateLabel(item.rate) : '—'}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </section>
                ) : null}

                <section className="anim-rise stagger" style={{ '--i': 4 } as CSSProperties}>
                  <SectionHeading>On record</SectionHeading>
                  <dl className="card divide-y divide-ink-850 text-sm">
                    <Detail label="Playing since" value={String(playingSince.getFullYear())} />
                    <Detail label="On OMNIPLAY since" value={formatDate(profile.memberSince)} />
                    <Detail label="Games owned" value={stats.totalGames.toLocaleString()} />
                    {stats.platinums > 0 && rarest?.rate != null ? (
                      <Detail label="Rarest trophy" value={rateLabel(rarest.rate)} />
                    ) : null}
                  </dl>
                </section>
              </div>
            </div>

            <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-ink-850 pt-6 text-xs text-ink-500">
              <span>
                A gaming identity on OMNIPLAY — every figure from the platforms themselves,
                nothing invented.
              </span>
              {!viewer ? (
                <Link href="/register" className="btn-ghost btn-sm">
                  Build yours
                </Link>
              ) : null}
            </footer>
          </div>
        </main>
      </div>
    </Motion>
  );
}

/**
 * The top bar for a reader with no session: the HUD's shape with the way in
 * where the way back would be.
 */
function PublicBar() {
  return (
    <div className="glass sticky top-0 z-30">
      <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-4 px-4 py-3 sm:px-8 2xl:px-12">
        <Wordmark large href="/" />
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/login" className="btn-ghost btn-sm">
            Sign in
          </Link>
          <Link href="/register" className="btn-primary btn-sm">
            Build your own
          </Link>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-3">
      <dt className="eyebrow text-ink-500">{label}</dt>
      <dd className="stat-figure text-right text-ink-100">{value}</dd>
    </div>
  );
}

function Tally({
  label,
  value,
  note,
  tone = 'text-ink-950',
}: {
  label: string;
  value: string | number;
  note: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col justify-center px-5 py-5 2xl:px-6">
      <div className="eyebrow text-ink-700">{label}</div>
      <div className={`display mt-2 text-[clamp(2.4rem,3vw,3.2rem)] leading-none ${tone}`}>
        {typeof value === 'number' ? <Counter value={value} /> : value}
      </div>
      <div className="mt-2 text-[12px] text-ink-700">{note}</div>
    </div>
  );
}

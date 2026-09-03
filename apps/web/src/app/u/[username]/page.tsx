import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatHours, providerLabel } from '@/lib/format';
import { platformStyle, staggerStep } from '@/lib/platform';
import { Wordmark } from '@/components/wordmark';
import type { CSSProperties } from 'react';

/**
 * The public profile (spec 4.7).
 *
 * Outside the authenticated shell on purpose: this page is the shareable
 * artefact, and it must render for someone with no OMNIPLAY account. It calls
 * the API directly rather than through the cookie-forwarding helper, so no
 * session is ever involved.
 */

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface PublicProfile {
  username: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  memberSince: string;
  stats: {
    totalGames: number;
    completed: number;
    totalMinutes: number;
    gamesPlayed: number;
    completionRate: number;
  };
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

async function fetchProfile(username: string): Promise<PublicProfile | null> {
  const response = await fetch(new URL(`/u/${encodeURIComponent(username)}`, API_URL), {
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
  const description = `${profile.stats.totalGames} games, ${formatHours(
    profile.stats.totalMinutes,
  )} played, ${profile.stats.completed} completed.`;

  return {
    title: `${name} — OMNIPLAY`,
    description,
    // Shareability is the point of this page (spec 4.8), so the card matters.
    openGraph: { title: `${name} on OMNIPLAY`, description, type: 'profile' },
    twitter: { card: 'summary', title: `${name} on OMNIPLAY`, description },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await fetchProfile(username);
  if (!profile) notFound();

  const name = profile.displayName ?? profile.username;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ink-850">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Wordmark href="/" />
          <Link
            href="/register"
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-all duration-200 hover:-translate-y-px hover:border-accent/50 hover:bg-ink-850 hover:text-ink-100"
          >
            Build your own
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <section className="anim-rise flex flex-wrap items-center gap-6">
          <span className="grid size-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent via-violet to-positive text-2xl font-bold text-ink-950">
            {name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-100">{name}</h1>
            <p className="mt-1 text-sm text-ink-500">@{profile.username}</p>
            {profile.bio ? (
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-300">{profile.bio}</p>
            ) : null}
          </div>
        </section>

        <section className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Games" value={profile.stats.totalGames.toLocaleString()} index={0} />
          <Stat
            label="Hours played"
            value={formatHours(profile.stats.totalMinutes)}
            accent
            index={1}
          />
          <Stat label="Completed" value={profile.stats.completed.toLocaleString()} index={2} />
          <Stat
            label="Completion rate"
            value={`${Math.round(profile.stats.completionRate * 100)}%`}
            index={3}
          />
        </section>

        {profile.platforms.length > 0 ? (
          <section className="anim-rise mt-10">
            <h2 className="eyebrow mb-4 flex items-center gap-2 text-ink-400">
              <span className="h-3 w-0.5 rounded-full bg-accent/70" aria-hidden />
              Platforms
            </h2>
            <div className="flex flex-wrap gap-3">
              {profile.platforms.map((platform, index) => {
                const style = platformStyle(platform.provider);
                return (
                  <div
                    key={platform.provider}
                    style={
                      {
                        '--i': index,
                        '--bloom': style.bloom,
                        '--stagger-step': '80ms',
                      } as CSSProperties
                    }
          className={`card bloom anim-rise stagger flex items-center gap-2.5 px-4 py-3 text-sm ring-1 ${style.ring}`}
                  >
                    <span className={`size-2 rounded-full ${style.bar}`} aria-hidden />
                    <span className="text-ink-200">{providerLabel(platform.provider)}</span>
                    <span className={`stat-figure ml-1 ${style.text}`}>
                      {platform.gameCount.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {profile.favourites.length > 0 ? (
          <section className="anim-rise mt-10">
            <h2 className="eyebrow mb-4 flex items-center gap-2 text-ink-400">
              <span className="h-3 w-0.5 rounded-full bg-accent/70" aria-hidden />
              Most played
            </h2>
            <div
              className="grid grid-cols-3 gap-4 sm:grid-cols-6"
              style={{ '--stagger-step': staggerStep(profile.favourites.length) } as CSSProperties}
            >
              {profile.favourites.map((game, index) => (
                <div
                  key={game.slug}
                  style={{ '--i': index } as CSSProperties}
         className="group anim-rise stagger overflow-hidden rounded-[var(--radius-card)] border border-ink-800 bg-ink-900"
                >
                  <div className="aspect-[3/4] overflow-hidden bg-ink-850">
                    {game.coverImage ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={game.coverImage}
                        alt=""
                        className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
                      />
                    ) : (
                      <div className="grid size-full place-items-center px-2 text-center text-[10px] text-ink-600">
                        {game.name}
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-2">
                    <div className="line-clamp-1 text-xs text-ink-300">{game.name}</div>
                    <div className="stat-figure mt-0.5 text-[10px] text-ink-600">
                      {formatHours(game.minutes)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {profile.collections.length > 0 ? (
          <section className="anim-rise mt-10">
            <h2 className="eyebrow mb-4 flex items-center gap-2 text-ink-400">
              <span className="h-3 w-0.5 rounded-full bg-accent/70" aria-hidden />
              Collections
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {profile.collections.map((collection, index) => (
                <div
                  key={collection.slug}
                  style={{ '--i': index, '--stagger-step': '80ms' } as CSSProperties}
         className="card anim-rise stagger overflow-hidden"
                >
                  <div className="grid aspect-[16/9] grid-cols-2 grid-rows-2 gap-px bg-ink-850">
                    {Array.from({ length: 4 }).map((_, index) => {
                      const cover = collection.covers[index];
                      return cover ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img key={index} src={cover} alt="" className="size-full object-cover" />
                      ) : (
                        <div key={index} className="bg-ink-900" />
                      );
                    })}
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium text-ink-100">{collection.name}</h3>
                    {collection.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-ink-500">
                        {collection.description}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-ink-600">{collection.gameCount} games</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="mt-16 border-t border-ink-850 pt-6 text-xs text-ink-600">
          A gaming identity on OMNIPLAY.{' '}
          <Link href="/register" className="text-accent hover:underline">
            Build yours
          </Link>
          .
        </footer>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  index = 0,
}: {
  label: string;
  value: string;
  accent?: boolean;
  index?: number;
}) {
  return (
    <div
      style={{ '--i': index } as CSSProperties}
      className="card bloom anim-rise stagger p-5"
    >
      <div className="eyebrow text-ink-500">{label}</div>
      <div className={`stat-figure mt-2 text-3xl ${accent ? 'text-accent' : 'text-ink-100'}`}>
        {value}
      </div>
    </div>
  );
}

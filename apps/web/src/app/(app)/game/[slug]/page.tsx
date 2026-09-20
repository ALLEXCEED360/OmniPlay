import { notFound } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDate, formatHours, STATUS_LABELS } from '@/lib/format';
import { PlatformBadge, SectionHeading } from '@/components/ui';
import { AddToCollection } from '@/components/add-to-collection';
import { GameVerdict } from '@/components/game-verdict';
import { GameNotes, type GameNote } from '@/components/game-notes';
import { criticProvenance, isThinlyReviewed } from '@/lib/critic';
import { PlatformReport, type PlatformReportRow } from '@/components/platform-report';
import { Backdrop } from '@/components/backdrop';
import { Headline } from '@/components/motion';
import type { CSSProperties } from 'react';

/**
 * The unified game page (spec 4.2).
 *
 * The defining feature is that one page shows every platform's view of the
 * same game side by side - Steam's 182 hours next to PlayStation's 65 - rather
 * than merging them into a single figure that hides where the time came from.
 */

interface GameDetail {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  coverImage: string | null;
  heroImage: string | null;
  firstReleaseDate: string | null;
  rating: number | null;
  /** IGDB's aggregate of external critic scores, as shown in the library. */
  criticRating: number | null;
  criticRatingCount: number | null;
  genres: string[];
  developers: string[];
  publishers: string[];
  status: string;
  /** False when the user set the status themselves rather than it being inferred. */
  statusDerived: boolean;
  userRating: number | null;
  notes: GameNote[];
  totalMinutes: number;
  playtimeByProvider: Record<string, number>;
  /** Why each provider shows the figure it does. */
  playtimeProvenance: Record<string, 'REPORTED' | 'ZERO' | 'NOT_REPORTED' | 'PENDING'>;
  /** What each platform can report about this game, and what we hold. */
  platformReport: PlatformReportRow[];
  ownership: Array<{
    provider: string;
    type: string;
    platform: string | null;
    acquiredAt: string | null;
    removedAt: string | null;
    confidence: string;
  }>;
  achievements: Array<{ provider: string; total: number; unlocked: number; points: number }>;
  platforms: string[];
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let game: GameDetail;
  try {
    game = await apiFetch<GameDetail>(`/library/game/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Every platform that knows anything about this game, not just the ones
  // that sold it. A title played on Xbox without being bought there has no
  // ownership row, and keying the section off ownership alone made those games
  // render an empty panel — hiding the very games whose data needs explaining.
  const providers = [
    ...new Set([
      ...game.ownership.map((o) => o.provider),
      ...game.achievements.map((a) => a.provider),
      ...Object.keys(game.playtimeProvenance ?? {}),
    ]),
  ];

  return (
    <article>
      {/* The game's own artwork replaces the ambient footage for as long as
          this page is open. It is the one place the backdrop is real data
          rather than a placeholder. */}
      {game.heroImage || game.coverImage ? (
        <Backdrop src={game.heroImage ?? game.coverImage ?? undefined} strength={0.6} />
      ) : null}

      {/* Hero: the cover on a hard red shadow, the title in the largest
          type on the site, platforms as slanted tags underneath. */}
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
        {game.coverImage ? (
          <div className="hard-shadow anim-rise shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={game.coverImage}
              alt=""
              className="cut w-36 sm:w-44"
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1 pb-1">
          <div className="eyebrow anim-rise mb-3 flex items-center gap-2.5 text-accent">
            <span className="slash" aria-hidden />
            {game.firstReleaseDate ? new Date(game.firstReleaseDate).getUTCFullYear() : 'Game'}
            {game.developers[0] ? <span className="text-ink-500">· {game.developers[0]}</span> : null}
          </div>
          <h1 className="display text-[2.75rem] leading-[0.9] text-ink-100 sm:text-[4rem]">
            <Headline text={game.name} />
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {providers.map((provider, index) => (
              <span
                key={provider}
                className="anim-pop stagger"
                style={{ '--i': index + 2, '--stagger-step': '70ms' } as CSSProperties}
              >
                <PlatformBadge provider={provider} />
              </span>
            ))}
            {/* A dashed edge marks an inference, a solid one the user's
                own word. The label alone cannot tell them apart, and the
                difference is the whole point of keeping both. */}
            <span
              title={
                game.statusDerived
                  ? 'Worked out from your playtime and achievements'
                  : 'You set this yourself'
              }
              className={`inline-flex -skew-x-[14deg] px-2.5 py-0.5 font-display text-xs font-bold uppercase tracking-wider ${
                game.statusDerived
                  ? 'border border-dashed border-ink-600 text-ink-400'
                  : 'bg-paper text-ink-950'
              }`}
            >
              <span className="skew-x-[14deg]">{STATUS_LABELS[game.status] ?? game.status}</span>
            </span>

            {/* Shown here even when thinly reviewed, unlike in the
                library. One game has room to say what the number rests
                on; a shelf of two hundred covers does not. */}
            {game.criticRating !== null ? (
              <span
                title={criticProvenance(game.criticRating, game.criticRatingCount) ?? undefined}
                className={`stat-figure inline-flex h-6 -skew-x-[14deg] items-center gap-1 px-2 text-xs font-semibold ${
                  isThinlyReviewed(game.criticRating, game.criticRatingCount)
                    ? 'bg-ink-800 text-ink-300 ring-1 ring-ink-700'
                    : game.criticRating >= 75
                      ? 'bg-positive text-ink-950'
                      : game.criticRating >= 50
                        ? 'bg-warning text-ink-950'
                        : 'bg-danger text-ink-950'
                }`}
              >
                <span className="flex skew-x-[14deg] items-center gap-1">
                  {Math.round(game.criticRating)}
                  {game.criticRatingCount !== null ? (
                    <span className="font-normal opacity-70">
                      ·{' '}
                      {game.criticRatingCount === 1
                        ? '1 review'
                        : `${game.criticRatingCount} reviews`}
                    </span>
                  ) : null}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          {game.summary ? (
            <section className="anim-rise stagger" style={{ '--i': 2 } as CSSProperties}>
              <SectionHeading>About</SectionHeading>
              {/* Held to a reading measure of its own. A summary set across
                  the full width of a wide screen runs past the length an eye
                  can track back from comfortably. */}
              <p className="max-w-prose text-sm leading-relaxed text-ink-300">{game.summary}</p>
            </section>
          ) : null}

          {/* The heart of the page: per-provider figures, never merged away.
              A single combined number would answer the easy question and lose
              the interesting one — which platform this history actually lived
              on, and what each of them can and cannot tell us. */}
          <section className="anim-rise stagger" style={{ '--i': 3 } as CSSProperties}>
            <SectionHeading
              action={
                game.totalMinutes > 0 && providers.length > 1 ? (
                  <span className="text-xs font-normal normal-case tracking-normal text-ink-400">
                    <span className="stat-figure text-ink-100">
                      {formatHours(game.totalMinutes)}
                    </span>{' '}
                    across {providers.length} platforms
                  </span>
                ) : null
              }
            >
              Playtime and progress
            </SectionHeading>

            <PlatformReport rows={game.platformReport ?? []} />
          </section>

        </div>

        <aside className="anim-rise stagger space-y-6" style={{ '--i': 4 } as CSSProperties}>
          <GameVerdict
            slug={game.slug}
            status={game.status}
            derived={game.statusDerived}
            rating={game.userRating}
            criticRating={game.criticRating}
          />

          <GameNotes slug={game.slug} notes={game.notes ?? []} />

          <AddToCollection gameId={game.id} />

          <div className="card divide-y divide-ink-850 text-sm">
            <Detail label="Released" value={formatDate(game.firstReleaseDate)} />
            <Detail label="First played" value={formatDate(game.firstPlayedAt)} />
            <Detail label="Last played" value={formatDate(game.lastPlayedAt)} />
            {game.developers.length > 0 ? (
              <Detail label="Developer" value={game.developers.join(', ')} />
            ) : null}
            {game.publishers.length > 0 ? (
              <Detail label="Publisher" value={game.publishers.join(', ')} />
            ) : null}
          </div>

          {/* One card, two lists. As separate boxes these were two panels
              answering the same question — what kind of thing is this game —
              and the second used a run-on string where the first used pills. */}
          {game.genres.length > 0 || game.platforms.length > 0 ? (
            <div className="card space-y-4 p-5">
              {game.genres.length > 0 ? (
                <div>
                  <SectionHeading>Genres</SectionHeading>
                  <div className="flex flex-wrap gap-2">
                    {game.genres.map((genre, index) => (
                      <span
                        key={genre}
                        style={{ '--i': index, '--stagger-step': '55ms' } as CSSProperties}
                        className="anim-pop stagger -skew-x-[14deg] px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-wider text-ink-400 shadow-[inset_0_0_0_1px_var(--color-ink-700)] transition-colors hover:bg-ink-100 hover:text-ink-950"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {game.platforms.length > 0 ? (
                <div>
                  <SectionHeading>Available on</SectionHeading>
                  <div className="flex flex-wrap gap-2">
                    {game.platforms.map((platform, index) => (
                      <span
                        key={platform}
                        style={{ '--i': index, '--stagger-step': '45ms' } as CSSProperties}
                        className="anim-pop stagger -skew-x-[14deg] bg-ink-850 px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-wider text-ink-400"
                      >
                        {platform}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

        </aside>
      </div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 p-4 transition-colors hover:bg-ink-850/40">
      <span className="eyebrow shrink-0 text-ink-500">{label}</span>
      <span className="text-right text-ink-300">{value}</span>
    </div>
  );
}

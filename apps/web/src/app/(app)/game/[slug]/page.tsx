import { notFound } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDate, formatHours, STATUS_LABELS } from '@/lib/format';
import { PlatformBadge, SectionHeading } from '@/components/ui';
import { AddToCollection } from '@/components/add-to-collection';
import { GameVerdict } from '@/components/game-verdict';
import { GameNotes, type GameNote } from '@/components/game-notes';
import { criticProvenance, isThinlyReviewed } from '@/lib/critic';
import { PlatformReport, type PlatformReportRow } from '@/components/platform-report';
import { BackToLibrary } from '@/components/back-to-library';
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

  const unlocked = game.achievements.reduce((sum, a) => sum + a.unlocked, 0);
  const totalAchievements = game.achievements.reduce((sum, a) => sum + a.total, 0);
  const year = game.firstReleaseDate ? new Date(game.firstReleaseDate).getUTCFullYear() : null;

  return (
    <article>
      {/* The game's own artwork replaces the ambient footage for as long as
          this page is open. It is the one place the backdrop is real data
          rather than a placeholder. */}
      {game.heroImage || game.coverImage ? (
        <>
          {/* No shell veil — it pulls the left side down to ink, which left
              the art a rumour behind the panels. Instead the art is graded
              to one intensity (see Backdrop) and laid under one flat wash,
              so a neon cover and a night scene sit behind the panels at the
              same weight, with ink at the very foot for the last panels. */}
          <Backdrop src={game.heroImage ?? game.coverImage ?? undefined} strength={1} veil={false} grade />
          <div
            className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-ink-950/40 via-ink-950/45 to-ink-950/85"
            aria-hidden
          />
        </>
      ) : null}

      {/* ── The hero: half the screen of art with the cover and the name
          standing at its foot, then a strip of figures running the full
          width beneath — the way a game's own info bar runs under its key
          art. ── */}
      <header className="relative flex min-h-[46vh] flex-col justify-end pb-6 pt-2 sm:min-h-[52vh]">
        {/* The year, outlined and huge in the art's top corner: a title
            card's watermark. Stroke only, so the picture shows through and
            the name in front of it stays the thing you read — but a stroke
            heavy enough, in gold, to be seen at a glance. */}
        {year ? (
          <div
            className="display anim-fade pointer-events-none absolute -top-2 right-0 select-none text-[clamp(7rem,20vw,19rem)] leading-none text-transparent [-webkit-text-stroke:3px_var(--color-accent)] opacity-60 [text-shadow:0_0_24px_oklch(0_0_0_/_0.5)]"
            aria-hidden
          >
            {year}
          </div>
        ) : null}
        <BackToLibrary />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
          {game.coverImage ? (
            <div className="hard-shadow anim-rise shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={game.coverImage} alt="" className="cut w-40 sm:w-48 2xl:w-56" />
            </div>
          ) : null}

          <div className="min-w-0 flex-1 pb-1">
            <div className="eyebrow anim-rise mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-accent">
              <span className="slash" aria-hidden />
              {year ?? 'Game'}
              {game.developers[0] ? <span className="text-ink-300">· {game.developers[0]}</span> : null}
              {game.genres.length > 0 ? (
                <span className="text-ink-400">· {game.genres.slice(0, 3).join(' / ')}</span>
              ) : null}
            </div>
            <h1 className="display text-[clamp(2.75rem,6vw,6.5rem)] leading-[0.88] text-ink-100 [text-shadow:0.03em_0.03em_0_var(--color-ink-950)]">
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
                  own word. The label alone cannot tell them apart. */}
              <span
                title={
                  game.statusDerived
                    ? 'Worked out from your playtime and achievements'
                    : 'You set this yourself'
                }
                className={`inline-flex -skew-x-[14deg] px-2.5 py-0.5 font-display text-xs font-bold uppercase tracking-wider ${
                  game.statusDerived
                    ? 'border border-dashed border-ink-500 text-ink-300'
                    : 'bg-paper text-ink-950'
                }`}
              >
                <span className="skew-x-[14deg]">{STATUS_LABELS[game.status] ?? game.status}</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ── The strip: the figures that matter, in one bar, each saying
          what it rests on. ── */}
      <div className="hard-shadow anim-rise stagger mb-8" style={{ '--i': 2 } as CSSProperties}>
      <div className="paper cut grid grid-cols-2 divide-ink-950/10 sm:grid-cols-3 sm:divide-x xl:grid-cols-6">
        <Figure
          label="Your time"
          value={game.totalMinutes > 0 ? formatHours(game.totalMinutes) : '—'}
          note={
            game.totalMinutes > 0 && providers.length > 1
              ? `across ${providers.length} platforms`
              : game.totalMinutes > 0
                ? 'on record'
                : 'none recorded'
          }
        />
        <Figure
          label={providers.length === 1 && providers[0] === 'psn' ? 'Trophies' : 'Achievements'}
          value={totalAchievements > 0 ? `${unlocked} / ${totalAchievements}` : '—'}
          note={totalAchievements > 0 ? `${Math.round((unlocked / totalAchievements) * 100)}% unlocked` : 'none reported'}
          bar={totalAchievements > 0 ? unlocked / totalAchievements : undefined}
        />
        <Figure
          label="Critics"
          value={game.criticRating !== null ? String(Math.round(game.criticRating)) : '—'}
          tone={
            game.criticRating === null || isThinlyReviewed(game.criticRating, game.criticRatingCount)
              ? 'muted'
              : game.criticRating >= 75
                ? 'positive'
                : game.criticRating >= 50
                  ? 'warning'
                  : 'danger'
          }
          note={
            game.criticRating === null
              ? 'no score on IGDB'
              : game.criticRatingCount
                ? `${game.criticRatingCount} ${game.criticRatingCount === 1 ? 'review' : 'reviews'}${
                    isThinlyReviewed(game.criticRating, game.criticRatingCount) ? ', thin' : ''
                  }`
                : 'review count unknown'
          }
          title={criticProvenance(game.criticRating, game.criticRatingCount) ?? undefined}
        />
        <Figure
          label="You"
          value={game.userRating !== null ? `${game.userRating} / 10` : '—'}
          tone={game.userRating !== null ? 'accent' : 'muted'}
          note={game.userRating !== null ? 'your score' : 'not scored yet'}
        />
        <Figure label="First played" value={shortDate(game.firstPlayedAt)} note={game.firstPlayedAt ? 'earliest dated play' : 'no dated play'} small />
        <Figure label="Last played" value={shortDate(game.lastPlayedAt)} note={game.lastPlayedAt ? 'latest dated play' : 'no dated play'} small />
      </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem] 2xl:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-8">
          {game.summary ? (
            <div className="hard-shadow anim-rise stagger" style={{ '--i': 2 } as CSSProperties}>
              {/* On paper, and set in columns once the panel is wider than
                  a line can comfortably be: ink on off-white is the most
                  legible thing the app has, and two columns fill a wide
                  panel instead of leaving two thirds of it bare. */}
              <section className="paper cut p-6 sm:p-7">
                <h2 className="display mb-4 flex items-center gap-2.5 text-[1.35rem] text-ink-950">
                  <span className="slash" aria-hidden />
                  About
                </h2>
                <p
                  className={`text-[17px] leading-[1.65] text-ink-950 [text-wrap:pretty] ${
                    game.summary.length > 360 ? 'xl:columns-2 xl:gap-10' : 'max-w-[70ch]'
                  }`}
                >
                  {game.summary}
                </p>
              </section>
            </div>
          ) : null}

          {/* The heart of the page: per-provider figures, never merged away.
              A single combined number would answer the easy question and lose
              the interesting one — which platform this history actually lived
              on, and what each of them can and cannot tell us. */}
          <section className="card hud-corners anim-rise stagger p-6" style={{ '--i': 3 } as CSSProperties}>
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

/** A date short enough for a strip cell, or a dash. */
function shortDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * One cell of the strip: a label, a figure, a note saying what the figure
 * rests on, and for a progress figure a bar. `tone` colours the figure
 * the way the rest of the app colours that kind of number.
 */
function Figure({
  label,
  value,
  note,
  tone = 'plain',
  bar,
  title,
  small = false,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'plain' | 'accent' | 'positive' | 'warning' | 'danger' | 'muted';
  bar?: number | undefined;
  title?: string | undefined;
  /** Dates, which are long: set smaller than the counts. */
  small?: boolean;
}) {
  // On paper: ink for the figure, and the band colours pulled down so
  // they clear the off-white.
  const colour = {
    plain: 'text-ink-950',
    accent: 'text-accent-strong',
    positive: 'text-[oklch(0.5_0.15_150)]',
    warning: 'text-[oklch(0.55_0.16_55)]',
    danger: 'text-[oklch(0.5_0.2_10)]',
    muted: 'text-ink-700',
  }[tone];
  return (
    <div className="px-5 py-5 2xl:px-6" title={title}>
      <div className="eyebrow text-ink-700">{label}</div>
      <div className={`display mt-2 leading-none ${colour} ${small ? 'text-[1.6rem]' : 'text-[2.6rem]'}`}>
        {value}
      </div>
      {bar !== undefined ? (
        <div className="mt-2.5 h-1.5 -skew-x-[20deg] overflow-hidden bg-ink-950/10">
          <div className="anim-grow h-full bg-accent-strong" style={{ width: `${Math.max(2, Math.round(bar * 100))}%` }} />
        </div>
      ) : null}
      <div className="mt-2 text-[12px] text-ink-700">{note}</div>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import {
  CONFIDENCE_NOTES,
  formatDate,
  formatHours,
  providerLabel,
  STATUS_LABELS,
} from '@/lib/format';
import { ConfidenceNote, PlatformBadge, SectionHeading } from '@/components/ui';
import { AddToCollection } from '@/components/add-to-collection';
import { PlatformReport, type PlatformReportRow } from '@/components/platform-report';

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
  genres: string[];
  developers: string[];
  publishers: string[];
  status: string;
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
      {/* Hero: artwork bleeds behind the title, with a scrim for legibility. */}
      <div className="relative -mx-4 -mt-6 mb-8 overflow-hidden sm:-mx-8 sm:-mt-10">
        {game.heroImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={game.heroImage} alt="" className="h-64 w-full object-cover sm:h-80" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-ink-950/20" />
          </>
        ) : (
          <div className="h-40 w-full bg-gradient-to-br from-ink-900 to-ink-850" />
        )}

        <div className="absolute inset-x-0 bottom-0 px-4 pb-6 sm:px-8">
          <div className="mx-auto flex max-w-6xl items-end gap-5">
            {game.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={game.coverImage}
                alt=""
                className="hidden w-32 rounded-lg border border-ink-800 shadow-xl shadow-black/50 sm:block"
              />
            ) : null}
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="text-3xl font-semibold tracking-tight text-ink-100 sm:text-4xl">
                {game.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {providers.map((provider) => (
                  <PlatformBadge key={provider} provider={provider} />
                ))}
                <span className="rounded-full border border-ink-700 px-2.5 py-1 text-xs text-ink-400">
                  {STATUS_LABELS[game.status] ?? game.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          {game.summary ? (
            <section>
              <SectionHeading>About</SectionHeading>
              <p className="text-sm leading-relaxed text-ink-300">{game.summary}</p>
            </section>
          ) : null}

          {/* The heart of the page: per-provider figures, never merged away.
              A single combined number would answer the easy question and lose
              the interesting one — which platform this history actually lived
              on, and what each of them can and cannot tell us. */}
          <section>
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

        <aside className="space-y-6">
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

          {game.genres.length > 0 ? (
            <div className="card p-5">
              <SectionHeading>Genres</SectionHeading>
              <div className="flex flex-wrap gap-2">
                {game.genres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full border border-ink-800 px-2.5 py-1 text-xs text-ink-400"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {game.platforms.length > 0 ? (
            <div className="card p-5">
              <SectionHeading>Available on</SectionHeading>
              <p className="text-xs leading-relaxed text-ink-500">{game.platforms.join(' · ')}</p>
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 p-4">
      <span className="shrink-0 text-xs uppercase tracking-wider text-ink-500">{label}</span>
      <span className="text-right text-ink-300">{value}</span>
    </div>
  );
}

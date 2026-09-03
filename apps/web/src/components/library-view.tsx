import Link from 'next/link';
import type { CSSProperties } from 'react';
import { formatHours, formatRelative } from '@/lib/format';
import { PlatformBadge } from '@/components/ui';
import { platformStyle, staggerStep } from '@/lib/platform';
import { criticProvenance, isThinlyReviewed } from '@/lib/critic';

/**
 * The library, as a poster wall or as a table.
 *
 * Both views exist because the library answers two different questions. "What
 * do I own" is a question about covers, and a grid answers it fastest. "What
 * scored highest / came out when / did I last touch" is a question about
 * numbers, and numbers belong in aligned columns where they can be compared
 * down the page rather than hunted for across a grid.
 *
 * Whichever view is showing, the figure the list is *sorted by* is printed on
 * every entry and highlighted. Three of these four sorts were reported as
 * returning "random order". One of the three genuinely was random; the others
 * were correct but unverifiable, because nothing on screen showed the key they
 * were ordered by. A sort the reader cannot check is a sort they cannot trust.
 */

export type LibrarySort = 'name' | 'rating' | 'release' | 'recent';

export interface LibraryGame {
  id: string;
  name: string;
  slug: string;
  coverImage: string | null;
  providers: string[];
  owned: boolean;
  status: string;
  totalMinutes: number;
  criticRating: number | null;
  /** How many critics the score rests on; below four it is marked provisional. */
  criticRatingCount: number | null;
  firstReleaseDate: string | null;
  lastPlayedAt: string | null;
  ownershipState?: 'OWNED' | 'PREVIOUSLY_OWNED' | 'UNKNOWN';
}

/**
 * Critic scores band the way the industry reads them, so the colour carries
 * meaning rather than decoration. The bands are the conventional ones: 75 and
 * up is well reviewed, 50 to 75 mixed, below 50 poor.
 *
 * The fill is solid rather than a 10%-opacity tint. A tint works on a known
 * dark surface and disappears entirely over cover art — over Astro Bot's white
 * logo the badge was simply not there. A cover can be any colour, so the badge
 * brings its own background, and the number is dark text on a bright block:
 * the shape everyone already reads critic scores in.
 */
function scoreTone(score: number): string {
  if (score >= 75) return 'bg-positive text-ink-950';
  if (score >= 50) return 'bg-warning text-ink-950';
  return 'bg-danger text-ink-950';
}

const year = (iso: string | null) => (iso ? new Date(iso).getUTCFullYear() : null);

/** The one figure this list is ordered by, as a short phrase. */
function sortKeyOf(game: LibraryGame, sort: LibrarySort): string | null {
  switch (sort) {
    case 'rating':
      return game.criticRating === null ? null : `${Math.round(game.criticRating)}`;
    case 'release':
      return year(game.firstReleaseDate)?.toString() ?? null;
    case 'recent':
      return game.lastPlayedAt ? formatRelative(game.lastPlayedAt) : null;
    default:
      return null;
  }
}

/**
 * What "no value" means for the sort in play.
 *
 * Never "0" and never a blank. An unrated game is not a game that scored
 * nothing, and Steam reporting an undated lifetime total is not the same as
 * never having played it — printing a zero would state something false.
 */
const MISSING: Record<LibrarySort, string> = {
  name: '',
  rating: 'Unrated',
  release: 'No date',
  recent: 'Never dated',
};

/**
 * The colour a thinly-reviewed score wears.
 *
 * Dark ground with the band colour as text, rather than the solid fill a
 * well-reviewed score gets. Still legible over any cover — that is why it
 * carries its own background — but visibly a different kind of claim, which
 * is the whole point: 92 from two reviews and 83 from twelve must not look
 * alike, and hiding the first one outright turned out to be too blunt. Most of
 * these numbers are close to right; a few are badly wrong; nothing about the
 * number itself says which.
 */
function provisionalTone(score: number): string {
  if (score >= 75) return 'text-positive ring-positive/40';
  if (score >= 50) return 'text-warning ring-warning/40';
  return 'text-danger ring-danger/40';
}

function ScoreBadge({
  score,
  count,
  large,
  provisional,
}: {
  score: number;
  count: number | null;
  large?: boolean;
  provisional?: boolean;
}) {
  return (
    <span
      className={`stat-figure inline-flex items-center justify-center rounded-md font-semibold shadow-md shadow-black/50 ${
        provisional
          ? `bg-ink-950/85 ring-1 backdrop-blur-sm ${provisionalTone(score)}`
          : scoreTone(score)
      } ${large ? 'h-7 min-w-8 px-1.5 text-sm' : 'h-6 min-w-7 px-1.5 text-xs'}`}
      title={criticProvenance(score, count) ?? undefined}
    >
      {Math.round(score)}
      {/* A dot rather than a word: the tooltip carries the explanation, and
          the badge only has to say "treat this differently". */}
      {provisional ? <span className="ml-0.5 opacity-60">·</span> : null}
    </span>
  );
}

/**
 * A figure sitting on artwork: hours, a release year, a "3 days ago".
 *
 * Same problem as the score badge and the same answer — it carries its own
 * background rather than trusting the gradient underneath, because the
 * gradient is only as dark as the cover behind it. `primary` marks the figure
 * the list is currently ordered by.
 */
function StatChip({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <span
      className={`stat-figure inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm ${
        primary
          ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
          : 'bg-ink-950/70 text-ink-200 ring-1 ring-white/10'
      }`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Grid
 * ------------------------------------------------------------------ */

export function LibraryGrid({ games, sort }: { games: LibraryGame[]; sort: LibrarySort }) {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
      style={{ '--stagger-step': staggerStep(games.length) } as CSSProperties}
    >
      {games.map((game, index) => {
        const edge = game.providers[0] ? platformStyle(game.providers[0]) : null;
        const key = sortKeyOf(game, sort);
        const hours = game.totalMinutes > 0 ? formatHours(game.totalMinutes) : null;

        return (
          <Link
            key={game.id}
            href={`/game/${game.slug}`}
            style={{ '--i': index } as CSSProperties}
            className={`group anim-rise stagger lift relative block overflow-hidden rounded-[var(--radius-card)] border bg-ink-900 ${
              edge ? edge.border : 'border-ink-800'
            }`}
          >
            <div className="relative aspect-[3/4] overflow-hidden bg-ink-850">
              {game.coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={game.coverImage}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
                />
              ) : (
                <div className="grid size-full place-items-center text-ink-700" aria-hidden>
                  <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.25">
                    <rect x="2" y="6" width="20" height="12" rx="4" />
                    <path d="M7 12h3M8.5 10.5v3M15.5 11.5h.01M17.5 13.5h.01" strokeLinecap="round" />
                  </svg>
                </div>
              )}

              {/* The critic score sits on the artwork permanently rather than
                  on hover: it is the one number people scan a shelf for. */}
              {/* Only a score with enough reviews behind it. A badge has no
                  room to say "but only two critics", and an unqualified 92
                  sitting beside a well-reviewed 83 is worse than no badge. */}
              {/* Every score we hold is shown; a thin one is marked rather
                  than withheld. Withholding answered the "92 looks as solid as
                  83" problem by removing information the reader wanted, and
                  most of these numbers are roughly right. */}
              {game.criticRating !== null ? (
                <span className="absolute left-2 top-2">
                  <ScoreBadge
                    score={game.criticRating}
                    count={game.criticRatingCount}
                    provisional={isThinlyReviewed(game.criticRating, game.criticRatingCount)}
                  />
                </span>
              ) : null}

              {game.ownershipState && game.ownershipState !== 'OWNED' ? (
                <span className="absolute right-2 top-2 rounded-full bg-ink-950/80 px-2 py-0.5 text-[10px] font-medium text-ink-400 backdrop-blur">
                  {game.ownershipState === 'PREVIOUSLY_OWNED' ? 'Previously owned' : 'Played'}
                </span>
              ) : null}

              <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-ink-950 via-ink-950/85 to-transparent" />

              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="line-clamp-2 text-sm font-medium leading-snug text-ink-100">
                  {game.name}
                </div>

                {/* Platforms and the figure share one line rather than
                    stacking. As three separate rows the hours ended up alone
                    at the bottom of the card reading as leftover, and the
                    block was tall enough to crowd the title on a two-line
                    name. Left is what it is, right is what it measures. */}
                <div className="mt-2 flex items-center justify-between gap-2">
                  {/* Clips rather than pushing the figure off the card: at
                      two columns on a phone, three platform badges beside
                      "633h" is wider than the card is. */}
                  <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                    {game.providers.slice(0, 3).map((provider) => (
                      <PlatformBadge key={provider} provider={provider} small />
                    ))}
                  </span>

                  {/* Exactly one figure, so the corner never gets crowded:
                      whatever the list is ordered by, or hours when the order
                      is alphabetical or already shown by the score badge. */}
                  <span className="shrink-0">
                    {sort === 'release' || sort === 'recent' ? (
                      key ? (
                        <StatChip primary>{key}</StatChip>
                      ) : (
                        <span className="text-[11px] text-ink-500">{MISSING[sort]}</span>
                      )
                    ) : hours ? (
                      <StatChip>{hours}</StatChip>
                    ) : null}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

/** Marks the column the list is currently ordered by. */
function Th({
  children,
  active,
  className,
}: {
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? 'descending' : undefined}
      className={`px-3 py-2.5 font-medium ${active ? 'text-accent' : 'text-ink-500'} ${className ?? ''}`}
    >
      {children}
    </th>
  );
}

export function LibraryList({ games, sort }: { games: LibraryGame[]; sort: LibrarySort }) {
  return (
    <div className="card anim-rise overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <caption className="sr-only">
          Your library. The highlighted column is the one it is sorted by.
        </caption>
        <thead>
          <tr className="eyebrow border-b border-ink-850 text-left">
            <Th active={sort === 'name'} className="w-full">
              Game
            </Th>
            <Th>Platforms</Th>
            <Th active={sort === 'rating'} className="text-right">
              Critic
            </Th>
            <Th active={sort === 'release'} className="text-right">
              Released
            </Th>
            <Th className="text-right">Played</Th>
            <Th active={sort === 'recent'} className="text-right whitespace-nowrap">
              Last played
            </Th>
          </tr>
        </thead>
        <tbody style={{ '--stagger-step': staggerStep(games.length) } as CSSProperties}>
          {games.map((game, index) => (
            <tr
              key={game.id}
              style={{ '--i': index } as CSSProperties}
              className="group anim-fade stagger border-b border-ink-850/60 transition-colors last:border-0 hover:bg-ink-850/40"
            >
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <Link href={`/game/${game.slug}`} className="flex items-center gap-3">
                  {game.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={game.coverImage}
                      alt=""
                      loading="lazy"
                      className="h-12 w-9 shrink-0 rounded object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <span className="h-12 w-9 shrink-0 rounded bg-ink-850" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-ink-100 transition-colors group-hover:text-accent">
                      {game.name}
                    </span>
                    {game.ownershipState && game.ownershipState !== 'OWNED' ? (
                      <span className="text-[11px] text-ink-600">
                        {game.ownershipState === 'PREVIOUSLY_OWNED'
                          ? 'Previously owned'
                          : 'Played, not owned here'}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </th>

              <td className="px-3 py-2">
                <span className="flex items-center gap-1" aria-hidden>
                  {game.providers.map((provider) => (
                    <span
                      key={provider}
                      className={`size-2 rounded-full ${platformStyle(provider).bar}`}
                    />
                  ))}
                </span>
                <span className="sr-only">{game.providers.join(', ')}</span>
              </td>

              <td className="px-3 py-2 text-right">
                {game.criticRating !== null ? (
                  <ScoreBadge
                    score={game.criticRating}
                    count={game.criticRatingCount}
                    large={sort === 'rating'}
                    provisional={isThinlyReviewed(game.criticRating, game.criticRatingCount)}
                  />
                ) : (
                  <span className="text-[11px] text-ink-600">—</span>
                )}
              </td>

              <td
                className={`stat-figure px-3 py-2 text-right ${
                  sort === 'release' ? 'text-accent' : 'text-ink-400'
                }`}
              >
                {year(game.firstReleaseDate) ?? <span className="text-ink-600">—</span>}
              </td>

              <td className="stat-figure px-3 py-2 text-right text-ink-400">
                {game.totalMinutes > 0 ? (
                  formatHours(game.totalMinutes)
                ) : (
                  <span className="text-ink-600">—</span>
                )}
              </td>

              <td
                className={`px-3 py-2 text-right whitespace-nowrap ${
                  sort === 'recent' ? 'text-accent' : 'text-ink-400'
                }`}
              >
                {game.lastPlayedAt ? (
                  formatRelative(game.lastPlayedAt)
                ) : (
                  <span className="text-[11px] text-ink-600">never dated</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

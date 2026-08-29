'use client';

import type { CSSProperties } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { staggerStep } from '@/lib/platform';

/**
 * One completion band's worth of games, collapsed by default.
 *
 * The grid of poster tiles reads well at a dozen games and turns into
 * wallpaper at fifty — "Just started" alone holds 51, which buried the twelve
 * in "Almost there" that a player might actually act on. So each band shows a
 * first row and opens on request, which keeps the whole page scannable while
 * losing nothing.
 */

export interface BandGame {
  gameId: string;
  name: string;
  slug: string;
  coverImage: string | null;
  provider: string;
  total: number;
  unlocked: number;
  totalKnown: boolean;
  percent: number;
  /** Tailwind background for this game's platform. */
  bar: string;
}

/** How many tiles a collapsed band shows: one full row at the widest layout. */
const COLLAPSED = 8;

export function AchievementBand({
  label,
  hint,
  games,
  tallies,
  /** The band worth acting on opens already expanded. */
  defaultOpen = false,
}: {
  label: string;
  hint: string;
  games: BandGame[];
  tallies: Array<{ provider: string; count: number; bar: string }>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const overflow = games.length - COLLAPSED;
  const shown = open ? games : games.slice(0, COLLAPSED);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium text-ink-200">{label}</h3>
        <span className="stat-figure text-xs text-ink-600">{games.length}</span>
        <span className="text-xs text-ink-600">{hint}</span>

        <span className="ml-auto flex items-center gap-3">
          {tallies.map((tally) => (
            <span key={tally.provider} className="flex items-center gap-1 text-[11px] text-ink-600">
              <span className={`size-2 rounded-full ${tally.bar}`} aria-hidden />
              {tally.count}
            </span>
          ))}

          {overflow > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="rounded-full border border-ink-700 px-2.5 py-0.5 text-[11px] text-ink-400 transition-all duration-200 hover:-translate-y-px hover:border-accent/50 hover:text-accent active:scale-95"
            >
              {open ? 'Show less' : `See all ${games.length}`}
            </button>
          ) : null}
        </span>
      </div>

      <div
        className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8"
        style={{ '--stagger-step': staggerStep(shown.length) } as CSSProperties}
      >
        {shown.map((game, index) => {
          const label = game.totalKnown
            ? `${game.unlocked} / ${game.total}`
            : `${game.unlocked} unlocked`;

          return (
            <Link
              key={`${game.gameId}:${game.provider}`}
              href={`/game/${game.slug}`}
              title={`${game.name} — ${label}`}
              style={{ '--i': index } as CSSProperties}
              className="group anim-rise stagger lift relative block overflow-hidden rounded-[var(--radius-card)] border border-ink-800 bg-ink-900"
            >
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

              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950 via-ink-950/85 to-transparent p-2 pt-7">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="line-clamp-1 text-[11px] text-ink-200">{game.name}</span>
                  <span className="stat-figure shrink-0 text-[10px] text-ink-400">
                    {game.totalKnown ? `${game.unlocked}/${game.total}` : game.unlocked}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-850">
                  <div
                    className={`anim-grow stagger h-full rounded-full ${game.bar}`}
                    style={{ width: `${Math.max(2, game.percent)}%`, '--i': index } as CSSProperties}
                  />
                </div>
              </div>

              {game.percent >= 100 ? (
                <span className="anim-pop absolute right-1.5 top-1.5 rounded-full bg-ink-950/85 px-1.5 py-0.5 text-[10px] font-medium text-positive backdrop-blur">
                  100%
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {!open && overflow > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 w-full rounded-[var(--radius-card)] border border-dashed border-ink-800 py-2 text-xs text-ink-500 transition-all duration-200 hover:border-accent/40 hover:bg-ink-900/60 hover:text-ink-200"
        >
          {overflow} more
        </button>
      ) : null}
    </div>
  );
}

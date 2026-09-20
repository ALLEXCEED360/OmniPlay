'use client';

import { useRouter } from 'next/navigation';

/** Where the shelf last stood — its path with filters, sort and page. */
export const LIBRARY_RETURN_KEY = 'omniplay:library';

/**
 * The way back to the shelf from a game.
 *
 * The shelf leaves its URL in session storage every time it renders, so
 * this returns you to the shelf as you left it — same filters, same sort,
 * same page — however you got to the game. Browser history is no use
 * here: client-side navigation never updates `document.referrer`, and
 * "back" may be a collection or the dashboard.
 *
 * It sits fixed in the bottom-left corner, the way a game's own menus
 * keep "Back" in a corner, so it is never a scroll away.
 */
export function BackToLibrary() {
  const router = useRouter();

  const go = () => {
    let target = '/library';
    try {
      const saved = sessionStorage.getItem(LIBRARY_RETURN_KEY);
      if (saved && saved.startsWith('/library')) target = saved;
    } catch {
      // Storage blocked: the shelf, fresh.
    }
    router.push(target);
  };

  return (
    <div className="anim-rise fixed bottom-5 left-4 z-30 sm:bottom-7 sm:left-8">
      <div className="hard-shadow">
        <button
          type="button"
          onClick={go}
          className="paper slant inline-flex items-center gap-2 px-5 py-2.5 font-display text-sm font-extrabold uppercase italic tracking-wider text-ink-950 transition-colors hover:bg-accent focus-visible:bg-accent"
        >
          <span aria-hidden>&larr;</span>
          Library
        </button>
      </div>
    </div>
  );
}

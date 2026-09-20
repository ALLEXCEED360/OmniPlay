'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Wordmark } from '@/components/wordmark';
import { CURTAIN_UP_MS, raiseCurtain } from '@/components/curtain';
import { requestSignOut } from '@/components/sign-out';

/**
 * The HUD: the thin bar every page wears once you are past the menu.
 *
 * It replaced a sidebar. The menu is the navigation now — the cards are
 * how you choose a page, the way a game's pause menu is how you choose a
 * screen — so a second copy of the same nine choices running down the
 * left of every page was a menu on top of a menu, and it made each page
 * look like a settings panel. What a page actually needs is the way back
 * and who you are, and that fits in one line at the top.
 *
 * Back goes through the curtain, with "Menu" on it, so leaving a page
 * feels the same as arriving on one. Esc does the same from anywhere on
 * the page that is not a text field.
 */
export function Hud({
  user,
}: {
  user: { username: string; displayName: string | null };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const name = user.displayName ?? user.username;

  const toMenu = () => {
    if (busy) return;
    setBusy(true);
    raiseCurtain('Menu');
    window.setTimeout(() => router.push('/menu'), CURTAIN_UP_MS);
  };

  useEffect(() => {
    router.prefetch('/menu');
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      toMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    raiseCurtain('Title');
    await requestSignOut();
    window.setTimeout(() => {
      router.refresh();
      router.push('/login');
    }, CURTAIN_UP_MS);
  };

  return (
    <div className="glass sticky top-0 z-30">
      {/* The same width as the board beneath it, and set large enough to
          read from a couch: this is a game's top bar, not a browser's. */}
      <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-4 px-4 py-3 sm:px-8 2xl:px-12">
        <div className="flex items-center gap-4 sm:gap-6">
          <button
            type="button"
            onClick={toMenu}
            disabled={busy}
            className="btn-ghost"
            aria-label="Back to the main menu"
          >
            <span aria-hidden>&larr;</span>
            <span>Menu</span>
            <kbd className="stat-figure ml-1.5 hidden text-[11px] font-normal normal-case tracking-normal text-ink-500 sm:inline">
              Esc
            </kbd>
          </button>
          <Wordmark large href="/menu" />
        </div>

        <div className="flex items-center gap-4 sm:gap-5">
          <a
            href={`/u/${user.username}`}
            className="group hidden items-center gap-3 sm:flex"
            title="Your public profile"
          >
            <span className="font-display text-base font-semibold uppercase tracking-wider text-ink-200 transition-colors group-hover:text-ink-100">
              {name}
            </span>
            <span className="slant grid size-9 place-items-center bg-accent font-display text-sm font-bold italic text-ink-950">
              {name.slice(0, 2).toUpperCase()}
            </span>
          </a>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={busy}
            className="btn-ghost btn-sm"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

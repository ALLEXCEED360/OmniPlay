'use client';

import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Backdrop } from '@/components/backdrop';
import { Wordmark } from '@/components/wordmark';
import { requestSignOut } from '@/components/sign-out';

/**
 * The main menu: a shelf of game cases.
 *
 * The one object every player already reads by reflex is a row of cases
 * on a shelf — spines out, titles running vertically, and the one you are
 * interested in pulled forward to face you. That is this menu. Nine spines
 * fill the width of the screen, each with its own art showing dimly
 * through; the chosen one opens to show that art in full, with its title
 * and a line about what it is. Move along the shelf and the cases slide to
 * make room.
 *
 * It is a shelf because this is a product about a library. The title
 * screen is the game's title; this is its shelf; the pages are the cases.
 *
 * Keys: ←/→ (or ↑/↓, A/D, W/S) move along the shelf, 1–9 jump, Enter opens,
 * Esc returns to the title. A mouse moving over a spine pulls that case;
 * on touch, the first tap pulls it and a second opens it. Everything is
 * prefetched on mount so opening is a cut, not a wait.
 *
 * On a phone the shelf turns upright — spines become rows, the chosen row
 * opens downward — and reads as the same object.
 */

export interface MenuEntry {
  id: string;
  label: string;
  /** One line, in the voice of the page it opens. */
  description: string;
  href: string;
  /** The case art: a portrait crop, shown dim on the spine and full on the face. */
  image: string;
}

const ease = [0.16, 1, 0.3, 1] as const;
const spring = { type: 'spring', stiffness: 380, damping: 40, mass: 0.9 } as const;

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function MainMenu({ entries, name }: { entries: MenuEntry[]; name: string }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const upright = useMedia('(max-width: 760px)');
  const isTouch = useMedia('(pointer: coarse)');

  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const d = (seconds: number) => (reduced ? 0 : seconds);

  useEffect(() => {
    for (const entry of entries) router.prefetch(entry.href);
  }, [entries, router]);

  const leave = useCallback(
    (go: () => void) => {
      if (leaving) return;
      setLeaving(true);
      // Fold to black first, so the page arrives out of the dark rather
      // than over a shelf still on screen.
      window.setTimeout(go, reduced ? 0 : 300);
    },
    [leaving, reduced],
  );

  const open = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      setActive(index);
      leave(() => router.push(entry.href));
    },
    [entries, leave, router],
  );

  const signOut = () =>
    leave(() => {
      void requestSignOut().then(() => {
        router.refresh();
        router.push('/login');
      });
    });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || leaving) return;
      const count = entries.length;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'd':
        case 's':
        case 'l':
        case 'j':
          event.preventDefault();
          setActive((c) => (c + 1) % count);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'a':
        case 'w':
        case 'h':
        case 'k':
          event.preventDefault();
          setActive((c) => (c - 1 + count) % count);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          open(active);
          break;
        case 'Escape':
        case 'Backspace':
          event.preventDefault();
          leave(() => router.push('/boot'));
          break;
        case 'Home':
          setActive(0);
          break;
        case 'End':
          setActive(count - 1);
          break;
        default: {
          if (!/^[1-9]$/.test(event.key)) return;
          const n = Number(event.key);
          if (n <= count) setActive(n - 1);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, entries.length, leave, leaving, open, router]);

  const current = entries[active] ?? entries[0]!;

  return (
    <div className="fixed inset-0 select-none overflow-hidden">
      <Backdrop strength={1} veil={false} />
      {/* Dimmed at the top and foot for the chrome; the middle band, where
          the shelf is, is left to the cases. */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950/90 via-ink-950/20 to-ink-950/95"
        aria-hidden
      />

      {/* In from black, out to black. */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-40 bg-ink-950"
        initial={{ opacity: 1 }}
        animate={{ opacity: leaving ? 1 : 0 }}
        transition={
          leaving
            ? { duration: d(0.3), ease: 'easeIn' }
            : { duration: d(0.7), delay: d(0.1), ease: 'easeOut' }
        }
      />

      <div className="relative z-10 flex h-full flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:pt-6">
        <header className="flex items-center justify-between">
          <motion.div
            initial={reduced ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: d(0.5), delay: d(0.2), ease }}
          >
            <Wordmark asLink={false} />
          </motion.div>
          <motion.p
            className="stat-figure text-[11px] text-ink-500"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: d(0.5), delay: d(0.5) }}
          >
            Signed in as <span className="text-ink-300">{name}</span>
          </motion.p>
        </header>

        {/* ── The shelf ─────────────────────────────────────────── */}
        <nav
          aria-label="Main menu"
          className={`flex min-h-0 flex-1 py-4 sm:py-6 ${
            upright ? 'flex-col gap-1.5' : 'flex-row items-stretch gap-2'
          }`}
          // Cases lean the way everything in this system leans. The inner
          // faces are un-leaned so the type stays upright.
          style={upright ? undefined : { transform: 'skewX(-6deg)' }}
        >
          {entries.map((entry, index) => {
            const isActive = index === active;
            const number = String(index + 1).padStart(2, '0');
            return (
              <motion.button
                key={entry.id}
                type="button"
                layout
                transition={reduced ? { duration: 0 } : spring}
                initial={
                  reduced ? false : upright ? { opacity: 0, x: -24 } : { opacity: 0, y: 40 }
                }
                animate={{ opacity: 1, x: 0, y: 0 }}
                // Move, not enter: when the keyboard shifts the shelf, cases
                // slide under a resting pointer and would "enter" it, handing
                // the choice straight back to the mouse. A pointer that has
                // not moved has not chosen anything.
                onPointerMove={(event) => {
                  if (event.pointerType === 'mouse' && !isActive) setActive(index);
                }}
                onFocus={() => setActive(index)}
                onClick={() => {
                  if (isTouch && !isActive) {
                    setActive(index);
                    return;
                  }
                  open(index);
                }}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`${entry.label}. ${entry.description}`}
                style={{ flex: isActive ? (upright ? '0 0 auto' : '6 1 0%') : '1 1 0%' }}
                className={`group relative min-h-0 min-w-0 overflow-hidden text-left outline-none transition-colors duration-200 ${
                  isActive
                    ? 'bg-ink-950/35 shadow-[inset_0_0_0_2px_var(--color-accent)]'
                    : 'bg-ink-950/50 shadow-[inset_0_0_0_1px_var(--color-ink-800)] focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]'
                }`}
              >
                {/* The case art. Counter-leaned and over-scaled so the
                    lean of the case never shows the art's edge. Never fully
                    opaque, and the case behind it translucent, so the city
                    stays visible through the whole shelf — the cases sit on
                    the backdrop, they do not replace it. */}
                <span
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                  aria-hidden
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.image}
                    alt=""
                    draggable={false}
                    className={`size-full object-cover transition-[opacity,filter] duration-500 ${
                      isActive
                        ? 'opacity-70'
                        : 'opacity-25 saturate-50 group-hover:opacity-40 group-hover:saturate-100'
                    }`}
                    style={upright ? undefined : { transform: 'skewX(6deg) scale(1.2)' }}
                  />
                </span>

                {/* The spine: number at the head, the title running down. */}
                <AnimatePresence initial={false} mode="popLayout">
                  {!isActive ? (
                    <motion.span
                      key="spine"
                      className={`absolute inset-0 flex items-center gap-3 bg-gradient-to-b from-ink-950/85 via-ink-950/40 to-ink-950/85 p-3 ${
                        upright ? 'flex-row' : 'flex-col justify-start pt-4'
                      }`}
                      style={upright ? undefined : { transform: 'skewX(6deg)' }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, transition: { duration: d(0.1) } }}
                      transition={{ duration: d(0.25), delay: d(0.15) }}
                    >
                      <span className="stat-figure text-xs text-accent">{number}</span>
                      <span
                        className={`display whitespace-nowrap text-ink-300 transition-colors group-hover:text-ink-100 ${
                          upright
                            ? 'text-[clamp(1.5rem,6vw,2rem)]'
                            : 'text-[clamp(1.5rem,2.6vw,2.6rem)] [writing-mode:vertical-rl]'
                        }`}
                      >
                        {entry.label}
                      </span>
                    </motion.span>
                  ) : (
                    /* The case, pulled forward: art through the window, the
                       title and its line at the foot. */
                    <motion.span
                      key="face"
                      className={`flex flex-col justify-between p-5 sm:p-7 ${
                        upright ? 'relative min-h-[14rem]' : 'absolute inset-0'
                      }`}
                      style={upright ? undefined : { transform: 'skewX(6deg)' }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, transition: { duration: d(0.1) } }}
                      transition={{ duration: d(0.3), delay: d(0.12) }}
                    >
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent" />
                      <span className="eyebrow relative flex items-center gap-2.5 text-accent">
                        <span className="slash" aria-hidden />
                        {number}
                      </span>
                      <span className="relative">
                        <span className="display block text-[clamp(2.25rem,6.5vw,6.5rem)] leading-[0.85] text-ink-100">
                          {entry.label}
                        </span>
                        <span className="mt-3 block max-w-md text-[15px] leading-snug text-ink-300 sm:text-base">
                          {entry.description}
                        </span>
                        <span className="btn-primary btn-sm mt-5 inline-flex">
                          {isTouch ? 'Tap to open' : 'Open'}
                          <span aria-hidden>&rarr;</span>
                        </span>
                      </span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </nav>

        <motion.footer
          className="flex items-center justify-between gap-4"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: d(0.5), delay: d(0.8) }}
        >
          <div
            className="stat-figure hidden items-center gap-4 text-[11px] text-ink-500 sm:flex"
            aria-hidden
          >
            <span>
              <Key>←</Key> <Key>→</Key> Browse
            </span>
            <span>
              <Key>1</Key>–<Key>{entries.length}</Key> Jump
            </span>
            <span>
              <Key>↵</Key> Open
            </span>
            <span>
              <Key>Esc</Key> Title
            </span>
          </div>
          <span className="stat-figure text-[11px] text-ink-600 sm:hidden">
            {current.label} · tap again to open
          </span>
          <button type="button" onClick={signOut} className="btn-ghost btn-sm">
            <svg
              viewBox="0 0 24 24"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 17l5-5-5-5M20 12H9M12 3H6a2 2 0 00-2 2v14a2 2 0 002 2h6" />
            </svg>
            Sign out
          </button>
        </motion.footer>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-grid h-5 min-w-5 place-items-center px-1 text-ink-400 shadow-[inset_0_0_0_1px_var(--color-ink-700)]">
      {children}
    </span>
  );
}

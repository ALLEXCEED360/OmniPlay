'use client';

import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Backdrop } from '@/components/backdrop';
import { Wordmark } from '@/components/wordmark';
import { requestSignOut } from '@/components/sign-out';

/**
 * The main menu: a hand of cards.
 *
 * Nine tall cards in a row, each carrying its own art and its name, the
 * whole hand filling the width of the screen. The card in focus grows to
 * about twice the width of the others and lifts, takes a gold frame, its
 * art comes up to full colour, and it shows what it opens and the way in. The rest stay
 * readable — name at the foot, number at the head — so the whole menu is
 * legible at a glance and the chosen card is simply the biggest thing on
 * the screen.
 *
 * It replaced a shelf of spines. Spines had to be read sideways and went
 * to slivers when one was pulled; cards keep every name upright and every
 * picture visible whatever is chosen, which is what made the shelf feel
 * busy and this feel calm. No lean on the cards either: the system's slant
 * is in the type and the cut corners, and nine leaning pictures side by
 * side were one slant too many.
 *
 * Keys: ←/→ (or A/D) move along the hand, 1–9 jump, Enter opens, Esc
 * returns to the title. A mouse moving over a card focuses it and a click
 * opens it; on touch a first tap focuses and a second opens. Everything is
 * prefetched on mount so opening is a cut, not a wait.
 *
 * On a phone the hand stacks: cards become rows, the chosen row opens.
 */

export interface MenuEntry {
  id: string;
  label: string;
  /** One line, in the voice of the page it opens. */
  description: string;
  href: string;
  /** The card's art, a portrait crop. */
  image: string;
}

const ease = [0.16, 1, 0.3, 1] as const;
const spring = { type: 'spring', stiffness: 360, damping: 38, mass: 0.9 } as const;

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
  const stacked = useMedia('(max-width: 760px)');
  const isTouch = useMedia('(pointer: coarse)');

  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const d = (seconds: number) => (reduced ? 0 : seconds);
  const count = entries.length;

  useEffect(() => {
    for (const entry of entries) router.prefetch(entry.href);
  }, [entries, router]);

  const leave = useCallback(
    (go: () => void) => {
      if (leaving) return;
      setLeaving(true);
      // Fold to black first, so the page arrives out of the dark rather
      // than over a menu still on screen.
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
  }, [active, count, leave, leaving, open, router]);

  const current = entries[active] ?? entries[0]!;

  return (
    <div className="fixed inset-0 select-none overflow-hidden">
      <Backdrop strength={1} veil={false} />
      {/* The room takes the colour of the chosen card: its art, blown up
          and blurred to a wash, cross-fades over the city as the focus
          moves. This is what makes a choice feel like it reaches past the
          card — the screen answers, not just the frame. */}
      <AnimatePresence initial={false}>
        <motion.div
          key={current.id}
          className="pointer-events-none absolute -inset-[10%]"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 0.55 }}
          exit={{ opacity: 0, transition: { duration: d(0.6) } }}
          transition={{ duration: d(0.8), ease }}
          aria-hidden
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.image}
            alt=""
            draggable={false}
            className="size-full object-cover blur-3xl saturate-150"
          />
        </motion.div>
      </AnimatePresence>
      {/* Dimmed enough that the cards carry the colour, and hard at the
          head and foot for the chrome. */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950/95 via-ink-950/60 to-ink-950/95"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 halftone opacity-40" aria-hidden />

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

      <div className="relative z-10 flex h-full flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:pt-6 lg:px-12">
        <header className="flex items-center justify-between">
          <motion.div
            initial={reduced ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: d(0.5), delay: d(0.2), ease }}
          >
            <Wordmark asLink={false} />
          </motion.div>
          <motion.div
            className="flex items-center gap-3"
            initial={reduced ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: d(0.5), delay: d(0.3), ease }}
          >
            <span className="hidden font-display text-sm font-semibold uppercase tracking-wider text-ink-300 sm:block">
              {name}
            </span>
            <span className="slant grid size-9 place-items-center bg-accent font-display text-sm font-bold italic text-ink-950">
              {name.slice(0, 2).toUpperCase()}
            </span>
          </motion.div>
        </header>

        {/* ── The screen's own title, so the hand is dealt to someone ── */}
        {!stacked ? (
          <motion.div
            className="mt-6 flex items-end justify-between gap-6 lg:mt-8"
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: d(0.5), delay: d(0.35), ease }}
          >
            <div>
              <p className="eyebrow flex items-center gap-2.5 text-accent">
                <span className="slash" aria-hidden />
                Main menu
              </p>
              <h1 className="display mt-2 text-[clamp(2rem,3.6vw,3.5rem)] text-ink-100">
                Welcome back, {name}
              </h1>
            </div>
            {/* Where you are along the hand, in the same figures the
                cards wear, so the two read as one system. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={current.id}
                className="display text-[clamp(2.5rem,5vw,5rem)] leading-none text-ink-100/15"
                initial={reduced ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: d(0.1) } }}
                transition={{ duration: d(0.25), ease }}
                aria-hidden
              >
                {String(active + 1).padStart(2, '0')}
                <span className="text-[0.5em]"> / {String(count).padStart(2, '0')}</span>
              </motion.p>
            </AnimatePresence>
          </motion.div>
        ) : null}

        {/* ── The hand ───────────────────────────────────────────── */}
        <nav
          aria-label="Main menu"
          className={`flex min-h-0 flex-1 ${
            stacked ? 'flex-col gap-1.5 overflow-y-auto py-4' : 'flex-row items-end gap-2.5 py-6 lg:gap-3'
          }`}
        >
          {entries.map((entry, index) => {
            const isActive = index === active;
            const number = String(index + 1).padStart(2, '0');
            return (
              <motion.div
                key={entry.id}
                layout
                transition={reduced ? { duration: 0 } : spring}
                initial={reduced ? false : stacked ? { opacity: 0, x: -24 } : { opacity: 0, y: 48 }}
                animate={{
                  opacity: 1,
                  x: 0,
                  // The chosen card lifts; the others stay on the table.
                  y: !stacked && isActive ? -14 : 0,
                }}
                style={
                  stacked
                    ? { flex: '0 0 auto', height: isActive ? '13rem' : '3.25rem' }
                    : { flex: isActive ? '2.8 1 0%' : '1 1 0%', height: isActive ? '100%' : '88%' }
                }
                // The hard shadow lives on this wrapper: a filter on the
                // clipped card itself would be clipped away with the corners.
                className={`min-h-0 min-w-0 ${isActive && !stacked ? 'hard-shadow' : ''}`}
              >
                <button
                  type="button"
                  // Move, not enter: cards sliding under a resting pointer
                  // must not steal a keyboard choice.
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
                  className={`group relative block size-full overflow-hidden text-left outline-none ${
                    isActive
                      ? 'cut'
                      : 'cut-sm shadow-[inset_0_0_0_1px_var(--color-ink-700)] focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]'
                  }`}
                >
                  {/* The art. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.image}
                    alt=""
                    draggable={false}
                    className={`absolute inset-0 size-full object-cover transition-[opacity,filter,transform] duration-500 ${
                      isActive
                        ? 'opacity-100'
                        : 'opacity-55 saturate-50 group-hover:scale-105 group-hover:opacity-80 group-hover:saturate-100'
                    }`}
                  />
                  {/* Ink from the foot up, so the name reads on any art. */}
                  <span
                    className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950 via-ink-950/75 to-transparent ${
                      isActive ? 'h-4/5' : 'h-3/5'
                    }`}
                    aria-hidden
                  />
                  {/* The gold frame on the chosen card, with a slow light
                      sweeping across it: the one thing on the screen that
                      keeps moving while you decide. */}
                  {isActive ? (
                    <span
                      className="shimmer pointer-events-none absolute! inset-0 shadow-[inset_0_0_0_3px_var(--color-accent)]"
                      aria-hidden
                    />
                  ) : null}

                  {/* The number, at the head. A stacked row is too short for
                      a badge; there the number sits inline before the name. */}
                  {!stacked || isActive ? (
                    <span
                      className={`stat-figure absolute left-3 top-3 px-1.5 text-[11px] leading-5 ${
                        isActive ? 'bg-accent text-ink-950' : 'bg-ink-950/80 text-ink-300'
                      }`}
                      aria-hidden
                    >
                      {number}
                    </span>
                  ) : null}

                  {/* The face: name at the foot, and on the chosen card, the
                      line and the way in. */}
                  <span
                    className={`absolute inset-x-0 bottom-0 flex ${
                      stacked && !isActive
                        ? 'inset-y-0 flex-row items-center gap-3 px-4'
                        : stacked
                          ? 'flex-col p-4'
                          : isActive
                            ? 'flex-col p-5 lg:p-7'
                            : 'flex-col p-3'
                    }`}
                  >
                    {stacked && !isActive ? (
                      <span className="stat-figure text-[11px] text-accent" aria-hidden>
                        {number}
                      </span>
                    ) : null}
                    <span
                      className={`display block leading-[0.9] text-ink-100 ${
                        stacked
                          ? 'text-[clamp(1.4rem,6vw,1.9rem)]'
                          : isActive
                            ? 'text-[clamp(1.75rem,2.9vw,3.5rem)] [overflow-wrap:anywhere]'
                            : 'text-[clamp(0.8rem,1.05vw,1.15rem)]'
                      }`}
                    >
                      {entry.label}
                    </span>
                    <AnimatePresence initial={false}>
                      {isActive ? (
                        <motion.span
                          key="detail"
                          className="block"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, transition: { duration: d(0.1) } }}
                          transition={{ duration: d(0.3), delay: d(0.15), ease }}
                        >
                          <span className="mt-2 block max-w-sm text-[13px] leading-snug text-ink-300 sm:mt-3 sm:text-[15px]">
                            {entry.description}
                          </span>
                          <span className="btn-primary btn-sm mt-4 inline-flex">
                            {isTouch ? 'Tap to open' : 'Open'}
                            <span aria-hidden>&rarr;</span>
                          </span>
                        </motion.span>
                      ) : null}
                    </AnimatePresence>
                  </span>
                </button>
              </motion.div>
            );
          })}
        </nav>

        {/* The table the hand is dealt on. */}
        {!stacked ? <div className="rule-soft mb-5" aria-hidden /> : null}

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
              <Key>1</Key>–<Key>{count}</Key> Jump
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

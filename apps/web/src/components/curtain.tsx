'use client';

import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { motionEnabled } from '@/lib/preferences';

/**
 * The curtain: the big transition between screens, and the thing that
 * outlives a navigation.
 *
 * Three slanted slabs tear across the screen from the left — paper leads,
 * gold follows, ink lands on top and holds — and while the ink holds, the
 * name of where you are going slams in across the middle. Behind all
 * that the router does its work: the old screen unmounts, the new one
 * mounts and paints. Then the slabs leave to the right, ink first, so a
 * gold-and-paper stripe trails behind it uncovering the new screen.
 *
 * It lives in the root layout so it survives the route change, and it
 * reveals itself: when the path changes while the ink is holding, it
 * waits out the rest of the hold (so a fast page does not flash past)
 * and lets go. Nothing on the arriving page has to know it exists. If the
 * navigation never happens it reveals anyway after a few seconds, so a
 * failed push cannot leave the app under the ink.
 *
 * The timing is a cover you can feel, a hold long enough to read the
 * word, and a reveal that trails — kept just above the threshold where a
 * cut reads as a glitch rather than a transition. It is quicker than the
 * rest of the app's motion on purpose: this one plays between the title,
 * the menu and the screen you opened from it, which is a route people
 * take constantly, while an ordinary navigation keeps the slower arrival.
 *
 * Switching animation off in Settings skips the whole thing:
 * `raiseCurtain` becomes a no-op and `curtainDelay()` returns zero, so
 * navigation is immediate.
 */

interface CurtainState {
  word: string;
  phase: 'cover' | 'reveal';
  since: number;
}

type Listener = () => void;

let state: CurtainState | null = null;
const listeners = new Set<Listener>();

function set(next: CurtainState | null) {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * Bring the curtain down, with the name of where we are going.
 *
 * Does nothing when the reader has switched animation off: pair it with
 * `curtainDelay()`, which is then zero, and the navigation happens at once.
 */
export function raiseCurtain(word = ''): void {
  if (state || !motionEnabled()) return;
  set({ word, phase: 'cover', since: Date.now() });
}

/**
 * How long to wait before navigating, so the screen is covered first.
 * Zero when animation is off or reduced — there is nothing to wait for.
 */
export function curtainDelay(reduced?: boolean | null): number {
  return reduced || !motionEnabled() ? 0 : CURTAIN_UP_MS;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const getServerSnapshot = () => null;

/** The slabs take this long to cover the screen; navigate after it. */
export const CURTAIN_UP_MS = 320;
/** How long the ink holds with the word up before revealing. */
const HOLD_MS = 240;
const REVEAL_MS = 380;
const MAX_MS = 5000;

const EASE = [0.76, 0, 0.18, 1] as const;

export function Curtain() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  // Reveal on arrival: the path has changed, so the new screen is mounted.
  // The hold is honoured in full, so the word is on screen long enough to
  // be read even when the page was ready at once.
  useEffect(() => {
    if (!state || state.phase !== 'cover') return;
    const elapsed = Date.now() - state.since;
    const wait = Math.max(0, CURTAIN_UP_MS + HOLD_MS - elapsed);
    const reveal = window.setTimeout(() => {
      if (state) set({ ...state, phase: 'reveal' });
      timers.current.push(window.setTimeout(() => set(null), REVEAL_MS + 200));
    }, wait);
    timers.current.push(reveal);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // The safety catch.
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => set(null), MAX_MS);
    return () => window.clearTimeout(timer);
  }, [current]);

  const cover = current?.phase === 'cover';
  const coverS = reduced ? 0 : CURTAIN_UP_MS / 1000;
  const revealS = reduced ? 0 : REVEAL_MS / 1000;
  const d = (seconds: number) => (reduced ? 0 : seconds);

  const slab = (tone: 'paper' | 'gold' | 'ink', inDelay: number, outDelay: number) => (
    <motion.div
      key={tone}
      className={`absolute -inset-y-[20%] left-[-15%] w-[135%] ${
        tone === 'paper'
          ? 'bg-paper [clip-path:polygon(0_0,95%_0,100%_100%,8%_100%)]'
          : tone === 'gold'
            ? 'bg-accent [clip-path:polygon(0_0,92%_0,100%_100%,6%_100%)]'
            : 'bg-ink-950 [clip-path:polygon(0_0,88%_0,97%_100%,3%_100%)]'
      }`}
      initial={{ x: '-125%' }}
      animate={{ x: cover ? '0%' : '125%' }}
      transition={{
        duration: cover ? coverS : revealS,
        delay: cover ? d(inDelay) : d(outDelay),
        ease: EASE,
      }}
    />
  );

  const word = current?.word ?? '';
  // Never wider than the screen: sized from the word's length, at the
  // 1.32× stretch it settles at.
  const fit = word ? `${(86 / (word.length * 0.62)).toFixed(1)}vw` : '16vw';

  return (
    <AnimatePresence>
      {current ? (
        <div
          className="pointer-events-none fixed inset-0 z-[60] grid place-items-center overflow-hidden"
          aria-hidden
        >
          {slab('paper', 0, 0.16)}
          {slab('gold', 0.05, 0.08)}
          {slab('ink', 0.1, 0)}
          {word ? (
            <motion.div
              className="display relative z-[4] whitespace-nowrap text-paper [text-shadow:0.03em_0.03em_0_var(--color-accent)]"
              style={{ fontSize: `clamp(40px, min(16vw, ${fit}), 260px)` } as CSSProperties}
              initial={{ opacity: 0, x: -90, scaleX: 1.9 }}
              animate={
                cover ? { opacity: 1, x: 0, scaleX: 1.32 } : { opacity: 0, x: 160, scaleX: 1.5 }
              }
              transition={{
                duration: cover ? d(0.26) : d(0.2),
                delay: cover ? d(0.2) : 0,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {word}
            </motion.div>
          ) : null}
        </div>
      ) : null}
    </AnimatePresence>
  );
}

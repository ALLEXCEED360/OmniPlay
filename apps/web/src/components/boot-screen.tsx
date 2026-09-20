'use client';

import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Backdrop } from '@/components/backdrop';
import { CURTAIN_UP_MS, raiseCurtain } from '@/components/curtain';

/**
 * The title screen.
 *
 * Shown once, right after signing in, before the menu — the beat a game
 * gives you between the platform logos and the first choice. Three things
 * on the screen and no more: the name, sized to the viewport so it fills
 * the screen the way a title does, arriving stretched from both sides and
 * settling with a red slash under it; the prompt, waiting at the
 * bottom where a title screen keeps it; and who is signed in, in the
 * corner. It leads to the main menu, not straight to a page. A first cut
 * also printed a readout of library statistics here,
 * which was a dashboard trying to start early — the numbers belong on the
 * next screen, where they can be read, not on this one, where they are
 * clutter under a logo.
 *
 * Any key or a tap advances; the first 600 ms are ignored so a keypress
 * still travelling from the sign-in form cannot skip the whole thing.
 *
 * It is deliberately its own route outside the app shell rather than an
 * overlay on the dashboard: there is no menu behind it to tab into, and the
 * dashboard's own arrival wipe then plays as the answer to the tap.
 */

const ease = [0.16, 1, 0.3, 1] as const;

/** Keys that are never "press any key". */
const IGNORED_KEYS = new Set(['Tab', 'F5', 'F11', 'F12', 'Shift', 'Control', 'Alt', 'Meta']);

export function BootScreen({
  name,
  /** The route the tap takes you to. */
  next = '/menu',
}: {
  name: string;
  next?: string;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [armed, setArmed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [touch, setTouch] = useState(false);

  // Timings collapse to nothing under reduced motion; the screen still
  // shows, it just does not perform.
  const d = (seconds: number) => (reduced ? 0 : seconds);

  useEffect(() => {
    setTouch(window.matchMedia('(pointer: coarse)').matches);
    const timer = window.setTimeout(() => setArmed(true), reduced ? 0 : 600);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  // The dashboard is fetched while the prompt is still waiting, so the tap
  // lands on a page that is already there.
  useEffect(() => {
    router.prefetch(next);
  }, [router, next]);

  useEffect(() => {
    if (!armed || leaving) return;

    const begin = () => {
      setLeaving(true);
      // The curtain comes down and stays down until the menu has mounted
      // and painted, which is the cut a game makes between title and menu.
      raiseCurtain('Menu');
      window.setTimeout(() => router.push(next), reduced ? 0 : CURTAIN_UP_MS);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (IGNORED_KEYS.has(event.key)) return;
      event.preventDefault();
      begin();
    };
    const onPointer = (event: PointerEvent) => {
      // Only the primary button; a right-click is someone looking for the
      // inspector, not starting the game.
      if (event.button !== 0) return;
      begin();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [armed, leaving, next, reduced, router]);

  return (
    <div className="fixed inset-0 grid select-none place-items-center overflow-hidden">
      <Backdrop strength={1} veil={false} />
      <div className="pointer-events-none absolute inset-0 bg-ink-950/45" aria-hidden />

      {/* In from black; out is the curtain's job. */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-30 bg-ink-950"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: d(1.1), delay: d(0.2), ease: 'easeOut' }}
      />

      {/* A dark pool behind the name so it reads over whatever the footage
          is doing at that moment. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70vh] w-[110vw] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_at_center,var(--color-ink-950)_0%,transparent_65%)] opacity-90"
        aria-hidden
      />

      {/* Three vertical zones — name centred, prompt low, signature in the
          corners — each aligned to the same centre line or the same
          gutter, so nothing on the screen is placed by accident. */}
      <div className="relative z-10 grid h-full w-full grid-rows-[1fr_auto] px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 sm:px-10">
        <div className="flex flex-col items-center justify-center text-center">
          {/* The letters settle at 1.35× wide rather than 1×: an extended
              cut, which is what a title wants, and what lets four letters
              stacked twice fill a widescreen rather than sit in a column
              down the middle of it. The stretch is a transform so the
              condensed face keeps its bone structure. */}
          <div className="display flex flex-col items-center leading-[0.8] text-ink-100">
            <motion.span
              className="block text-[clamp(5rem,min(33vw,36vh),34rem)]"
              initial={{ opacity: 0, x: -160, scaleX: 2 }}
              animate={{ opacity: 1, x: 0, scaleX: 1.35 }}
              transition={{ duration: d(0.9), delay: d(0.55), ease }}
            >
              Omni
            </motion.span>
            <motion.span
              className="block text-[clamp(5rem,min(33vw,36vh),34rem)] text-accent"
              initial={{ opacity: 0, x: 160, scaleX: 2 }}
              animate={{ opacity: 1, x: 0, scaleX: 1.35 }}
              transition={{ duration: d(0.9), delay: d(0.72), ease }}
            >
              play
            </motion.span>
          </div>

          {/* The slash grows from the centre outwards, so it stays centred
              under the name at every width rather than growing from one
              edge and looking lopsided until it finishes. */}
          <motion.span
            className="mt-[2.5vh] block h-[clamp(0.375rem,0.8vh,0.75rem)] w-[clamp(12rem,min(36vw,44vh),40rem)] bg-accent"
            initial={{ scaleX: 0, skewX: -20 }}
            animate={{ scaleX: 1, skewX: -20 }}
            transition={{ duration: d(0.7), delay: d(1.15), ease }}
            aria-hidden
          />

          <motion.p
            className="eyebrow mt-[2vh] text-[clamp(0.8rem,1.6vw,1.3rem)] tracking-[0.5em] text-ink-400"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: d(0.6), delay: d(1.4), ease }}
          >
            Your universal gaming identity
          </motion.p>
        </div>

        {/* The prompt, on the same centre line as the name, and the two
            corner notes on one baseline at the gutters. */}
        <div className="relative flex flex-col items-center">
          {/* The prompt is the one thing on this screen you can act on, so
              it is dressed as the one thing you can act on: a paper cut-out
              on a red shadow, the same shape as every primary button in the
              app, at a size that competes with the name. It breathes rather
              than blinks — a slow swell, and a highlight sweeping across the
              paper — because a blink reads as an error and a swell reads
              as an invitation.

              Motion owns the entrance (opacity, a rise); the CSS keyframes
              on the inner wrapper own the breathing, on separate elements
              so neither overwrites the other's transform. */}
          <motion.button
            type="button"
            className="group mb-8 sm:mb-10"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: armed ? 1 : 0, y: armed ? 0 : 16 }}
            transition={{ duration: d(0.5), delay: d(1.9), ease }}
          >
            <span className="anim-breathe block">
              <span className="hard-shadow block">
                <span className="paper slant shimmer flex items-center gap-4 px-8 py-4 sm:gap-6 sm:px-14 sm:py-6">
                  <span className="slash h-8! w-3! bg-accent" aria-hidden />
                  <span className="display text-[clamp(1.75rem,4vw,3.5rem)] leading-none text-ink-950">
                    {touch ? 'Tap anywhere' : 'Press any key'}
                  </span>
                  <span className="hidden font-display text-base font-semibold uppercase tracking-[0.3em] text-ink-700 sm:block">
                    to continue
                  </span>
                </span>
              </span>
            </span>
          </motion.button>

          <motion.div
            className="stat-figure flex w-full items-baseline justify-between text-[11px] text-ink-600"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: d(0.6), delay: d(2.2) }}
          >
            <span>
              Signed in as <span className="text-ink-400">{name}</span>
            </span>
            <span>OMNIPLAY</span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

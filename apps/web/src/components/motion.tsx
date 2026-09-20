'use client';

import Link from 'next/link';
import { motion, MotionConfig, type HTMLMotionProps } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * The motion vocabulary, as components.
 *
 * Two kinds of movement live here, and the split matters.
 *
 * Arrivals — the page wipe, the headline, a section revealing on scroll —
 * are CSS keyframes wrapped in a component. A keyframe starts the moment
 * the HTML paints; anything a motion library drives waits for hydration,
 * and the first version of this file learned that the hard way: a cold dev
 * compile left every page blank for six seconds with its content parked at
 * `opacity: 0` waiting for JavaScript. Content is never held hostage to a
 * script.
 *
 * Responses — a cover leaning into the pointer, the menu cursor sliding
 * between rows, a sheet wiping in and out — use `motion`, because they need
 * a spring, a shared layout, or an exit animation, and CSS has none of those.
 * By the time anyone can hover, the page has long since hydrated.
 *
 * The timing is deliberately punchy. Persona menus do not ease in; they
 * arrive, overshoot by a hair, and stop. That is the `spring` below.
 */

const spring = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } as const;

/** Wrap a subtree so every motion component inside honours reduced motion. */
export function Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * The red wipe that plays as a page arrives, and the page sliding in
 * behind it. Rendered from the route template so it remounts — and
 * therefore replays — on every navigation.
 */
export function PageWipe({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="page-wipe hatch" aria-hidden />
      <div className="anim-page">{children}</div>
    </>
  );
}

/**
 * Reveals its content as it scrolls into view, where the browser can drive
 * that from scroll position; on page load elsewhere. `index` staggers a
 * list.
 */
export function Reveal({
  children,
  index = 0,
  className,
  style,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`reveal ${className ?? ''}`}
      style={{ '--i': index, ...style } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * A word-by-word display heading. Each word rises out of its own clip a
 * beat after the last, which is how a Persona screen introduces itself.
 */
export function Headline({
  text,
  className,
  delayMs = 200,
}: {
  text: string;
  className?: string;
  delayMs?: number;
}) {
  return (
    <span className={className} style={{ '--delay': `${delayMs}ms` } as CSSProperties}>
      {text.split(' ').map((word, index) => (
        <span key={`${word}-${index}`} className="inline-block overflow-hidden pr-[0.25em]">
          <span className="anim-word" style={{ '--i': index } as CSSProperties}>
            {word}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * A link that leans into the pointer. The tilt is small — a degree and a
 * half — because the point is that it answers, not that it performs.
 */
export const MotionLink = motion.create(Link);

export function TiltLink({
  children,
  className,
  href,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  href: string;
} & Omit<HTMLMotionProps<'a'>, 'children' | 'href'>) {
  return (
    <MotionLink
      href={href}
      className={className}
      whileHover={{ y: -6, rotate: -1.5, scale: 1.025 }}
      whileTap={{ scale: 0.97, rotate: 0 }}
      transition={spring}
      {...rest}
    >
      {children}
    </MotionLink>
  );
}

/** A panel that nudges on hover. For cards that are links or buttons only. */
export function Nudge({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & Omit<HTMLMotionProps<'div'>, 'children'>) {
  return (
    <motion.div className={className} whileHover={{ x: 4, y: -4 }} transition={spring} {...rest}>
      {children}
    </motion.div>
  );
}

export { motion };

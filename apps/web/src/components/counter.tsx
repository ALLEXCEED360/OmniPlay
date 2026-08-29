'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCount, formatHours } from '@/lib/format';

/**
 * A figure that counts up to its value once, when it first scrolls into view.
 *
 * Two rules keep this from being decoration that costs the reader something:
 *
 * 1. The server renders the *final* string. If JavaScript never runs, or the
 *    tab is throttled, or the user has asked for reduced motion, the correct
 *    number is already on screen — the animation only ever replaces a correct
 *    value with the same correct value.
 * 2. It runs on view, not on mount. A count-up that finishes above the fold
 *    before the reader scrolls down to it has animated nothing.
 *
 * The width is reserved by rendering the final string in a hidden layer, so a
 * figure going 0 → 5,027 does not reflow the row it sits in on every frame.
 *
 * `kind` is a string rather than a formatter function because a server
 * component cannot hand a function across the boundary to a client one.
 */

export type CounterKind = 'count' | 'hours';

export function Counter({
  value,
  kind = 'count',
  className,
  durationMs = 900,
}: {
  value: number;
  kind?: CounterKind;
  className?: string;
  durationMs?: number;
}) {
  const format = useCallback(
    (n: number) => (kind === 'hours' ? formatHours(n) : formatCount(n)),
    [kind],
  );
  const final = format(value);
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches || value <= 0) return;

    let frame = 0;
    let cancelled = false;

    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - start) / durationMs);
        // Ease out: the number decelerates into its resting value rather than
        // stopping dead, which is what makes it read as arriving.
        const eased = 1 - Math.pow(1 - t, 3);
        setText(t >= 1 ? null : format(Math.round(value * eased)));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          run();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, format, durationMs]);

  return (
    <span ref={ref} className={`relative inline-grid ${className ?? ''}`}>
      {/* Reserves the final width so the row never reflows mid-count. */}
      <span className="invisible col-start-1 row-start-1" aria-hidden>
        {final}
      </span>
      <span className="col-start-1 row-start-1 text-left">{text ?? final}</span>
    </span>
  );
}

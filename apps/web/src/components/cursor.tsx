'use client';

import { useEffect, useRef } from 'react';

/**
 * The cursor: a gold arrowhead that becomes a reticle when pressed, with a
 * faint trail of sparks behind it.
 *
 * Mounted once in the root layout. It only takes over from the system
 * cursor where there is one — a touch screen has no pointer to replace —
 * and it draws nothing for anyone who has asked for reduced motion, who
 * gets the arrowhead alone.
 *
 * Everything runs off the DOM: the arrowhead is moved by writing its
 * transform on every pointer event (no React state, no re-render), and the
 * sparks are a canvas the size of the viewport that clears and redraws
 * only while there are sparks alive. Hover is detected by delegation on
 * `mouseover`, so elements that mount later are covered without anyone
 * attaching listeners to them.
 */

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [role="checkbox"]';

/* The system's gold, as hex for the canvas: accent, its bright edge, paper. */
const SPARK_COLOURS = ['#e6b93f', '#f2d27a', '#f7f4ec'];

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  colour: string;
}

export function Cursor() {
  const arrowRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // No pointer to replace, nothing to do.
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const arrow = arrowRef.current;
    const canvas = canvasRef.current;
    if (!arrow || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    document.documentElement.classList.add('has-cursor');

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const sparks: Spark[] = [];
    let last = { x: -1, y: -1 };
    let frame = 0;
    let running = false;

    const spawn = (x: number, y: number, burst: boolean) => {
      const count = burst ? 8 : 1;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = burst ? Math.random() * 2.5 + 0.8 : 0.3;
        sparks.push({
          x: x + (Math.random() - 0.5) * 4,
          y: y + (Math.random() - 0.5) * 4,
          vx: burst ? Math.cos(angle) * speed : (Math.random() - 0.5) * 0.4,
          vy: burst ? Math.sin(angle) * speed : (Math.random() - 0.5) * 0.4 - 0.2,
          size: burst ? Math.random() * 2 + 1 : Math.random() * 1.5 + 0.8,
          alpha: 0.75,
          decay: burst ? Math.random() * 0.04 + 0.03 : Math.random() * 0.03 + 0.035,
          colour: SPARK_COLOURS[Math.floor(Math.random() * SPARK_COLOURS.length)]!,
        });
      }
      if (!running) {
        running = true;
        frame = requestAnimationFrame(tick);
      }
    };

    // The loop only runs while there is something to draw; a still pointer
    // costs nothing.
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.x += s.vx;
        s.y += s.vy;
        s.vx *= 0.95;
        s.vy *= 0.95;
        s.alpha -= s.decay;
        if (s.size > 0.2) s.size -= 0.02;
        if (s.alpha <= 0 || s.size <= 0.2) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = s.colour;
        ctx.shadowColor = s.colour;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (sparks.length > 0) {
        frame = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const { clientX: x, clientY: y } = event;
      arrow.style.transform = `translate(${x}px, ${y}px)`;
      arrow.dataset.shown = 'true';
      // Sparse: one spark per 14px of travel, not one per event.
      if (!reduced && Math.hypot(x - last.x, y - last.y) > 14) {
        spawn(x, y, false);
        last = { x, y };
      }
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      arrow.dataset.pressed = 'true';
      if (!reduced) spawn(event.clientX, event.clientY, true);
    };
    const onUp = () => {
      delete arrow.dataset.pressed;
    };
    const onOver = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(INTERACTIVE)) arrow.dataset.hover = 'true';
      else delete arrow.dataset.hover;
    };
    const onLeave = () => {
      delete arrow.dataset.shown;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseover', onOver);
    document.documentElement.addEventListener('mouseleave', onLeave);

    return () => {
      document.documentElement.classList.remove('has-cursor');
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseover', onOver);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[9998]" aria-hidden />
      <div ref={arrowRef} className="cursor-arrow" aria-hidden>
        {/* The arrowhead. */}
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="cursor-arrow__default">
          <path
            d="M4 4L12.5 28L17.5 17.5L28 12.5L4 4Z"
            fill="var(--color-accent)"
            stroke="var(--color-accent-strong)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M7 7L13.5 23L16.5 16.5L23 13.5L7 7Z" fill="var(--color-paper)" />
          <circle cx="17.5" cy="17.5" r="1.5" fill="#fff" />
        </svg>
        {/* The reticle, while pressed. */}
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="cursor-arrow__pressed">
          <circle cx="16" cy="16" r="11" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="4 2" />
          <circle cx="16" cy="16" r="3" fill="#fff" />
          <line x1="16" y1="2" x2="16" y2="8" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
          <line x1="16" y1="24" x2="16" y2="30" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
          <line x1="2" y1="16" x2="8" y2="16" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
          <line x1="24" y1="16" x2="30" y2="16" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </>
  );
}

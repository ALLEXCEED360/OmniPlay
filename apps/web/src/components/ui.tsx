import type { CSSProperties, ReactNode } from 'react';
import { formatCount, providerLabel } from '@/lib/format';
import { platformStyle } from '@/lib/platform';

/**
 * The shared visual vocabulary (spec 22).
 *
 * Kept as small presentational pieces rather than a component library so the
 * design stays legible in one file while the system is still settling.
 */

/* ------------------------------------------------------------------ *
 * Stat display
 * ------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  hint,
  accent,
  /** Provider id, when this figure belongs to one platform. */
  provider,
  /** Position in a staggered row. */
  index = 0,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
  provider?: string;
  index?: number;
}) {
  // A platform-owned figure takes that platform's colour; everything else
  // stays neutral so the coloured ones actually mean something.
  const style = provider ? platformStyle(provider) : null;
  const bloom = style ? style.bloom : accent ? 'var(--color-accent)' : undefined;
  const figure = style ? style.text : accent ? 'text-accent' : 'text-ink-100';

  return (
    <div
      className="card bloom anim-rise stagger group relative p-5"
      style={{ '--i': index, ...(bloom ? { '--bloom': bloom } : {}) } as CSSProperties}
    >
      {/* A hairline that lights up on hover. The card is not interactive, so
          this acknowledges the pointer without pretending to be a button. */}
      <span
        className={`absolute inset-x-0 top-0 h-px transition-opacity ${
          accent || provider ? 'opacity-70' : 'bg-ink-700 opacity-0 group-hover:opacity-100'
        } ${style ? style.bar : accent ? 'bg-accent' : ''}`}
        aria-hidden
      />
      <div className="eyebrow text-ink-500">{label}</div>
      <div className={`stat-figure mt-2 text-3xl ${figure}`}>
        {typeof value === 'number' ? formatCount(value) : value}
      </div>
      {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Provider badges
 * ------------------------------------------------------------------ */

const PROVIDER_STYLES: Record<string, string> = {
  steam: 'bg-steam/15 text-steam border-steam/30',
  xbox: 'bg-xbox/15 text-xbox border-xbox/30',
  psn: 'bg-psn/15 text-psn border-psn/30',
};

export function PlatformBadge({ provider, small }: { provider: string; small?: boolean }) {
  const style = PROVIDER_STYLES[provider] ?? 'bg-ink-800 text-ink-400 border-ink-700';
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${style} ${
        small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      {providerLabel(provider)}
    </span>
  );
}

/**
 * Marks a figure whose provenance is weaker than "the provider said so".
 * Rendering this instead of a bare number is what keeps spec 2.5 honest.
 */
export function ConfidenceNote({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-500">
      <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor" aria-hidden>
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a.9.9 0 110 1.8A.9.9 0 018 4zm1 8H7V7h2v5z" />
      </svg>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Layout primitives
 * ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  action,
  /** A short uppercase word above the title, naming what this page is. */
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="anim-rise mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow ? (
            <div className="eyebrow mb-2 flex items-center gap-2 text-accent">
              <span className="h-px w-6 bg-accent/60" aria-hidden />
              {eyebrow}
            </div>
          ) : null}
          <h1 className="text-3xl font-semibold tracking-tight text-ink-100 sm:text-[2.125rem]">
            {title}
          </h1>
          {subtitle ? <p className="mt-2 max-w-2xl text-sm text-ink-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="rule-soft mt-6" aria-hidden />
    </header>
  );
}

export function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="eyebrow flex items-center gap-2 text-ink-400">
        <span className="h-3 w-0.5 rounded-full bg-accent/70" aria-hidden />
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * Empty states carry the next action, not just an apology (spec 29).
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-ink-850 text-ink-500">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="text-base font-medium text-ink-200">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-ink-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Bars
 * ------------------------------------------------------------------ */

/** Horizontal proportion bar used by platform and genre breakdowns. */
export function ProportionBar({
  label,
  value,
  max,
  caption,
  tone = 'accent',
  /** Provider id, when this row is one platform's share. */
  provider,
  index = 0,
}: {
  label: string;
  value: number;
  max: number;
  caption: string;
  tone?: 'accent' | 'violet';
  provider?: string;
  index?: number;
}) {
  // Guard the divide: an all-zero breakdown must render flat, not NaN-wide.
  const percent = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const color = provider
    ? platformStyle(provider).bar
    : tone === 'violet'
      ? 'bg-violet'
      : 'bg-accent';

  return (
    <div className="group/bar">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink-300 transition-colors group-hover/bar:text-ink-100">{label}</span>
        <span className="stat-figure text-ink-400">{caption}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-850">
        {/* The bar grows along its own axis rather than being handed a width,
            so the number and the length arrive together. `both` fill means a
            tab that never animates still shows the full bar. */}
        <div
          className={`anim-grow stagger h-full rounded-full ${color}`}
          style={{ width: `${percent}%`, '--i': index } as CSSProperties}
        />
      </div>
    </div>
  );
}

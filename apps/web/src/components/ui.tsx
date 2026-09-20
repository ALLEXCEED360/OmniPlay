import type { CSSProperties, ReactNode } from 'react';
import { formatCount, providerLabel } from '@/lib/format';
import { platformStyle } from '@/lib/platform';
import { Headline } from '@/components/motion';

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
  const tab = style ? style.bar : accent ? 'bg-accent' : 'bg-ink-700';

  return (
    <div
      className="card bloom anim-rise stagger group relative p-5"
      style={{ '--i': index, ...(bloom ? { '--bloom': bloom } : {}) } as CSSProperties}
    >
      {/* A slanted tab in the top-left corner, in the figure's colour. It is
          the one piece of decoration a panel gets, and it says whose number
          this is before the label does. */}
      <span
        className={`absolute left-0 top-0 h-1.5 w-10 origin-left -skew-x-[20deg] transition-transform duration-300 group-hover:scale-x-150 ${tab}`}
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
  steam: 'bg-steam text-ink-950',
  xbox: 'bg-xbox text-ink-950',
  psn: 'bg-psn text-ink-950',
};

/** A slanted tag in the platform's own colour. */
export function PlatformBadge({ provider, small }: { provider: string; small?: boolean }) {
  const style = PROVIDER_STYLES[provider] ?? 'bg-ink-700 text-ink-100';
  return (
    <span
      className={`inline-flex -skew-x-[14deg] items-center font-display font-bold uppercase tracking-wider ${style} ${
        small ? 'px-1.5 py-px text-[10px]' : 'px-2.5 py-0.5 text-xs'
      }`}
    >
      <span className="skew-x-[14deg]">{providerLabel(provider)}</span>
    </span>
  );
}

/**
 * Marks a figure whose provenance is weaker than "the provider said so".
 * Rendering this instead of a bare number is what keeps spec 2.5 honest.
 */
export function ConfidenceNote({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-2 text-xs text-ink-500">
      <span className="slash mt-px h-3.5! w-1! shrink-0 opacity-70" aria-hidden />
      <span>{children}</span>
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
    <header className="relative mb-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="eyebrow anim-rise mb-3 flex items-center gap-2.5 text-accent">
              <span className="slash" aria-hidden />
              {eyebrow}
            </div>
          ) : null}
          {/* The title is the loudest thing on the page and is allowed to
              be: condensed, leaning, and arriving one word at a time. */}
          <h1 className="display text-[3rem] text-ink-100 sm:text-[4.25rem]">
            <Headline text={title} />
          </h1>
          {subtitle ? (
            <p className="anim-rise stagger mt-4 max-w-2xl text-[15px] text-ink-400" style={{ '--i': 4 } as CSSProperties}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="anim-rise stagger" style={{ '--i': 5 } as CSSProperties}>{action}</div> : null}
      </div>

      {/* A red bar rather than a hairline: the page's own underline, short
          and slanted so it reads as a stroke and not a table border. */}
      <div className="mt-6 flex items-center gap-2" aria-hidden>
        <span className="anim-grow h-1 w-24 -skew-x-[20deg] bg-accent" />
        <span className="anim-grow stagger h-1 w-3 -skew-x-[20deg] bg-accent/60" style={{ '--i': 2 } as CSSProperties} />
        <span className="rule-soft flex-1" />
      </div>
    </header>
  );
}

export function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="display flex items-center gap-2.5 text-[1.35rem] text-ink-100">
        <span className="slash" aria-hidden />
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
    <div className="card relative flex flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      {/* A red stripe across the corner, so an empty panel is still a
          designed panel and not a missing one. */}
      <span
        className="pointer-events-none absolute -right-16 top-6 w-64 rotate-[28deg] bg-accent py-1 text-center font-display text-[11px] font-bold uppercase tracking-[0.3em] text-ink-950 hatch"
        aria-hidden
      >
        Nothing here
      </span>
      <h3 className="display text-2xl text-ink-100">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-ink-500">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
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
        <span className="font-display text-[15px] font-semibold uppercase tracking-wide text-ink-300 transition-colors group-hover/bar:text-ink-100">
          {label}
        </span>
        <span className="stat-figure text-ink-400">{caption}</span>
      </div>
      <div className="h-2 -skew-x-[20deg] overflow-hidden bg-ink-850">
        <div
          className={`anim-grow stagger h-full ${color}`}
          style={{ width: `${percent}%`, '--i': index } as CSSProperties}
        />
      </div>
    </div>
  );
}

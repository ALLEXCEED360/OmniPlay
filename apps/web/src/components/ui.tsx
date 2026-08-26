import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatCount, providerLabel } from '@/lib/format';

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
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-5 transition-colors hover:border-ink-700">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-500">{label}</div>
      <div
        className={`stat-figure mt-2 text-3xl ${accent ? 'text-accent' : 'text-ink-100'}`}
      >
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
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-100">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm text-ink-400">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-400">{children}</h2>
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
 * Game artwork
 * ------------------------------------------------------------------ */

export function GameCard({
  game,
}: {
  game: {
    slug: string;
    name: string;
    coverImage: string | null;
    providers: string[];
    totalMinutes: number;
    status: string;
    owned: boolean;
    /** Distinguishes a removed entitlement from one that never existed. */
    ownershipState?: 'OWNED' | 'PREVIOUSLY_OWNED' | 'UNKNOWN';
  };
}) {
  return (
    <Link
      href={`/game/${game.slug}`}
      className="group relative block overflow-hidden rounded-[var(--radius-card)] border border-ink-800 bg-ink-900 transition-all hover:border-ink-600 hover:shadow-lg hover:shadow-black/40"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-ink-850">
        {game.coverImage ? (
          // Plain img: covers come from many CDN hosts and are already sized.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.coverImage}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          // A neutral mark, not the title: the label below already carries the
          // name, and printing it twice reads as a duplicate entry.
          <div className="grid size-full place-items-center text-ink-700" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.25">
              <rect x="2" y="6" width="20" height="12" rx="4" />
              <path d="M7 12h3M8.5 10.5v3M15.5 11.5h.01M17.5 13.5h.01" strokeLinecap="round" />
            </svg>
          </div>
        )}

        {/* Gradient scrim so the title stays readable over any artwork. */}
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink-950 via-ink-950/80 to-transparent" />

        {/* Only a removed entitlement earns "previously owned". A game known
            solely from play history was never recorded as owned, so claiming
            it used to be would invent a purchase that may never have happened. */}
        {game.ownershipState && game.ownershipState !== 'OWNED' ? (
          <span className="absolute right-2 top-2 rounded-full bg-ink-950/80 px-2 py-0.5 text-[10px] font-medium text-ink-400 backdrop-blur">
            {game.ownershipState === 'PREVIOUSLY_OWNED' ? 'Previously owned' : 'Played'}
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="line-clamp-2 text-sm font-medium leading-snug text-ink-100">
            {game.name}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            {game.providers.slice(0, 3).map((provider) => (
              <PlatformBadge key={provider} provider={provider} small />
            ))}
          </div>
        </div>
      </div>
    </Link>
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
}: {
  label: string;
  value: number;
  max: number;
  caption: string;
  tone?: 'accent' | 'violet';
}) {
  // Guard the divide: an all-zero breakdown must render flat, not NaN-wide.
  const percent = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const color = tone === 'violet' ? 'bg-violet' : 'bg-accent';

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink-300">{label}</span>
        <span className="stat-figure text-ink-400">{caption}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-850">
        <div
          className={`h-full rounded-full ${color} transition-[width] duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

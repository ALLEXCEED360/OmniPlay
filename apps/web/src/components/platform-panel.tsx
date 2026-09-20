import type { CSSProperties, ReactNode } from 'react';
import { providerLabel } from '@/lib/format';
import { platformStyle } from '@/lib/platform';

/**
 * A panel that is unmistakably one platform's.
 *
 * A hard edge and a header band in the platform's colour, the platform's
 * name ghosted in outline across the body, and whatever the panel holds
 * beneath. Every surface that reports on one platform — the game page's
 * playtime cards, the achievement page's tallies and standouts — wears
 * this, so a reader who has seen one knows the next at a glance.
 *
 * The watermark is sized to the panel (`cqw`) so it never runs over the
 * figure that sits beside it on a narrow card.
 */
export function PlatformPanel({
  provider,
  index = 0,
  /** Something for the right end of the band — a count, a basis, a note. */
  aside,
  /** Where the watermark sits: beside a lead figure, or low in the body. */
  watermark = 'top',
  className = '',
  children,
}: {
  provider: string;
  index?: number;
  aside?: ReactNode;
  watermark?: 'top' | 'bottom' | 'none';
  className?: string;
  children: ReactNode;
}) {
  const style = platformStyle(provider);
  const label = providerLabel(provider);

  return (
    <div
      style={{ '--i': index, '--bloom': style.bloom } as CSSProperties}
      className={`card anim-rise stagger relative overflow-hidden border-l-4 [container-type:inline-size] ${style.edge} ${className}`}
    >
      {watermark !== 'none' ? (
        <div
          className={`display pointer-events-none absolute right-2 select-none whitespace-nowrap text-[min(3.6rem,10cqw)] leading-none text-transparent opacity-35 [-webkit-text-stroke:1.5px_var(--bloom)] ${
            watermark === 'top' ? 'top-[3.1rem]' : 'bottom-2'
          }`}
          aria-hidden
        >
          {label}
        </div>
      ) : null}

      <div className={`flex items-center justify-between gap-3 px-5 py-2.5 ${style.bar} text-ink-950`}>
        <span className="font-display text-sm font-extrabold uppercase italic tracking-wider">{label}</span>
        {aside ? (
          <span className="font-display text-[11px] font-semibold uppercase tracking-wider opacity-80">
            {aside}
          </span>
        ) : null}
      </div>

      <div className="relative px-5 pb-5 pt-4">{children}</div>
    </div>
  );
}

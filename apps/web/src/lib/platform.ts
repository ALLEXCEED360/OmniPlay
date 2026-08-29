/**
 * One platform, one colour, everywhere.
 *
 * Three pages had each declared their own copy of this map, which is how a
 * colour system quietly stops being one — the moment a fourth platform is
 * added, two screens get it and two do not. Every surface that shows a
 * platform now reads from here.
 *
 * The colours are the ones each platform is actually known by, so a reader who
 * has seen one screen can read the next without a legend. They are *semantic*:
 * changing them changes meaning, not decoration, which is why the palette a
 * design tool suggests cannot simply be dropped over the top of them.
 *
 * The values live in `globals.css` as `--color-psn` / `--color-xbox` /
 * `--color-steam`. This module names the utilities, it does not redefine the
 * colours — a second copy here is how PlatformBadge and every chart ended up
 * disagreeing about what colour Steam is.
 */

export interface PlatformStyle {
  /** Solid fill, for bars, dots and segments. */
  bar: string;
  /** Text colour, for headings and figures belonging to this platform. */
  text: string;
  /** Inset ring, for cards that belong to one platform. */
  ring: string;
  /** Border colour, for a panel edge that should read as this platform. */
  border: string;
  /** Value for `--bloom`, feeding the `bloom` surface utility. */
  bloom: string;
}

const STYLES: Record<string, PlatformStyle> = {
  psn: {
    bar: 'bg-psn',
    text: 'text-psn',
    ring: 'ring-psn/35',
    border: 'border-psn/30',
    bloom: 'var(--color-psn)',
  },
  xbox: {
    bar: 'bg-xbox',
    text: 'text-xbox',
    ring: 'ring-xbox/35',
    border: 'border-xbox/30',
    bloom: 'var(--color-xbox)',
  },
  steam: {
    bar: 'bg-steam',
    text: 'text-steam',
    ring: 'ring-steam/35',
    border: 'border-steam/30',
    bloom: 'var(--color-steam)',
  },
};

const NEUTRAL: PlatformStyle = {
  bar: 'bg-ink-500',
  text: 'text-ink-300',
  ring: 'ring-ink-700',
  border: 'border-ink-700',
  bloom: 'var(--color-ink-500)',
};

/** The style for a provider id, falling back to neutral for anything new. */
export function platformStyle(provider: string): PlatformStyle {
  return STYLES[provider] ?? NEUTRAL;
}

/**
 * A stagger step that keeps a whole list's entrance under `totalMs`.
 *
 * A fixed per-item delay reads well at eight items and becomes a three-second
 * wait at a hundred — which is decoration charging rent on content the reader
 * can already see.
 */
export function staggerStep(count: number, totalMs = 420, maxMs = 45): string {
  if (count <= 1) return '0ms';
  return `${Math.min(maxMs, totalMs / count).toFixed(1)}ms`;
}

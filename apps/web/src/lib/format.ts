/**
 * Display formatting shared across screens.
 *
 * Centralised so "247h" means the same thing on the dashboard, the library
 * card and the game page, and so the honesty rules about uncertain data are
 * applied consistently.
 */

export function formatHours(minutes: number): string {
  if (!minutes || minutes <= 0) return '0h';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours).toLocaleString()}h`;
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return formatter.format(-Math.round(seconds / secondsPerUnit), unit);
    }
  }
  return 'just now';
}

/** Human labels for the provider ids used throughout the data model. */
const PROVIDER_LABELS: Record<string, string> = {
  steam: 'Steam',
  xbox: 'Xbox',
  psn: 'PlayStation',
  epic: 'Epic Games',
  gog: 'GOG',
  manual: 'Added manually',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

export const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Backlog',
  PLAYING: 'Playing',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ABANDONED: 'Abandoned',
  REPLAYING: 'Replaying',
};

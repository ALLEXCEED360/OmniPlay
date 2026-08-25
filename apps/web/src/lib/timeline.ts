/**
 * Shared timeline vocabulary.
 *
 * Deliberately its own module rather than living in `timeline-filters.tsx`.
 * That file is a `'use client'` boundary, and Next only carries *component*
 * references across it — importing a plain array from a client module into a
 * server component yields a proxy, so `EVENT_KINDS.find` blew up at render.
 * Both sides import this instead.
 */

export const EVENT_KINDS = [
  { id: 'played', label: 'Played', dot: 'bg-accent' },
  { id: 'achievements', label: 'Achievements', dot: 'bg-warning' },
  { id: 'acquired', label: 'Added', dot: 'bg-violet' },
  { id: 'completed', label: 'Completed', dot: 'bg-positive' },
] as const;

export type EventKind = (typeof EVENT_KINDS)[number]['id'];

export interface TimelineEntry {
  date: string;
  provider: string | null;
  game: { name: string; slug: string; coverImage: string | null };
  played: boolean;
  achievements: number;
  acquired: boolean;
  completed: boolean;
}

/** Which filter kinds an entry satisfies. */
export function kindsOf(entry: TimelineEntry): EventKind[] {
  const kinds: EventKind[] = [];
  if (entry.played) kinds.push('played');
  if (entry.achievements > 0) kinds.push('achievements');
  if (entry.acquired) kinds.push('acquired');
  if (entry.completed) kinds.push('completed');
  return kinds;
}

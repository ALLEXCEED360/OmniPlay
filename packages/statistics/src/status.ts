/**
 * What state a game is in, and who decided.
 *
 * A status row is only written when the user sets one by hand, so most
 * libraries have none at all. Reading status from that table alone made the
 * Completed filter match nothing and labelled a 100%-complete, 35-hour
 * playthrough "Backlog" — the app ignoring what it plainly knew.
 *
 * This lives in the statistics package rather than beside either caller
 * because the library screen, the game page and the dashboard must all agree.
 * Two implementations of "completed" would eventually disagree, and a filter
 * that contradicts the label on the card is worse than no filter at all.
 */

import type { GameStatus } from '@omniplay/types';

export interface ResolvedStatus {
  status: GameStatus;
  /** False when the user set the status themselves. */
  derived: boolean;
}

/**
 * Resolves a game's status, declared if the user said so and inferred otherwise.
 *
 * Inference is deliberately narrow. Every achievement unlocked is the only
 * signal taken as finishing a game; playtime alone says started, never
 * completed, or an hour's play would mark half a library finished. Abandonment
 * is never inferred, because nothing in the data separates "gave up" from
 * "have not gone back to it yet".
 */
export function resolveGameStatus(input: {
  declared?: string | null | undefined;
  allAchievementsUnlocked: boolean;
  hasPlaytime: boolean;
}): ResolvedStatus {
  // A declared status always wins: the user is a better authority on whether
  // they finished a game than its achievement list is.
  if (input.declared) return { status: input.declared as GameStatus, derived: false };

  if (input.allAchievementsUnlocked) return { status: 'COMPLETED', derived: true };
  if (input.hasPlaytime) return { status: 'PLAYING', derived: true };
  return { status: 'NOT_STARTED', derived: true };
}

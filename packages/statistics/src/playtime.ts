import type { ActivityType, Confidence, GameStatus, ProviderId } from '@omniplay/types';

/**
 * Playtime aggregation.
 *
 * The whole difficulty of this file is one rule: **LIFETIME_TOTAL rows are not
 * additive.**
 *
 * Steam reports "you have played Elden Ring for 247 hours" and overwrites that
 * number on every sync. If a naive sum treats each observation as an event,
 * a user's total climbs every time they press Sync. And if the same game is
 * owned on Steam and Xbox, the two providers' lifetime figures describe
 * *different* playthroughs and genuinely should be added.
 *
 * So the rule is: take the maximum LIFETIME_TOTAL per (game, provider), then
 * sum across providers. Sessions are true events and are summed directly.
 */

export interface ActivityRecord {
  gameId: string;
  provider: ProviderId;
  activityType: ActivityType;
  minutesPlayed: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  confidence: Confidence;
}

export interface PlaytimeBreakdown {
  totalMinutes: number;
  byProvider: Record<ProviderId, number>;
  byGame: Record<string, number>;
}

/** True when this activity type carries a duration we may count. */
function isCountable(record: ActivityRecord): boolean {
  return (
    record.minutesPlayed !== null &&
    record.minutesPlayed > 0 &&
    // ACHIEVEMENT_HISTORY never carries a duration; RECENT_PLAY is a window
    // already contained within the lifetime total, so counting it would
    // double up the last two weeks.
    (record.activityType === 'LIFETIME_TOTAL' ||
      record.activityType === 'SESSION' ||
      record.activityType === 'USER_DECLARED')
  );
}

/**
 * Reduces raw activity rows to per-game, per-provider totals.
 *
 * Exported because both the dashboard and the unified game page need the same
 * arithmetic, and two implementations would eventually disagree.
 */
export function aggregatePlaytime(records: ActivityRecord[]): PlaytimeBreakdown {
  /** (gameId, provider) -> max lifetime figure seen. */
  const lifetime = new Map<string, number>();
  /** (gameId, provider) -> sum of discrete sessions. */
  const sessions = new Map<string, number>();

  for (const record of records) {
    if (!isCountable(record)) continue;
    const key = `${record.gameId} ${record.provider}`;
    const minutes = record.minutesPlayed!;

    if (record.activityType === 'LIFETIME_TOTAL') {
      // Max, not sum: repeated syncs re-observe the same total.
      lifetime.set(key, Math.max(lifetime.get(key) ?? 0, minutes));
    } else {
      sessions.set(key, (sessions.get(key) ?? 0) + minutes);
    }
  }

  const byProvider: Record<ProviderId, number> = {};
  const byGame: Record<string, number> = {};
  let totalMinutes = 0;

  for (const key of new Set([...lifetime.keys(), ...sessions.keys()])) {
    const [gameId, provider] = key.split(' ') as [string, string];
    // A provider reporting both a lifetime total and sessions would be double
    // counting; the lifetime figure is the authoritative one where present.
    const minutes = lifetime.get(key) ?? sessions.get(key) ?? 0;

    byProvider[provider] = (byProvider[provider] ?? 0) + minutes;
    byGame[gameId] = (byGame[gameId] ?? 0) + minutes;
    totalMinutes += minutes;
  }

  return { totalMinutes, byProvider, byGame };
}

/**
 * Playtime attributed to calendar years.
 *
 * Only SESSION rows can be attributed honestly: a Steam lifetime total says
 * nothing about *when* those hours happened. Rather than invent a distribution,
 * unattributable time is reported separately so the UI can say so.
 */
export interface YearlyPlaytime {
  byYear: Record<number, number>;
  /** Minutes we know about but cannot place in time. */
  unattributedMinutes: number;
}

export function playtimeByYear(records: ActivityRecord[]): YearlyPlaytime {
  /**
   * Grouped per (game, provider) before anything is counted, because one
   * provider routinely reports the *same* hours twice in different shapes: a
   * file import writes a LIFETIME_TOTAL and a dated USER_DECLARED row for the
   * same game. Counting both reports more unattributed time than the user has
   * played in total, which is visibly nonsense on the statistics page.
   *
   * Within a group the model is:
   *   - a lifetime total, where present, is the authoritative figure;
   *   - dated events say *when* part of that time happened;
   *   - whatever the dated events do not account for stays unattributed.
   */
  interface Group {
    lifetimeMax: number;
    datedByYear: Map<number, number>;
    undatedMinutes: number;
  }

  const groups = new Map<string, Group>();

  for (const record of records) {
    if (!isCountable(record)) continue;
    const minutes = record.minutesPlayed!;
    const key = `${record.gameId} ${record.provider}`;

    const group = groups.get(key) ?? {
      lifetimeMax: 0,
      datedByYear: new Map<number, number>(),
      undatedMinutes: 0,
    };

    if (record.activityType === 'LIFETIME_TOTAL') {
      // Max, not sum: repeated syncs re-observe the same running total.
      group.lifetimeMax = Math.max(group.lifetimeMax, minutes);
    } else {
      const when = record.startedAt ?? record.endedAt;
      if (when) {
        const year = when.getUTCFullYear();
        group.datedByYear.set(year, (group.datedByYear.get(year) ?? 0) + minutes);
      } else {
        group.undatedMinutes += minutes;
      }
    }

    groups.set(key, group);
  }

  const byYear: Record<number, number> = {};
  let unattributedMinutes = 0;

  for (const group of groups.values()) {
    const datedTotal = [...group.datedByYear.values()].reduce((sum, m) => sum + m, 0);

    // Mirrors aggregatePlaytime: a lifetime figure outranks discrete events
    // from the same provider, which re-state it rather than add to it.
    const authoritative =
      group.lifetimeMax > 0 ? group.lifetimeMax : datedTotal + group.undatedMinutes;

    for (const [year, minutes] of group.datedByYear) {
      byYear[year] = (byYear[year] ?? 0) + minutes;
    }

    // Floored at zero: dated events can exceed a stale lifetime total when the
    // provider's running figure lags its own event log.
    unattributedMinutes += Math.max(0, authoritative - datedTotal);
  }

  return { byYear, unattributedMinutes };
}

/* ------------------------------------------------------------------ *
 * Library-level statistics
 * ------------------------------------------------------------------ */

export interface OwnershipRecord {
  gameId: string;
  provider: ProviderId;
  removedAt: Date | null;
}

export interface StatusRecord {
  gameId: string;
  status: GameStatus;
}

export interface LibraryStats {
  totalGames: number;
  currentlyOwned: number;
  previouslyOwned: number;
  gamesPlayed: number;
  completed: number;
  abandoned: number;
  playing: number;
  backlog: number;
  /** Completed as a share of games actually started, 0..1. */
  completionRate: number;
  gamesByProvider: Record<ProviderId, number>;
}

export function computeLibraryStats(input: {
  ownerships: OwnershipRecord[];
  statuses: StatusRecord[];
  playtimeByGame: Record<string, number>;
}): LibraryStats {
  const owned = new Set<string>();
  const previouslyOwned = new Set<string>();
  const gamesByProvider: Record<ProviderId, number> = {};

  for (const ownership of input.ownerships) {
    if (ownership.removedAt) {
      previouslyOwned.add(ownership.gameId);
    } else {
      owned.add(ownership.gameId);
      gamesByProvider[ownership.provider] = (gamesByProvider[ownership.provider] ?? 0) + 1;
    }
  }

  // A game reacquired after being dropped is currently owned, not previously.
  for (const gameId of owned) previouslyOwned.delete(gameId);

  const statusByGame = new Map(input.statuses.map((s) => [s.gameId, s.status]));
  const allGames = new Set([...owned, ...previouslyOwned, ...statusByGame.keys()]);

  let completed = 0;
  let abandoned = 0;
  let playing = 0;
  for (const status of statusByGame.values()) {
    if (status === 'COMPLETED') completed++;
    else if (status === 'ABANDONED') abandoned++;
    else if (status === 'PLAYING' || status === 'REPLAYING') playing++;
  }

  // "Played" means evidence of play, from either recorded time or a status the
  // user set - not merely owning it.
  const played = new Set<string>();
  for (const [gameId, minutes] of Object.entries(input.playtimeByGame)) {
    if (minutes > 0) played.add(gameId);
  }
  for (const [gameId, status] of statusByGame) {
    if (status !== 'NOT_STARTED') played.add(gameId);
  }

  const backlog = [...allGames].filter((gameId) => !played.has(gameId)).length;

  return {
    totalGames: allGames.size,
    currentlyOwned: owned.size,
    previouslyOwned: previouslyOwned.size,
    gamesPlayed: played.size,
    completed,
    abandoned,
    playing,
    backlog,
    // Denominated on started games, not the whole library: a 3,000-game bundle
    // haul would otherwise make every user look like they finish nothing.
    completionRate: played.size === 0 ? 0 : completed / played.size,
    gamesByProvider,
  };
}

/** Minutes rendered the way the UI shows them. */
export function formatPlaytime(minutes: number): string {
  if (minutes <= 0) return '0h';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours).toLocaleString()}h`;
}

import { Injectable } from '@nestjs/common';
import {
  aggregatePlaytime,
  computeLibraryStats,
  playtimeByYear,
  type ActivityRecord,
} from '@omniplay/statistics';
import { PrismaService } from '../common/prisma.service.js';

/**
 * The dashboard and statistics screens (spec 4.4, 16).
 *
 * All arithmetic lives in @omniplay/statistics; this service only loads rows
 * and hands them over. That split is what lets the awkward rules - lifetime
 * totals not being additive, unattributable time being reported rather than
 * guessed - be unit-tested without a database.
 */
/**
 * One timeline entry: everything that happened to one game on one day.
 *
 * Not one row per event. A session that unlocks ten achievements produces a
 * "played" marker *and* ten unlocks, and listing those separately showed the
 * same evening several times in a row. Rolling them together is what makes the
 * timeline readable, and gives the filters something coherent to act on — an
 * entry appears when any of its enabled kinds is present.
 */
export interface TimelineEntry {
  date: Date;
  provider: string | null;
  game: { name: string; slug: string; coverImage: string | null };
  played: boolean;
  achievements: number;
  acquired: boolean;
  completed: boolean;
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string) {
    const [ownerships, statuses, activities, accounts, lastSync] = await Promise.all([
      this.prisma.client.ownership.findMany({
        where: { userId },
        select: { gameId: true, provider: true, removedAt: true },
      }),
      this.prisma.client.userGameStatus.findMany({
        where: { userId },
        select: { gameId: true, status: true },
      }),
      this.prisma.client.playActivity.findMany({
        where: { userId },
        select: {
          gameId: true,
          provider: true,
          activityType: true,
          minutesPlayed: true,
          startedAt: true,
          endedAt: true,
          confidence: true,
        },
      }),
      this.prisma.client.connectedAccount.findMany({
        where: { userId },
        select: { provider: true, displayName: true, status: true, lastSyncAt: true },
      }),
      this.prisma.client.syncJob.findFirst({
        where: { userId, status: 'SUCCEEDED' },
        orderBy: { finishedAt: 'desc' },
      }),
    ]);

    const records = activities.map(toActivityRecord);
    const playtime = aggregatePlaytime(records);
    const library = computeLibraryStats({
      ownerships,
      statuses: statuses.map((s) => ({ gameId: s.gameId, status: s.status })),
      playtimeByGame: playtime.byGame,
    });

    const currentlyPlaying = await this.currentlyPlaying(userId);
    const mostPlayed = await this.mostPlayed(userId, playtime.byGame, 5);

    return {
      library,
      playtime: {
        totalMinutes: playtime.totalMinutes,
        byProvider: playtime.byProvider,
        ...playtimeByYear(records),
      },
      accounts,
      currentlyPlaying,
      mostPlayed,
      lastSyncAt: lastSync?.finishedAt ?? null,
    };
  }

  /** A year in review (spec 4.4). */
  async year(userId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    const activities = await this.prisma.client.playActivity.findMany({
      where: {
        userId,
        OR: [
          { startedAt: { gte: start, lt: end } },
          { endedAt: { gte: start, lt: end } },
        ],
      },
      select: {
        gameId: true,
        provider: true,
        activityType: true,
        minutesPlayed: true,
        startedAt: true,
        endedAt: true,
        confidence: true,
        game: { select: { name: true, slug: true, coverImage: true, genres: true } },
      },
    });

    // Two different questions, two different filters.
    //
    // *Which games* were played this year: any activity touching the window
    // counts, including a lifetime total whose lastPlayedAt falls inside it —
    // that date is real evidence the game was played.
    //
    // *How many minutes* were played this year: only genuinely dated events.
    // A lifetime total is an undated running figure; counting a game's whole
    // 27 hours toward the year it was last touched claimed 253 of 286 hours
    // happened in 2026 while the overview correctly called all 286 undated.
    const datedActivities = activities.filter(
      (activity) => activity.activityType === 'SESSION' || activity.activityType === 'USER_DECLARED',
    );

    const playtime = aggregatePlaytime(datedActivities.map(toActivityRecord));
    /** Every game with any evidence of activity in the window. */
    const gamesTouched = new Set(activities.map((activity) => activity.gameId));

    const completed = await this.prisma.client.userGameStatus.count({
      where: { userId, status: 'COMPLETED', finishedAt: { gte: start, lt: end } },
    });

    // An achievement unlocked in this year is proof the game was played in it.
    // Counting only PlayActivity reported "0 games played" for a user with
    // hundreds of unlocks, because Steam's playtime carries no date at all.
    const unlockedThisYear = await this.prisma.client.userAchievement.findMany({
      where: {
        userId,
        unlocked: true,
        unlockedAt: { gte: start, lt: end },
      },
      select: {
        achievement: {
          select: { gameId: true, game: { select: { name: true, slug: true, coverImage: true, genres: true } } },
        },
      },
    });

    const gamesFromAchievements = new Map(
      unlockedThisYear.map((row) => [row.achievement.gameId, row.achievement.game]),
    );
    const unlockCount = unlockedThisYear.length;

    const newGames = await this.countNewGames(userId, start, end);

    // Genre ranking, weighted by time rather than by game count, so one
    // 200-hour RPG outranks twelve unplayed platformers.
    // Keyed by game, not by activity row: a game with both a lifetime total
    // and a recent-play row would otherwise contribute its genres twice.
    const gamesById = new Map<string, { name: string; slug: string; coverImage: string | null; genres: string[] }>([
      ...activities.map((a) => [a.gameId, a.game] as const),
      ...gamesFromAchievements,
    ]);

    const genreMinutes = new Map<string, number>();
    for (const [gameId, game] of gamesById) {
      const minutes = playtime.byGame[gameId] ?? 0;
      for (const genre of game.genres) {
        genreMinutes.set(genre, (genreMinutes.get(genre) ?? 0) + minutes);
      }
    }

    const rankedByTime = [...genreMinutes.entries()].filter(([, minutes]) => minutes > 0);

    // Weighting genres by time is the honest default, but a Steam-only library
    // has no *dated* minutes at all — so for a yearly view that measure is
    // always empty. Achievement unlocks are dated, and how many a genre earned
    // is a real signal of engagement. The basis is returned alongside so the
    // UI states which one it is rather than implying hours.
    const useAchievements = rankedByTime.length === 0 && unlockCount > 0;

    let topGenres: Array<{ genre: string; minutes: number; unlocks?: number }>;

    if (useAchievements) {
      const genreUnlocks = new Map<string, number>();
      for (const row of unlockedThisYear) {
        for (const genre of row.achievement.game.genres) {
          genreUnlocks.set(genre, (genreUnlocks.get(genre) ?? 0) + 1);
        }
      }
      topGenres = [...genreUnlocks.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([genre, unlocks]) => ({ genre, minutes: 0, unlocks }));
    } else {
      topGenres = rankedByTime
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([genre, minutes]) => ({ genre, minutes }));
    }

    const genreBasis: 'playtime' | 'achievements' | 'none' = useAchievements
      ? 'achievements'
      : rankedByTime.length > 0
        ? 'playtime'
        : 'none';

    const topGames = Object.entries(playtime.byGame)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([gameId, minutes]) => ({ ...gamesById.get(gameId), minutes }));

    // Union of "had recorded playtime" and "unlocked something": either is
    // evidence the game was played this year.
    const playedThisYear = new Set([
      ...gamesTouched,
      ...gamesFromAchievements.keys(),
    ]);

    return {
      year,
      gamesPlayed: playedThisYear.size,
      totalMinutes: playtime.totalMinutes,
      completed,
      newGames,
      achievementsUnlocked: unlockCount,
      genreBasis,
      topGenres,
      topGames,
      byProvider: playtime.byProvider,
    };
  }

  /**
   * Games genuinely acquired within a window.
   *
   * `firstSeenAt` is when OMNIPLAY met a game, not when the user bought it,
   * and Steam does not report purchase dates at all. Using it naively reported
   * a whole 58-game Steam library as "58 new games" in whichever year the user
   * happened to connect. So a game only counts on `firstSeenAt` when it showed
   * up *after* the provider's initial backfill — meaning a later sync found
   * something the first one did not.
   */
  private async countNewGames(userId: string, start: Date, end: Date): Promise<number> {
    const connections = await this.prisma.client.connectedAccount.findMany({
      where: { userId },
      select: { provider: true, connectedAt: true },
    });

    const knownAcquisitions = await this.prisma.client.ownership.count({
      where: { userId, acquiredAt: { gte: start, lt: end } },
    });

    if (connections.length === 0) return knownAcquisitions;

    // An hour's grace: the first sync runs immediately after connecting, and
    // a large library takes minutes to import.
    const BACKFILL_GRACE_MS = 60 * 60 * 1000;

    const inferred = await Promise.all(
      connections.map((connection) =>
        this.prisma.client.ownership.count({
          where: {
            userId,
            provider: connection.provider,
            acquiredAt: null,
            firstSeenAt: {
              gte: new Date(
                Math.max(start.getTime(), connection.connectedAt.getTime() + BACKFILL_GRACE_MS),
              ),
              lt: end,
            },
          },
        }),
      ),
    );

    return knownAcquisitions + inferred.reduce((sum, count) => sum + count, 0);
  }

  /**
   * The gaming timeline (spec 4.3).
   *
   * Only events we can actually place in time appear. A Steam lifetime total
   * has no date and is deliberately absent rather than pinned to the sync day.
   */
  async timeline(userId: string) {
    const [activities, ownerships, statuses, unlocks] = await Promise.all([
      this.prisma.client.playActivity.findMany({
        where: { userId, OR: [{ startedAt: { not: null } }, { endedAt: { not: null } }] },
        select: {
          gameId: true,
          provider: true,
          activityType: true,
          startedAt: true,
          endedAt: true,
          game: { select: { name: true, slug: true, coverImage: true } },
        },
        orderBy: { endedAt: 'desc' },
        take: 500,
      }),
      this.prisma.client.ownership.findMany({
        where: { userId, acquiredAt: { not: null } },
        select: {
          gameId: true,
          provider: true,
          acquiredAt: true,
          game: { select: { name: true, slug: true, coverImage: true } },
        },
        take: 500,
      }),
      this.prisma.client.userGameStatus.findMany({
        where: { userId, finishedAt: { not: null } },
        select: {
          gameId: true,
          finishedAt: true,
          game: { select: { name: true, slug: true, coverImage: true } },
        },
      }),
      // Achievement unlocks are usually the *only* precisely dated events a
      // library has — Steam's playtime is an undated lifetime total — so
      // without these the timeline of an active player looks nearly empty.
      this.prisma.client.userAchievement.findMany({
        where: { userId, unlocked: true, unlockedAt: { not: null } },
        select: {
          unlockedAt: true,
          achievement: {
            select: {
              provider: true,
              game: { select: { name: true, slug: true, coverImage: true } },
            },
          },
        },
        orderBy: { unlockedAt: 'desc' },
        take: 2000,
      }),
    ]);

    const entries = new Map<string, TimelineEntry>();

    const entryFor = (
      date: Date,
      game: { name: string; slug: string; coverImage: string | null },
      provider: string | null,
    ): TimelineEntry => {
      const key = `${game.slug}|${localDayKey(date)}`;
      const existing = entries.get(key);
      if (existing) {
        // Keep the latest instant of the day, and the first provider seen -
        // a completion has none, so it must not blank out a real one.
        if (date > existing.date) existing.date = date;
        existing.provider ??= provider;
        return existing;
      }

      const created: TimelineEntry = {
        date,
        provider,
        game,
        played: false,
        achievements: 0,
        acquired: false,
        completed: false,
      };
      entries.set(key, created);
      return created;
    };

    for (const activity of activities) {
      const date = activity.endedAt ?? activity.startedAt;
      if (!date) continue;
      // Steam reports both a lifetime total and a two-week window carrying the
      // same lastPlayedAt; a boolean absorbs the repeat for free.
      entryFor(date, activity.game, activity.provider).played = true;
    }

    for (const ownership of ownerships) {
      entryFor(ownership.acquiredAt!, ownership.game, ownership.provider).acquired = true;
    }

    for (const status of statuses) {
      entryFor(status.finishedAt!, status.game, null).completed = true;
    }

    for (const unlock of unlocks) {
      const entry = entryFor(
        unlock.unlockedAt!,
        unlock.achievement.game,
        unlock.achievement.provider,
      );
      entry.achievements += 1;
    }

    const ordered = [...entries.values()].sort((a, b) => b.date.getTime() - a.date.getTime());

    const byYear = new Map<number, TimelineEntry[]>();
    for (const entry of ordered) {
      const year = entry.date.getFullYear();
      const bucket = byYear.get(year) ?? [];
      bucket.push(entry);
      byYear.set(year, bucket);
    }

    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({ year, entries: items }));
  }

  private async currentlyPlaying(userId: string) {
    const statuses = await this.prisma.client.userGameStatus.findMany({
      where: { userId, status: { in: ['PLAYING', 'REPLAYING'] } },
      include: { game: { select: { name: true, slug: true, coverImage: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    });

    if (statuses.length > 0) {
      return statuses.map((s) => ({ ...s.game, status: s.status }));
    }

    // Nothing marked by hand: fall back to whatever was played most recently,
    // so a brand-new account still has a populated dashboard.
    const recent = await this.prisma.client.playActivity.findMany({
      where: { userId, endedAt: { not: null } },
      include: { game: { select: { name: true, slug: true, coverImage: true } } },
      orderBy: { endedAt: 'desc' },
      take: 6,
      distinct: ['gameId'],
    });

    return recent.map((a) => ({ ...a.game, status: 'PLAYING' as const }));
  }

  private async mostPlayed(userId: string, byGame: Record<string, number>, limit: number) {
    const topIds = Object.entries(byGame)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([gameId]) => gameId);

    if (topIds.length === 0) return [];

    const games = await this.prisma.client.game.findMany({
      where: { id: { in: topIds } },
      select: { id: true, name: true, slug: true, coverImage: true },
    });
    const byId = new Map(games.map((g) => [g.id, g]));

    return topIds
      .map((id) => {
        const game = byId.get(id);
        return game ? { ...game, minutes: byGame[id] ?? 0 } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }
}

/**
 * A calendar-day key in the same timezone the dates are rendered in.
 *
 * Deliberately not `toISOString().slice(0, 10)`. Grouping by UTC day while the
 * UI formats in local time splits a single evening's play across two buckets:
 * on a UTC-5 server, unlocks at 00:31Z group as the 6th but display as the
 * 5th, so one session appeared as two entries on the same visible date.
 *
 * Both this and the formatter run in the same process, so they always agree.
 */
function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function toActivityRecord(activity: {
  gameId: string;
  provider: string;
  activityType: string;
  minutesPlayed: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  confidence: string;
}): ActivityRecord {
  return {
    gameId: activity.gameId,
    provider: activity.provider,
    activityType: activity.activityType as ActivityRecord['activityType'],
    minutesPlayed: activity.minutesPlayed,
    startedAt: activity.startedAt,
    endedAt: activity.endedAt,
    confidence: activity.confidence as ActivityRecord['confidence'],
  };
}

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

    const playtime = aggregatePlaytime(activities.map(toActivityRecord));

    const completed = await this.prisma.client.userGameStatus.count({
      where: { userId, status: 'COMPLETED', finishedAt: { gte: start, lt: end } },
    });

    const newGames = await this.prisma.client.ownership.count({
      where: {
        userId,
        // Prefer the real acquisition date and fall back to when OMNIPLAY
        // first saw the game. Counting only `firstSeenAt` would report an
        // imported PlayStation library bought in 2015 as fifteen new games
        // in whichever year the user happened to sign up.
        OR: [
          { acquiredAt: { gte: start, lt: end } },
          { acquiredAt: null, firstSeenAt: { gte: start, lt: end } },
        ],
      },
    });

    // Genre ranking, weighted by time rather than by game count, so one
    // 200-hour RPG outranks twelve unplayed platformers.
    // Keyed by game, not by activity row: a game with both a lifetime total
    // and a recent-play row would otherwise contribute its genres twice.
    const gamesById = new Map(activities.map((a) => [a.gameId, a.game]));

    const genreMinutes = new Map<string, number>();
    for (const [gameId, game] of gamesById) {
      const minutes = playtime.byGame[gameId] ?? 0;
      for (const genre of game.genres) {
        genreMinutes.set(genre, (genreMinutes.get(genre) ?? 0) + minutes);
      }
    }

    const topGenres = [...genreMinutes.entries()]
      // A genre with no recorded time says nothing about how the user plays,
      // and rendering "RPG — 0h" reads as a broken panel rather than as an
      // absence of data. The UI's own empty state is the better answer.
      .filter(([, minutes]) => minutes > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre, minutes]) => ({ genre, minutes }));

    const topGames = Object.entries(playtime.byGame)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([gameId, minutes]) => ({ ...gamesById.get(gameId), minutes }));

    return {
      year,
      gamesPlayed: Object.keys(playtime.byGame).length,
      totalMinutes: playtime.totalMinutes,
      completed,
      newGames,
      topGenres,
      topGames,
      byProvider: playtime.byProvider,
    };
  }

  /**
   * The gaming timeline (spec 4.3).
   *
   * Only events we can actually place in time appear. A Steam lifetime total
   * has no date and is deliberately absent rather than pinned to the sync day.
   */
  async timeline(userId: string) {
    const [activities, ownerships, statuses] = await Promise.all([
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
    ]);

    type TimelineEvent = {
      date: Date;
      type: 'played' | 'acquired' | 'completed';
      provider: string | null;
      game: { name: string; slug: string; coverImage: string | null };
    };

    const events: TimelineEvent[] = [];

    // One provider can report the same play through several activity rows -
    // Steam gives both a lifetime total and a two-week window, and both carry
    // the same `lastPlayedAt`. Without this the timeline lists the game twice
    // on the same day.
    const seen = new Set<string>();
    const remember = (event: TimelineEvent): boolean => {
      const day = event.date.toISOString().slice(0, 10);
      const key = `${event.game.slug}|${event.type}|${event.provider ?? ''}|${day}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };

    for (const activity of activities) {
      const date = activity.endedAt ?? activity.startedAt;
      if (!date) continue;

      const event: TimelineEvent = {
        date,
        type: 'played',
        provider: activity.provider,
        game: activity.game,
      };
      if (remember(event)) events.push(event);
    }
    for (const ownership of ownerships) {
      events.push({
        date: ownership.acquiredAt!,
        type: 'acquired',
        provider: ownership.provider,
        game: ownership.game,
      });
    }
    for (const status of statuses) {
      events.push({
        date: status.finishedAt!,
        type: 'completed',
        provider: null,
        game: status.game,
      });
    }

    events.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Grouped by year, which is how the timeline screen renders.
    const byYear = new Map<number, TimelineEvent[]>();
    for (const event of events) {
      const year = event.date.getUTCFullYear();
      const bucket = byYear.get(year) ?? [];
      bucket.push(event);
      byYear.set(year, bucket);
    }

    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({ year, events: items }));
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

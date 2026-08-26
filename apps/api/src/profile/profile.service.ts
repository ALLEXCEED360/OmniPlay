import { Injectable, NotFoundException } from '@nestjs/common';
import { aggregatePlaytime, computeLibraryStats, type ActivityRecord } from '@omniplay/statistics';
import { PrismaService } from '../common/prisma.service.js';

/**
 * Public profiles (spec 4.7).
 *
 * This is the only unauthenticated read path in the application, so it is
 * written defensively:
 *
 *  - A profile is invisible unless the user opted in (`profilePublic`).
 *  - Only `PUBLIC` collections appear. `UNLISTED` ones are reachable by direct
 *    link but never listed here, and `PRIVATE` ones never leave the account.
 *  - Nothing identifying leaks: no email, no provider account ids, no
 *    connected-account handles, no sync history.
 *
 * The shape is built by explicit `select`, never by spreading a row, so a
 * column added to `User` later cannot silently become public.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async publicProfile(username: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { username: username.toLowerCase() },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        profilePublic: true,
        createdAt: true,
      },
    });

    // A private profile is reported as "not found" rather than "private", so
    // the endpoint cannot be used to enumerate which usernames exist.
    if (!user || !user.profilePublic) {
      throw new NotFoundException('Profile not found.');
    }

    const [ownerships, statuses, activities, collections, accounts] = await Promise.all([
      this.prisma.client.ownership.findMany({
        where: { userId: user.id },
        select: { gameId: true, provider: true, removedAt: true },
      }),
      this.prisma.client.userGameStatus.findMany({
        where: { userId: user.id },
        select: { gameId: true, status: true },
      }),
      this.prisma.client.playActivity.findMany({
        where: { userId: user.id },
        select: {
          gameId: true,
          dedupeKey: true,
          provider: true,
          activityType: true,
          minutesPlayed: true,
          startedAt: true,
          endedAt: true,
          confidence: true,
        },
      }),
      this.prisma.client.collection.findMany({
        where: { userId: user.id, visibility: 'PUBLIC' },
        include: {
          games: {
            take: 4,
            orderBy: { position: 'asc' },
            include: { game: { select: { coverImage: true } } },
          },
          _count: { select: { games: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      // Which platforms, never which accounts: the gamertag is not ours to
      // publish just because the user made their OMNIPLAY profile public.
      this.prisma.client.connectedAccount.findMany({
        where: { userId: user.id },
        select: { provider: true },
      }),
    ]);

    const playtime = aggregatePlaytime(activities.map(toActivityRecord));
    const library = computeLibraryStats({
      ownerships,
      statuses,
      playtimeByGame: playtime.byGame,
    });

    const favourites = await this.topGames(playtime.byGame, 6);

    return {
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      memberSince: user.createdAt,
      stats: {
        totalGames: library.totalGames,
        completed: library.completed,
        totalMinutes: playtime.totalMinutes,
        gamesPlayed: library.gamesPlayed,
        completionRate: library.completionRate,
      },
      platforms: [...new Set(accounts.map((a) => a.provider))].map((provider) => ({
        provider,
        gameCount: library.gamesByProvider[provider] ?? 0,
      })),
      favourites,
      collections: collections.map((collection) => ({
        name: collection.name,
        slug: collection.slug,
        description: collection.description,
        gameCount: collection._count.games,
        covers: collection.games.map((entry) => entry.game.coverImage).filter(Boolean),
      })),
    };
  }

  /** Updates the viewer's own public-facing details. */
  async updateOwn(
    userId: string,
    input: { displayName?: string; bio?: string | null; profilePublic?: boolean },
  ) {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
        ...(input.bio !== undefined ? { bio: input.bio?.trim() || null } : {}),
        ...(input.profilePublic !== undefined ? { profilePublic: input.profilePublic } : {}),
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        avatar: true,
        profilePublic: true,
      },
    });
  }

  private async topGames(byGame: Record<string, number>, limit: number) {
    const topIds = Object.entries(byGame)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([gameId]) => gameId);

    if (topIds.length === 0) return [];

    const games = await this.prisma.client.game.findMany({
      where: { id: { in: topIds } },
      select: { id: true, name: true, slug: true, coverImage: true },
    });
    const byId = new Map(games.map((game) => [game.id, game]));

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
  dedupeKey?: string | null;
  provider: string;
  activityType: string;
  minutesPlayed: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  confidence: string;
}): ActivityRecord {
  return {
    gameId: activity.gameId,
    // Carried so two editions of one game are not collapsed to the larger.
    dedupeKey: activity.dedupeKey ?? null,
    provider: activity.provider,
    activityType: activity.activityType as ActivityRecord['activityType'],
    minutesPlayed: activity.minutesPlayed,
    startedAt: activity.startedAt,
    endedAt: activity.endedAt,
    confidence: activity.confidence as ActivityRecord['confidence'],
  };
}

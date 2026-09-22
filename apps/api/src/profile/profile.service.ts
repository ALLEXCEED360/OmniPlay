import { Injectable, NotFoundException } from '@nestjs/common';
import { aggregatePlaytime, computeLibraryStats, type ActivityRecord } from '@omniplay/statistics';
import { PrismaService } from '../common/prisma.service.js';
import { fullyUnlockedGameIds } from '../common/completion.js';
import { AchievementsService } from '../achievements/achievements.service.js';
import { StatsService } from '../stats/stats.service.js';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly achievements: AchievementsService,
    private readonly stats: StatsService,
  ) {}

  /**
   * `viewerId` is the signed-in reader, if any. The owner sees their own
   * page whether or not it is public; everyone else needs the opt-in.
   */
  async publicProfile(username: string, viewerId: string | null = null) {
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
    const isOwner = user !== null && user.id === viewerId;
    if (!user || (!user.profilePublic && !isOwner)) {
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
      // The shared copy of this profile has to agree with the owner's own
      // dashboard. Omitting this counted only hand-set statuses and published
      // "0 completed" for a library with sixteen finished games.
      fullyUnlockedGames: await fullyUnlockedGameIds(this.prisma.client, user.id),
    });

    // The trophy-room figures, the top of the genre table and the span of
    // dated play: what makes the page a portrait rather than a count. All
    // of it is about games, none of it about accounts, so it is as safe to
    // publish as the totals above.
    const [favourites, unlocks, rarest, tiers, genres, firstPlay] = await Promise.all([
      this.topGames(playtime.byGame, 6),
      this.stats.unlockSummary(user.id),
      this.achievements.rarestUnlocks(user.id, 3),
      this.achievements.trophyTiers(user.id),
      this.stats.genreBreakdown(user.id, 12),
      this.prisma.client.playActivity.aggregate({
        where: { userId: user.id, startedAt: { not: null } },
        _min: { startedAt: true },
      }),
    ]);

    // The earliest thing that can be dated: a play session or an unlock,
    // whichever came first. Steam dates neither, so this can be null for a
    // library that is all Steam.
    const dated = [firstPlay._min.startedAt, unlocks.first].filter(
      (date): date is Date => date !== null,
    );
    const firstPlayedAt = dated.length > 0 ? new Date(Math.min(...dated.map((d) => d.getTime()))) : null;

    return {
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      memberSince: user.createdAt,
      // So the owner's own view can say "only you can see this" instead of
      // letting them believe a link would work for anyone.
      isPublic: user.profilePublic,
      isOwner,
      stats: {
        totalGames: library.totalGames,
        completed: library.completed,
        totalMinutes: playtime.totalMinutes,
        gamesPlayed: library.gamesPlayed,
        completionRate: library.completionRate,
        achievementsUnlocked: unlocks.unlocked,
        platinums: tiers.platinum,
        firstPlayedAt,
      },
      rarest,
      genres,
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

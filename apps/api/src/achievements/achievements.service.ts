import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

/**
 * Achievements (spec 15).
 *
 * Worth its own screen for a reason the rest of the app makes obvious: an
 * achievement unlock is the only thing most providers give us that is both a
 * real event *and* carries a trustworthy date. Steam reports playtime as an
 * undated lifetime total, so a library can hold hundreds of hours and still
 * produce an empty timeline — while the unlocks underneath it know exactly
 * when they happened.
 *
 * Cross-provider totals are deliberately absent. Gamerscore and Steam's
 * count-of-achievements are different units, and adding them would produce a
 * number that means nothing (spec 2.2).
 */
@Injectable()
export class AchievementsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string) {
    const [detailUnlocked, tracked, recent, byGame] = await Promise.all([
      this.prisma.client.userAchievement.count({ where: { userId, unlocked: true } }),
      // Only achievements for games the user actually has: the table also holds
      // definitions synced for other people's libraries.
      this.prisma.client.achievement.count({
        where: { game: { ownerships: { some: { userId } } } },
      }),
      this.recentUnlocks(userId, 12),
      this.perGame(userId),
    ]);

    const perfect = byGame.filter(
      (game) => game.totalKnown && game.total > 0 && game.unlocked === game.total,
    );
    const started = byGame.filter((game) => game.unlocked > 0);
    const awaitingDetail = byGame.filter((game) => !game.detailed).length;

    // Points are only summed within a provider that actually uses them; Steam
    // reports none, so this is usually zero until Xbox is connected.
    const points = byGame.reduce((sum, game) => sum + game.points, 0);

    // Summary-only games contribute their reported count, so the headline
    // reflects the whole library rather than only the swept part.
    const unlocked = byGame.reduce(
      (sum, game) => sum + (game.detailed ? 0 : game.unlocked),
      detailUnlocked,
    );

    return {
      unlocked,
      tracked,
      completionRate: tracked === 0 ? 0 : unlocked / tracked,
      gamesWithAchievements: byGame.length,
      gamesStarted: started.length,
      perfectGames: perfect.length,
      /** Games showing the provider's summary while detail is still pending. */
      awaitingDetail,
      points,
      recent,
      byGame,
      byYear: await this.unlocksByYear(userId),
    };
  }

  /** Most recent unlocks, for the "what have I been playing" strip. */
  async recentUnlocks(userId: string, limit: number) {
    const rows = await this.prisma.client.userAchievement.findMany({
      where: { userId, unlocked: true, unlockedAt: { not: null } },
      orderBy: { unlockedAt: 'desc' },
      take: limit,
      select: {
        unlockedAt: true,
        achievement: {
          select: {
            name: true,
            description: true,
            iconUrl: true,
            points: true,
            provider: true,
            game: { select: { name: true, slug: true, coverImage: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      name: row.achievement.name,
      description: row.achievement.description,
      iconUrl: row.achievement.iconUrl,
      points: row.achievement.points,
      provider: row.achievement.provider,
      unlockedAt: row.unlockedAt,
      game: row.achievement.game,
    }));
  }

  /**
   * Per-game progress, most complete first.
   *
   * Two sources, merged. Individual achievement rows are authoritative where
   * we have them, but they cost a request per game and arrive slowly under a
   * rate limit. Providers that hand over a bulk summary — Xbox does, with the
   * title list — let every game show progress immediately.
   *
   * `detailed` marks which is which, so the UI can be honest that one row is
   * counted from real achievements and another is the provider's own figure.
   */
  async perGame(userId: string) {
    const [detailed, summaries] = await Promise.all([
      this.perGameDetailed(userId),
      this.prisma.client.gameAchievementSummary.findMany({
        where: { userId },
        select: {
          gameId: true,
          provider: true,
          unlocked: true,
          total: true,
          points: true,
          totalPoints: true,
          game: { select: { name: true, slug: true, coverImage: true } },
        },
      }),
    ]);

    const byKey = new Map(detailed.map((row) => [`${row.gameId}:${row.provider}`, row]));

    for (const summary of summaries) {
      const key = `${summary.gameId}:${summary.provider}`;
      // Detailed rows win: they are counted from achievements we actually
      // hold, and they carry unlock dates the summary cannot.
      if (byKey.has(key)) continue;

      byKey.set(key, {
        gameId: summary.gameId,
        name: summary.game.name,
        slug: summary.game.slug,
        coverImage: summary.game.coverImage,
        provider: summary.provider,
        // Null total renders as "6 unlocked" rather than a false "6 / 0".
        total: summary.total ?? 0,
        unlocked: summary.unlocked,
        points: summary.points ?? 0,
        totalPoints: summary.totalPoints ?? null,
        lastUnlockedAt: null,
        detailed: false,
        totalKnown: summary.total !== null,
      });
    }

    return [...byKey.values()].sort(
      (a, b) => b.unlocked - a.unlocked || b.total - a.total,
    );
  }

  /** Games where we hold the individual achievement rows. */
  private async perGameDetailed(userId: string) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{
        gameId: string;
        name: string;
        slug: string;
        coverImage: string | null;
        provider: string;
        total: bigint;
        unlocked: bigint;
        points: bigint;
        lastUnlockedAt: Date | null;
      }>
    >`
      SELECT g.id            AS "gameId",
             g.name,
             g.slug,
             g."coverImage",
             a.provider,
             count(*)                                              AS total,
             count(*) FILTER (WHERE ua.unlocked)                   AS unlocked,
             COALESCE(sum(a.points) FILTER (WHERE ua.unlocked), 0) AS points,
             max(ua."unlockedAt")                                  AS "lastUnlockedAt"
      FROM "Achievement" a
      JOIN "Game" g ON g.id = a."gameId"
      LEFT JOIN "UserAchievement" ua
             ON ua."achievementId" = a.id AND ua."userId" = ${userId}
      WHERE EXISTS (
        SELECT 1 FROM "Ownership" o WHERE o."gameId" = g.id AND o."userId" = ${userId}
      )
      GROUP BY g.id, g.name, g.slug, g."coverImage", a.provider
      ORDER BY unlocked DESC, total DESC
    `;

    return rows.map((row) => ({
      gameId: row.gameId,
      name: row.name,
      slug: row.slug,
      coverImage: row.coverImage,
      provider: row.provider,
      total: Number(row.total),
      unlocked: Number(row.unlocked),
      points: Number(row.points),
      totalPoints: null as number | null,
      lastUnlockedAt: row.lastUnlockedAt,
      detailed: true,
      totalKnown: true,
    }));
  }

  /**
   * Unlocks per calendar year.
   *
   * The one genuinely dated signal most libraries have — see the class comment.
   */
  async unlocksByYear(userId: string) {
    const rows = await this.prisma.client.$queryRaw<Array<{ year: number; count: bigint }>>`
      SELECT EXTRACT(YEAR FROM "unlockedAt")::int AS year, count(*) AS count
      FROM "UserAchievement"
      WHERE "userId" = ${userId} AND unlocked = true AND "unlockedAt" IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((row) => ({ year: row.year, count: Number(row.count) }));
  }

  /** Every achievement for one game, for the game page's detail view. */
  async forGame(userId: string, slug: string) {
    const rows = await this.prisma.client.achievement.findMany({
      where: { game: { slug } },
      orderBy: [{ points: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        iconUrl: true,
        points: true,
        hidden: true,
        provider: true,
        globalUnlockRate: true,
        unlocks: { where: { userId }, select: { unlocked: true, unlockedAt: true } },
      },
    });

    return rows.map((row) => {
      const mine = row.unlocks[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        iconUrl: row.iconUrl,
        points: row.points,
        hidden: row.hidden,
        provider: row.provider,
        globalUnlockRate: row.globalUnlockRate,
        unlocked: mine?.unlocked ?? false,
        unlockedAt: mine?.unlockedAt ?? null,
      };
    });
  }
}

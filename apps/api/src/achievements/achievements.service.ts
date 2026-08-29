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

  /**
   * The rarest things this player has done.
   *
   * The most interesting figure an achievement dataset holds, and the page
   * showed none of it. Only PlayStation reports a global earn rate — Steam
   * publishes one through an API we do not call, and Xbox none at all — so
   * this is labelled as PlayStation rather than presented as a whole-library
   * ranking it cannot be.
   */
  async rarestUnlocks(userId: string, limit = 6) {
    const rows = await this.prisma.client.userAchievement.findMany({
      where: {
        userId,
        unlocked: true,
        achievement: { globalUnlockRate: { not: null } },
      },
      orderBy: { achievement: { globalUnlockRate: 'asc' } },
      take: limit,
      select: {
        unlockedAt: true,
        achievement: {
          select: {
            name: true,
            description: true,
            iconUrl: true,
            provider: true,
            globalUnlockRate: true,
            game: { select: { name: true, slug: true, coverImage: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      name: row.achievement.name,
      description: row.achievement.description,
      iconUrl: row.achievement.iconUrl,
      provider: row.achievement.provider,
      rate: row.achievement.globalUnlockRate,
      unlockedAt: row.unlockedAt,
      game: row.achievement.game,
    }));
  }

  /**
   * PlayStation trophy tiers.
   *
   * Read from the weights the adapter assigns, which are the community's
   * conventional values rather than anything Sony publishes. Kept separate
   * from Xbox gamerscore on purpose: the two are different units and adding
   * them produces a number that means nothing (spec 2.2).
   */
  async trophyTiers(userId: string) {
    const rows = await this.prisma.client.$queryRaw<Array<{ points: number; count: bigint }>>`
      SELECT a.points, count(*) AS count
      FROM "Achievement" a
      JOIN "UserAchievement" ua ON ua."achievementId" = a.id
      WHERE ua."userId" = ${userId} AND ua.unlocked AND a.provider = 'psn' AND a.points IS NOT NULL
      GROUP BY a.points
    `;

    const byPoints = new Map(rows.map((row) => [row.points, Number(row.count)]));
    return {
      platinum: byPoints.get(180) ?? 0,
      gold: byPoints.get(90) ?? 0,
      silver: byPoints.get(30) ?? 0,
      bronze: byPoints.get(15) ?? 0,
    };
  }

  /**
   * Each platform's own achievement record, side by side.
   *
   * The page previously led with rarity and trophy tiers, which only
   * PlayStation reports — so a library holding 517 Steam unlocks and 198 Xbox
   * ones saw neither platform mentioned. What all three genuinely share is
   * counts, dates and per-game completion, so that is what the comparison is
   * built from. The signature figure each platform *does* report is carried
   * alongside rather than instead: gamerscore for Xbox, trophy points for
   * PlayStation, neither for Steam, and they are never added together.
   */
  async byProvider(userId: string) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{
        provider: string;
        unlocked: bigint;
        tracked: bigint;
        games: bigint;
        perfect: bigint;
        points: bigint;
      }>
    >`
      WITH per_game AS (
        SELECT a.provider,
               a."gameId",
               count(*)                                              AS total,
               count(*) FILTER (WHERE ua.unlocked)                    AS got,
               COALESCE(sum(a.points) FILTER (WHERE ua.unlocked), 0)  AS pts
        FROM "Achievement" a
        LEFT JOIN "UserAchievement" ua
               ON ua."achievementId" = a.id AND ua."userId" = ${userId}
        WHERE EXISTS (
          SELECT 1 FROM "Ownership" o WHERE o."gameId" = a."gameId" AND o."userId" = ${userId}
        ) OR EXISTS (
          SELECT 1 FROM "PlayActivity" p WHERE p."gameId" = a."gameId" AND p."userId" = ${userId}
        )
        GROUP BY a.provider, a."gameId"
      )
      SELECT provider,
             sum(got)                                           AS unlocked,
             -- Only games actually started: a denominator that counts every
             -- achievement of every unplayed game makes a serious player look
             -- like a casual one.
             COALESCE(sum(total) FILTER (WHERE got > 0), 0)      AS tracked,
             count(*) FILTER (WHERE got > 0)                     AS games,
             count(*) FILTER (WHERE got = total AND total > 0)   AS perfect,
             sum(pts)                                            AS points
      FROM per_game
      GROUP BY provider
      HAVING sum(got) > 0
      ORDER BY sum(got) DESC
    `;

    return rows.map((row) => ({
      provider: row.provider,
      unlocked: Number(row.unlocked),
      tracked: Number(row.tracked),
      games: Number(row.games),
      perfect: Number(row.perfect),
      // Steam reports no per-achievement score at all, so zero here means
      // "not reported" rather than "none earned".
      points: Number(row.points) || null,
    }));
  }

  /**
   * Unlocks per year, split by platform.
   *
   * Split because the split is the story: this library is pure PlayStation
   * from 2016 to 2024, Steam arrives in 2025, and 2026 is Steam and Xbox with
   * no PlayStation at all. A single-colour bar per year hides a decade of
   * moving between platforms.
   */
  async unlocksByYearAndProvider(userId: string) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ year: number; provider: string; count: bigint }>
    >`
      SELECT EXTRACT(YEAR FROM ua."unlockedAt")::int AS year, a.provider, count(*) AS count
      FROM "UserAchievement" ua
      JOIN "Achievement" a ON a.id = ua."achievementId"
      WHERE ua."userId" = ${userId} AND ua.unlocked AND ua."unlockedAt" IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1
    `;

    const byYear = new Map<number, Record<string, number>>();
    for (const row of rows) {
      const bucket = byYear.get(row.year) ?? {};
      bucket[row.provider] = Number(row.count);
      byYear.set(row.year, bucket);
    }

    return [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, providers]) => ({
        year,
        providers,
        total: Object.values(providers).reduce((sum, n) => sum + n, 0),
      }));
  }

  /**
   * Each platform's standout unlocks, on whatever measure it reports.
   *
   * A single global "rarest" list is always PlayStation: its trophies really
   * are rarer, so Steam never places even though Steam publishes rarity too.
   * Ranking within each platform gives all three a column, and each is ranked
   * by what it actually reports — rarity for PlayStation and Steam, gamerscore
   * for Xbox, which publishes no rarity at all.
   */
  async platformHighlights(userId: string, perPlatform = 4) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{
        provider: string;
        name: string;
        iconUrl: string | null;
        rate: number | null;
        points: number | null;
        gameName: string;
        gameSlug: string;
        coverImage: string | null;
      }>
    >`
      WITH ranked AS (
        SELECT a.provider,
               a.name,
               a."iconUrl",
               a."globalUnlockRate" AS rate,
               a.points,
               g.name AS "gameName",
               g.slug AS "gameSlug",
               g."coverImage",
               ROW_NUMBER() OVER (
                 PARTITION BY a.provider
                 -- Rarity where it exists, gamerscore where it does not.
                 ORDER BY a."globalUnlockRate" ASC NULLS LAST, a.points DESC NULLS LAST
               ) AS rank
        FROM "Achievement" a
        JOIN "UserAchievement" ua ON ua."achievementId" = a.id
        JOIN "Game" g ON g.id = a."gameId"
        WHERE ua."userId" = ${userId} AND ua.unlocked
      )
      SELECT provider, name, "iconUrl", rate, points, "gameName", "gameSlug", "coverImage"
      FROM ranked
      WHERE rank <= ${perPlatform}
      ORDER BY provider, rank
    `;

    const byProvider = new Map<
      string,
      { provider: string; basis: 'rarity' | 'points'; items: typeof rows }
    >();

    for (const row of rows) {
      const existing = byProvider.get(row.provider);
      if (existing) {
        existing.items.push(row);
        continue;
      }
      byProvider.set(row.provider, {
        provider: row.provider,
        // Decided by what the platform supplied, not by provider name.
        basis: row.rate !== null ? 'rarity' : 'points',
        items: [row],
      });
    }

    return [...byProvider.values()];
  }

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

    const [rarest, tiers, providers, yearsByProvider, highlights] = await Promise.all([
      this.rarestUnlocks(userId),
      this.trophyTiers(userId),
      this.byProvider(userId),
      this.unlocksByYearAndProvider(userId),
      this.platformHighlights(userId),
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
      providers,
      yearsByProvider,
      highlights,
      rarest,
      tiers,
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

import { Injectable } from '@nestjs/common';
import {
  aggregatePlaytime,
  computeLibraryStats,
  playtimeByYear,
  type ActivityRecord,
} from '@omniplay/statistics';
import { PrismaService } from '../common/prisma.service.js';
import { fullyUnlockedGameIds } from '../common/completion.js';

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
  /**
   * The first time this game was ever launched.
   *
   * A genuinely dated fact where a provider reports one — PlayStation attaches
   * `firstPlayedDateTime` to every title. It is the closest thing the data has
   * to "when did this game enter my life", and unlike acquisition it does not
   * require a purchase date no platform API supplies.
   */
  firstPlayed: boolean;
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
          dedupeKey: true,
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
      // Without this the dashboard counts only hand-set statuses, of which
      // most libraries have none, and reports zero completed games while the
      // library screen finds them.
      fullyUnlockedGames: await fullyUnlockedGameIds(this.prisma.client, userId),
    });

    const [currentlyPlaying, activityByYear, crossPlatform, unlocks] = await Promise.all([
      this.currentlyPlaying(userId),
      this.activityByYear(userId),
      this.crossPlatformGames(userId),
      this.unlockSummary(userId),
    ]);
    const genres = await this.genreBreakdown(userId);
    const mostPlayed = await this.mostPlayed(userId, playtime.byGame, 5);

    return {
      library,
      playtime: {
        totalMinutes: playtime.totalMinutes,
        byProvider: playtime.byProvider,
        ...playtimeByYear(records),
      },
      accounts,
      activityByYear,
      crossPlatform,
      unlocks,
      genres,
      currentlyPlaying,
      mostPlayed,
      lastSyncAt: lastSync?.finishedAt ?? null,
    };
  }

  /**
   * Every game in the library, ranked by recorded playtime.
   *
   * The dashboard shows a top five, which is a teaser rather than an answer —
   * "how long have I played everything" is a question about the whole library,
   * and 230 games is small enough to rank in one pass.
   *
   * Games with no recorded time are included rather than dropped. Most of them
   * are not unplayed: Xbox reports hours only for titles that answer a separate
   * stats call, so an absent figure usually means "not reported" rather than
   * "never launched". Omitting them would quietly assert the opposite.
   */
  async playtimeRanking(userId: string) {
    const activities = await this.prisma.client.playActivity.findMany({
      where: { userId },
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
    });

    const playtime = aggregatePlaytime(activities.map(toActivityRecord));

    // The library is ownership *or* activity, matching what the library screen
    // lists — a game played on Xbox without an entitlement record still counts.
    const games = await this.prisma.client.game.findMany({
      where: {
        mergedIntoId: null,
        OR: [{ ownerships: { some: { userId } } }, { activities: { some: { userId } } }],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        coverImage: true,
        ownerships: { where: { userId }, select: { provider: true } },
        activities: { where: { userId }, select: { provider: true } },
      },
    });

    const ranked = games
      .map((game) => ({
        id: game.id,
        name: game.name,
        slug: game.slug,
        coverImage: game.coverImage,
        minutes: playtime.byGame[game.id] ?? 0,
        providers: [
          ...new Set([
            ...game.ownerships.map((o) => o.provider),
            ...game.activities.map((a) => a.provider),
          ]),
        ].sort(),
      }))
      .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));

    return {
      totalMinutes: playtime.totalMinutes,
      byProvider: playtime.byProvider,
      games: ranked,
      withoutPlaytime: ranked.filter((game) => game.minutes === 0).length,
    };
  }

  /**
   * Dated activity per calendar year.
   *
   * The dashboard's "Activity by year" panel used to chart *hours*, and stood
   * empty because 93% of this library's playtime carries no date — Steam
   * reports an undated lifetime total, and a provider's lifetime figure says
   * when a game was first and last played but not how the hours fell between.
   * Splitting them would be inventing a distribution.
   *
   * So the panel charts what is genuinely dated: days with activity, unlocks,
   * and games started. Its title was always "activity", not "playtime".
   */
  async activityByYear(userId: string) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ year: number; activeDays: bigint; games: bigint; unlocks: bigint; started: bigint }>
    >`
      WITH dated AS (
        SELECT date_trunc('year', ua."unlockedAt") AS y,
               ua."unlockedAt"::date AS d,
               a."gameId" AS game,
               1 AS unlock, 0 AS started
        FROM "UserAchievement" ua
        JOIN "Achievement" a ON a.id = ua."achievementId"
        WHERE ua."userId" = ${userId} AND ua.unlocked AND ua."unlockedAt" IS NOT NULL
        UNION ALL
        SELECT date_trunc('year', p."startedAt"), p."startedAt"::date, p."gameId", 0, 1
        FROM "PlayActivity" p
        WHERE p."userId" = ${userId} AND p."startedAt" IS NOT NULL
          AND p."activityType" <> 'RECENT_PLAY'
        UNION ALL
        SELECT date_trunc('year', p."endedAt"), p."endedAt"::date, p."gameId", 0, 0
        FROM "PlayActivity" p
        WHERE p."userId" = ${userId} AND p."endedAt" IS NOT NULL
      )
      SELECT EXTRACT(YEAR FROM y)::int AS "year",
             count(DISTINCT d)         AS "activeDays",
             count(DISTINCT game)      AS "games",
             sum(unlock)               AS "unlocks",
             sum(started)              AS "started"
      FROM dated
      GROUP BY y
      ORDER BY y
    `;

    // Completions are dated at the final unlock, matching every other screen.
    const finishedByYear = new Map<number, number>();
    for (const [, finished] of await this.inferredCompletions(userId)) {
      const year = finished.at.getFullYear();
      finishedByYear.set(year, (finishedByYear.get(year) ?? 0) + 1);
    }

    return rows.map((row) => ({
      year: row.year,
      activeDays: Number(row.activeDays),
      games: Number(row.games),
      unlocks: Number(row.unlocks),
      started: Number(row.started),
      finished: finishedByYear.get(row.year) ?? 0,
    }));
  }

  /**
   * Games this library holds on more than one platform.
   *
   * The single thing no storefront can tell you, and the reason this app
   * exists — Apex Legends is 633 hours only once PlayStation and Steam are
   * added together, and neither platform will ever show you that number. The
   * dashboard never mentioned it.
   *
   * Built from ownership *and* activity, matching the library screen: a game
   * played on Xbox without an entitlement record still counts as being on Xbox.
   */
  async crossPlatformGames(userId: string, limit = 6) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        coverImage: string | null;
        providers: string[];
        minutes: bigint | null;
      }>
    >`
      WITH mine AS (
        SELECT "gameId", provider FROM "Ownership" WHERE "userId" = ${userId}
        UNION
        SELECT "gameId", provider FROM "PlayActivity" WHERE "userId" = ${userId}
      )
      SELECT g.id,
             g.name,
             g.slug,
             g."coverImage",
             array_agg(DISTINCT m.provider ORDER BY m.provider) AS providers,
             (
               SELECT sum(p."minutesPlayed")
               FROM "PlayActivity" p
               WHERE p."gameId" = g.id
                 AND p."userId" = ${userId}
                 AND p."activityType" = 'LIFETIME_TOTAL'
             ) AS minutes
      FROM mine m
      JOIN "Game" g ON g.id = m."gameId"
      WHERE g."mergedIntoId" IS NULL
      GROUP BY g.id, g.name, g.slug, g."coverImage"
      HAVING count(DISTINCT m.provider) > 1
      ORDER BY minutes DESC NULLS LAST
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      name: row.name,
      slug: row.slug,
      coverImage: row.coverImage,
      providers: row.providers,
      minutes: Number(row.minutes ?? 0),
    }));
  }

  /** Everything the dashboard needs about achievements, in one figure. */
  async unlockSummary(userId: string) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ unlocked: bigint; years: bigint; first: Date | null; last: Date | null }>
    >`
      SELECT count(*)                                   AS unlocked,
             count(DISTINCT date_trunc('year', ua."unlockedAt")) AS years,
             min(ua."unlockedAt")                       AS first,
             max(ua."unlockedAt")                       AS last
      FROM "UserAchievement" ua
      WHERE ua."userId" = ${userId} AND ua.unlocked AND ua."unlockedAt" IS NOT NULL
    `;

    const row = rows[0];
    return {
      unlocked: Number(row?.unlocked ?? 0),
      years: Number(row?.years ?? 0),
      first: row?.first ?? null,
      last: row?.last ?? null,
    };
  }

  /**
   * Genres across the whole library, weighted by hours.
   *
   * The Gaming DNA panel previously ranked the *current year's* genres by
   * unlocks, because year-scoped playtime does not exist — which made a
   * decade-long library look like whatever happened to be played since
   * January. Ranked over everything and weighted by time, one 200-hour RPG
   * outranks twelve unplayed platformers, which is the point of the panel.
   */
  async genreBreakdown(userId: string, limit = 8) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ genre: string; games: bigint; minutes: bigint | null }>
    >`
      WITH mine AS (
        SELECT DISTINCT "gameId" FROM "Ownership" WHERE "userId" = ${userId}
        UNION
        SELECT DISTINCT "gameId" FROM "PlayActivity" WHERE "userId" = ${userId}
      ),
      per_game AS (
        SELECT g.id,
               g.genres,
               (
                 SELECT sum(p."minutesPlayed")
                 FROM "PlayActivity" p
                 WHERE p."gameId" = g.id
                   AND p."userId" = ${userId}
                   AND p."activityType" = 'LIFETIME_TOTAL'
               ) AS minutes
        FROM mine m
        JOIN "Game" g ON g.id = m."gameId"
        WHERE g."mergedIntoId" IS NULL AND array_length(g.genres, 1) > 0
      )
      SELECT unnest(genres) AS genre,
             count(*)       AS games,
             sum(COALESCE(minutes, 0)) AS minutes
      FROM per_game
      GROUP BY 1
      ORDER BY minutes DESC NULLS LAST, games DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      genre: row.genre,
      games: Number(row.games),
      minutes: Number(row.minutes ?? 0),
    }));
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
        dedupeKey: true,
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

    // Completions the user declared, plus the ones the achievements prove.
    //
    // Counting only declared statuses reported zero for every year, because a
    // UserGameStatus row is written solely when someone sets one by hand and
    // most libraries have none at all. The library screen, the dashboard and
    // the timeline all infer completion from a fully unlocked achievement set,
    // and this has to agree with them or the same year reads two ways on two
    // pages. The date is the final unlock: a real recorded instant.
    const [declaredCompletions, inferredCompletions] = await Promise.all([
      this.prisma.client.userGameStatus.findMany({
        where: { userId, status: 'COMPLETED', finishedAt: { gte: start, lt: end } },
        select: { gameId: true },
      }),
      this.inferredCompletions(userId),
    ]);

    const completedGames = new Set(declaredCompletions.map((row) => row.gameId));
    for (const [gameId, finished] of inferredCompletions) {
      if (finished.at >= start && finished.at < end) completedGames.add(gameId);
    }
    const completed = completedGames.size;

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

    // The year's most active games.
    //
    // Ranked by unlocks earned *in* the year where playtime cannot be, which
    // is nearly always: a lifetime total says how long a game was played, not
    // how much of that fell inside these twelve months. Ranking on it produced
    // an empty list every year, because `playtime.byGame` here only holds the
    // handful of activities that carry a date inside the window.
    const unlocksByGame = new Map<string, number>();
    for (const row of unlockedThisYear) {
      const gameId = row.achievement.gameId;
      unlocksByGame.set(gameId, (unlocksByGame.get(gameId) ?? 0) + 1);
    }

    const rankedGames = unlocksByGame.size > 0 ? unlocksByGame : new Map(Object.entries(playtime.byGame));
    const rankedByUnlocks = unlocksByGame.size > 0;

    const topGames = [...rankedGames.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([gameId, weight]) => {
        const game = gamesById.get(gameId) ?? gamesFromAchievements.get(gameId);
        return {
          name: game?.name,
          slug: game?.slug,
          coverImage: game?.coverImage ?? null,
          unlocks: rankedByUnlocks ? weight : undefined,
          minutes: rankedByUnlocks ? (playtime.byGame[gameId] ?? 0) : weight,
        };
      })
      .filter((entry) => entry.name !== undefined);

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
      /** Which measure topGames is ranked by, so the UI can label it. */
      topGamesBasis: rankedByUnlocks ? ('achievements' as const) : ('playtime' as const),
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
  /**
   * When each fully-unlocked game was finished, taken as its final unlock.
   *
   * Only games where every achievement we hold is unlocked qualify, which is
   * the same rule the library filter and the dashboard count use.
   */
  private async inferredCompletions(userId: string): Promise<
    Map<string, { at: Date; provider: string; game: { name: string; slug: string; coverImage: string | null } }>
  > {
    const complete = await fullyUnlockedGameIds(this.prisma.client, userId);
    if (complete.size === 0) return new Map();

    const rows = await this.prisma.client.userAchievement.findMany({
      where: {
        userId,
        unlocked: true,
        unlockedAt: { not: null },
        achievement: { gameId: { in: [...complete] } },
      },
      select: {
        unlockedAt: true,
        achievement: {
          select: {
            gameId: true,
            provider: true,
            game: { select: { name: true, slug: true, coverImage: true } },
          },
        },
      },
    });

    const latest = new Map<
      string,
      { at: Date; provider: string; game: { name: string; slug: string; coverImage: string | null } }
    >();

    for (const row of rows) {
      const at = row.unlockedAt;
      if (!at) continue;
      const gameId = row.achievement.gameId;
      const held = latest.get(gameId);
      if (!held || at > held.at) {
        latest.set(gameId, { at, provider: row.achievement.provider, game: row.achievement.game });
      }
    }

    return latest;
  }

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
        // Generous rather than tight. The old 500 was quietly losing history:
        // a decade of dated play across three platforms is a few thousand
        // rows, and a timeline that silently stops part-way through 2019 is
        // worse than a slightly larger response.
        take: 10_000,
      }),
      this.prisma.client.ownership.findMany({
        where: { userId, acquiredAt: { not: null } },
        select: {
          gameId: true,
          provider: true,
          acquiredAt: true,
          game: { select: { name: true, slug: true, coverImage: true } },
        },
        take: 10_000,
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
        take: 50_000,
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
        firstPlayed: false,
      };
      entries.set(key, created);
      return created;
    };

    // Earliest genuine start instant per game, before anything else is
    // placed. RECENT_PLAY is excluded: its startedAt is a synthetic window
    // boundary ("sometime in the last fortnight"), so trusting it would report
    // a first play that never happened.
    const firstStart = new Map<string, Date>();
    for (const activity of activities) {
      if (activity.activityType === 'RECENT_PLAY') continue;
      const started = activity.startedAt;
      if (!started) continue;
      const held = firstStart.get(activity.gameId);
      if (!held || started < held) firstStart.set(activity.gameId, started);
    }

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

    // Completions the user never declared.
    //
    // The dashboard and the library both call a game complete once every
    // achievement is unlocked, so a timeline that showed none disagreed with
    // them. The date is the final unlock: the moment the last one landed is
    // when the game was finished, and it is a real recorded instant rather
    // than an invented one.
    //
    // Skipped where the user has set a status themselves — they may have
    // finished it long before mopping up the last trophy.
    const declared = new Set(statuses.map((status) => status.gameId));
    for (const [gameId, finished] of await this.inferredCompletions(userId)) {
      if (declared.has(gameId)) continue;
      entryFor(finished.at, finished.game, finished.provider).completed = true;
    }

    for (const unlock of unlocks) {
      const entry = entryFor(
        unlock.unlockedAt!,
        unlock.achievement.game,
        unlock.achievement.provider,
      );
      entry.achievements += 1;
    }

    // Attach first plays to the day they happened, which is usually a
    // different day from the entry the lifetime total produced.
    for (const activity of activities) {
      const started = firstStart.get(activity.gameId);
      if (!started || started.getTime() !== activity.startedAt?.getTime()) continue;
      entryFor(started, activity.game, activity.provider).firstPlayed = true;
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
    //
    // "Recently" needs a date and "played" needs evidence, and they come from
    // different rows. Xbox stamps every title in its history with a
    // lastTimePlayed that moves when a game is merely listed — installed,
    // cloud-synced, launched for a moment — so ordering on that alone filled
    // this panel with titles carrying zero minutes and zero unlocks. Ghost
    // Recon: Future Soldier led the dashboard as "currently playing" on the
    // strength of a timestamp and nothing else.
    //
    // So the date may come from any dated activity, but the game only
    // qualifies if something says it was actually played.
    const recent = await this.prisma.client.$queryRaw<
      Array<{ name: string; slug: string; coverImage: string | null }>
    >`
      WITH played AS (
        SELECT DISTINCT "gameId" FROM "PlayActivity"
        WHERE "userId" = ${userId} AND "minutesPlayed" > 0
        UNION
        SELECT DISTINCT a."gameId"
        FROM "UserAchievement" ua
        JOIN "Achievement" a ON a.id = ua."achievementId"
        WHERE ua."userId" = ${userId} AND ua.unlocked
      ),
      signals AS (
        SELECT "gameId", "endedAt" AS at FROM "PlayActivity"
        WHERE "userId" = ${userId} AND "endedAt" IS NOT NULL
        UNION ALL
        SELECT a."gameId", ua."unlockedAt"
        FROM "UserAchievement" ua
        JOIN "Achievement" a ON a.id = ua."achievementId"
        WHERE ua."userId" = ${userId} AND ua.unlocked AND ua."unlockedAt" IS NOT NULL
      )
      SELECT g.name, g.slug, g."coverImage"
      FROM signals s
      JOIN played p ON p."gameId" = s."gameId"
      JOIN "Game" g ON g.id = s."gameId"
      WHERE g."mergedIntoId" IS NULL
      GROUP BY g.id, g.name, g.slug, g."coverImage"
      ORDER BY max(s.at) DESC
      LIMIT 6
    `;

    return recent.map((game) => ({ ...game, status: 'PLAYING' as const }));
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

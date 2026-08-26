import type { PrismaClient } from '@omniplay/database';

/**
 * Games where the user has unlocked every achievement.
 *
 * Shared by the library and the dashboard because both infer "completed" from
 * it, and two queries answering the same question would eventually answer it
 * differently — which is precisely how the dashboard came to report zero
 * completed games beside a library screen that had found one.
 *
 * Counted from the achievement rows rather than from a provider's summary: a
 * game shows as complete only when every achievement we actually hold carries
 * an unlock for this user.
 */
export async function fullyUnlockedGameIds(
  prisma: PrismaClient,
  userId: string,
  /** Restricts the query to these games; omit for the whole library. */
  gameIds?: string[],
): Promise<Set<string>> {
  // An empty list means "these zero games", not "all games".
  if (gameIds && gameIds.length === 0) return new Set();

  const rows = gameIds
    ? await prisma.$queryRaw<Array<{ gameId: string }>>`
        SELECT a."gameId"
        FROM "Achievement" a
        LEFT JOIN "UserAchievement" ua
               ON ua."achievementId" = a.id
              AND ua."userId" = ${userId}
              AND ua.unlocked = true
        WHERE a."gameId" = ANY(${gameIds})
        GROUP BY a."gameId"
        HAVING count(*) = count(ua.id)
      `
    : await prisma.$queryRaw<Array<{ gameId: string }>>`
        SELECT a."gameId"
        FROM "Achievement" a
        LEFT JOIN "UserAchievement" ua
               ON ua."achievementId" = a.id
              AND ua."userId" = ${userId}
              AND ua.unlocked = true
        GROUP BY a."gameId"
        HAVING count(*) = count(ua.id)
      `;

  return new Set(rows.map((row) => row.gameId));
}

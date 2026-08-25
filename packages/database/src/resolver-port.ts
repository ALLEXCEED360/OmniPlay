import type { GameCandidate, ResolverPort } from '@omniplay/game-matching';
import type { ProviderId } from '@omniplay/types';
import type { PrismaClient } from '@prisma/client';

/**
 * Prisma-backed implementation of the matcher's ResolverPort.
 *
 * The resolver itself stays pure and database-free; this adapter is where the
 * indexes it relies on actually get used:
 *
 *   level 1 -> ExternalGameIdentity(provider, externalId)  unique index
 *   level 3 -> Game.normalizedName / GameAlias.normalizedName  btree
 *   level 4 -> pg_trgm similarity over Game.normalizedName    GIN
 */
export function createResolverPort(prisma: PrismaClient): ResolverPort {
  return {
    async findByExternalId(provider: ProviderId, externalId: string) {
      const identity = await prisma.externalGameIdentity.findUnique({
        where: { provider_externalId: { provider, externalId } },
        select: { gameId: true, game: { select: { mergedIntoId: true } } },
      });
      if (!identity) return null;
      // Follow a merge pointer so a mapping made before two canonical rows were
      // merged still resolves to the surviving game.
      return identity.game.mergedIntoId ?? identity.gameId;
    },

    async findByNormalizedName(normalized: string) {
      const [games, aliases] = await Promise.all([
        prisma.game.findMany({
          where: { normalizedName: normalized, mergedIntoId: null },
          select: SELECT_CANDIDATE,
          take: 25,
        }),
        prisma.gameAlias.findMany({
          where: { normalizedName: normalized, game: { mergedIntoId: null } },
          select: { game: { select: SELECT_CANDIDATE } },
          take: 25,
        }),
      ]);

      // An alias and its game can both match; de-duplicate by id.
      const byId = new Map<string, GameCandidate>();
      for (const game of games) byId.set(game.id, toCandidate(game));
      for (const alias of aliases) byId.set(alias.game.id, toCandidate(alias.game));
      return [...byId.values()];
    },

    async searchCandidates(normalized: string, limit: number) {
      // Raw SQL because Prisma has no first-class trigram operator. The `%`
      // operator uses the GIN index; ordering by distance would not.
      const rows = await prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          normalizedName: string;
          firstReleaseDate: Date | null;
        }>
      >`
        SELECT id, name, "normalizedName", "firstReleaseDate"
        FROM "Game"
        WHERE "mergedIntoId" IS NULL
          AND "normalizedName" % ${normalized}
        ORDER BY similarity("normalizedName", ${normalized}) DESC
        LIMIT ${limit}
      `;

      return rows.map(toCandidate);
    },
  };
}

const SELECT_CANDIDATE = {
  id: true,
  name: true,
  normalizedName: true,
  firstReleaseDate: true,
} as const;

function toCandidate(row: {
  id: string;
  name: string;
  normalizedName: string;
  firstReleaseDate: Date | null;
}): GameCandidate {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    firstReleaseDate: row.firstReleaseDate,
  };
}

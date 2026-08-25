import type { PrismaClient } from '@prisma/client';

/**
 * Merging one canonical game into another.
 *
 * This is the most dangerous write in the system. Every row that pointed at the
 * losing game has to move, and several of those tables have unique constraints
 * that the move can violate — a user who somehow has both games in one
 * collection, or a status on each. Each of those is handled explicitly below
 * rather than left to fail the transaction.
 *
 * The loser is never deleted. It keeps a `mergedIntoId` pointer so:
 *   - an `ExternalGameIdentity` mapped before the merge still resolves,
 *   - and a mistaken merge can be inspected and reversed by hand.
 *
 * Everything happens in one transaction. A half-merged game — ownership moved
 * but playtime not — would be worse than either outcome.
 */

export interface MergeResult {
  survivingGameId: string;
  mergedGameId: string;
  moved: Record<string, number>;
  /** Rows dropped because the surviving game already had an equivalent. */
  discarded: Record<string, number>;
}

export async function mergeGames(
  prisma: PrismaClient,
  input: { loserId: string; winnerId: string },
): Promise<MergeResult> {
  const { loserId, winnerId } = input;

  if (loserId === winnerId) {
    throw new Error('Cannot merge a game into itself.');
  }

  const [loser, winner] = await Promise.all([
    prisma.game.findUnique({ where: { id: loserId }, select: { id: true, mergedIntoId: true } }),
    prisma.game.findUnique({ where: { id: winnerId }, select: { id: true, mergedIntoId: true } }),
  ]);

  if (!loser) throw new Error(`Game ${loserId} not found.`);
  if (!winner) throw new Error(`Game ${winnerId} not found.`);
  if (winner.mergedIntoId) {
    // Merging into an already-merged row would create a chain that reads have
    // to walk. Point the caller at the real survivor instead.
    throw new Error(
      `Game ${winnerId} has itself been merged into ${winner.mergedIntoId}. Merge into that one.`,
    );
  }
  if (loser.mergedIntoId) throw new Error(`Game ${loserId} has already been merged.`);

  const moved: Record<string, number> = {};
  const discarded: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    /* --- Tables whose unique keys cannot collide ---------------------- *
     * ExternalGameIdentity is unique on (provider, externalId), Ownership on
     * (userId, provider, externalGameId) and PlayActivity on (userId,
     * dedupeKey) - all of which include the provider's own id, so two distinct
     * games can never produce the same key. A straight update is safe.
     */
    moved['externalIds'] = (
      await tx.externalGameIdentity.updateMany({
        where: { gameId: loserId },
        data: { gameId: winnerId },
      })
    ).count;

    moved['ownerships'] = (
      await tx.ownership.updateMany({ where: { gameId: loserId }, data: { gameId: winnerId } })
    ).count;

    moved['activities'] = (
      await tx.playActivity.updateMany({ where: { gameId: loserId }, data: { gameId: winnerId } })
    ).count;

    moved['notes'] = (
      await tx.userGameNote.updateMany({ where: { gameId: loserId }, data: { gameId: winnerId } })
    ).count;

    moved['unresolved'] = (
      await tx.unresolvedExternalGame.updateMany({
        where: { resolvedGameId: loserId },
        data: { resolvedGameId: winnerId },
      })
    ).count;

    /* --- Tables where a collision is possible ------------------------- */

    // UserGameStatus is unique on (userId, gameId). A user holding a status on
    // both games keeps the winner's: it is the row they will keep seeing, and
    // silently overwriting it with the loser's would change their own verdict.
    const loserStatuses = await tx.userGameStatus.findMany({
      where: { gameId: loserId },
      select: { id: true, userId: true },
    });
    const winnerStatusUsers = new Set(
      (
        await tx.userGameStatus.findMany({
          where: { gameId: winnerId, userId: { in: loserStatuses.map((s) => s.userId) } },
          select: { userId: true },
        })
      ).map((s) => s.userId),
    );

    const statusesToMove = loserStatuses.filter((s) => !winnerStatusUsers.has(s.userId));
    const statusesToDrop = loserStatuses.filter((s) => winnerStatusUsers.has(s.userId));

    if (statusesToMove.length > 0) {
      await tx.userGameStatus.updateMany({
        where: { id: { in: statusesToMove.map((s) => s.id) } },
        data: { gameId: winnerId },
      });
    }
    if (statusesToDrop.length > 0) {
      await tx.userGameStatus.deleteMany({
        where: { id: { in: statusesToDrop.map((s) => s.id) } },
      });
    }
    moved['statuses'] = statusesToMove.length;
    discarded['statuses'] = statusesToDrop.length;

    // Achievement is unique on (provider, externalId, gameId). The same
    // achievement genuinely can exist on both rows if both were synced.
    const loserAchievements = await tx.achievement.findMany({
      where: { gameId: loserId },
      select: { id: true, provider: true, externalId: true },
    });
    const winnerKeys = new Set(
      (
        await tx.achievement.findMany({
          where: { gameId: winnerId },
          select: { provider: true, externalId: true },
        })
      ).map((a) => `${a.provider}:${a.externalId}`),
    );

    const achievementsToMove = loserAchievements.filter(
      (a) => !winnerKeys.has(`${a.provider}:${a.externalId}`),
    );
    const achievementsToDrop = loserAchievements.filter((a) =>
      winnerKeys.has(`${a.provider}:${a.externalId}`),
    );

    if (achievementsToMove.length > 0) {
      await tx.achievement.updateMany({
        where: { id: { in: achievementsToMove.map((a) => a.id) } },
        data: { gameId: winnerId },
      });
    }
    if (achievementsToDrop.length > 0) {
      // Cascades to the users' unlock rows. The winner's equivalent
      // achievement already carries the same unlock state.
      await tx.achievement.deleteMany({
        where: { id: { in: achievementsToDrop.map((a) => a.id) } },
      });
    }
    moved['achievements'] = achievementsToMove.length;
    discarded['achievements'] = achievementsToDrop.length;

    // CollectionGame is keyed (collectionId, gameId): a collection holding both
    // games would collide, and the user wants one entry either way.
    const loserCollections = await tx.collectionGame.findMany({
      where: { gameId: loserId },
      select: { collectionId: true },
    });
    const winnerCollections = new Set(
      (
        await tx.collectionGame.findMany({
          where: { gameId: winnerId, collectionId: { in: loserCollections.map((c) => c.collectionId) } },
          select: { collectionId: true },
        })
      ).map((c) => c.collectionId),
    );

    const collectionsToMove = loserCollections
      .map((c) => c.collectionId)
      .filter((id) => !winnerCollections.has(id));

    if (collectionsToMove.length > 0) {
      await tx.collectionGame.updateMany({
        where: { gameId: loserId, collectionId: { in: collectionsToMove } },
        data: { gameId: winnerId },
      });
    }
    // Whatever is left collided; drop it.
    discarded['collections'] = (
      await tx.collectionGame.deleteMany({ where: { gameId: loserId } })
    ).count;
    moved['collections'] = collectionsToMove.length;

    // GameAlias is unique on (gameId, normalizedName).
    const loserAliases = await tx.gameAlias.findMany({
      where: { gameId: loserId },
      select: { id: true, normalizedName: true },
    });
    const winnerAliasNames = new Set(
      (
        await tx.gameAlias.findMany({
          where: { gameId: winnerId },
          select: { normalizedName: true },
        })
      ).map((a) => a.normalizedName),
    );

    const aliasesToMove = loserAliases.filter((a) => !winnerAliasNames.has(a.normalizedName));
    if (aliasesToMove.length > 0) {
      await tx.gameAlias.updateMany({
        where: { id: { in: aliasesToMove.map((a) => a.id) } },
        data: { gameId: winnerId },
      });
    }
    await tx.gameAlias.deleteMany({ where: { gameId: loserId } });
    moved['aliases'] = aliasesToMove.length;

    // GamePlatform is unique on (gameId, platformId).
    const loserPlatforms = await tx.gamePlatform.findMany({
      where: { gameId: loserId },
      select: { platformId: true },
    });
    const winnerPlatforms = new Set(
      (
        await tx.gamePlatform.findMany({ where: { gameId: winnerId }, select: { platformId: true } })
      ).map((p) => p.platformId),
    );
    const platformsToMove = loserPlatforms
      .map((p) => p.platformId)
      .filter((id) => !winnerPlatforms.has(id));

    if (platformsToMove.length > 0) {
      await tx.gamePlatform.updateMany({
        where: { gameId: loserId, platformId: { in: platformsToMove } },
        data: { gameId: winnerId },
      });
    }
    await tx.gamePlatform.deleteMany({ where: { gameId: loserId } });
    moved['platforms'] = platformsToMove.length;

    // Relations pointing at either end move across; self-relations that the
    // merge would create are dropped, since a game cannot relate to itself.
    await tx.gameRelation.deleteMany({
      where: {
        OR: [
          { fromId: loserId, toId: winnerId },
          { fromId: winnerId, toId: loserId },
        ],
      },
    });
    await tx.gameRelation.updateMany({ where: { fromId: loserId }, data: { fromId: winnerId } });
    await tx.gameRelation.updateMany({ where: { toId: loserId }, data: { toId: winnerId } });

    // The loser's name becomes an alias of the winner, so a future sync of the
    // old spelling still resolves.
    const loserRow = await tx.game.findUniqueOrThrow({
      where: { id: loserId },
      select: { name: true, normalizedName: true },
    });
    if (!winnerAliasNames.has(loserRow.normalizedName)) {
      await tx.gameAlias
        .create({
          data: {
            gameId: winnerId,
            name: loserRow.name,
            normalizedName: loserRow.normalizedName,
            source: 'merge',
          },
        })
        .catch(() => {
          // Winner already answers to this name; nothing to record.
        });
    }

    await tx.game.update({
      where: { id: loserId },
      data: { mergedIntoId: winnerId },
    });
  });

  return { survivingGameId: winnerId, mergedGameId: loserId, moved, discarded };
}

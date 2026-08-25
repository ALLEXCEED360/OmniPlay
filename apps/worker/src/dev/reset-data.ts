/**
 * Wipes imported game data for one user, or for the whole instance.
 *
 * The demo scripts seed fixture libraries so the pipeline can be exercised
 * without credentials. That data is indistinguishable from real data once it
 * is in the database — by design, since it goes through the same pipeline — so
 * there needs to be a clean way to remove it before connecting real accounts.
 *
 *   pnpm --filter @omniplay/worker reset you@example.com
 *   pnpm --filter @omniplay/worker reset --all
 *
 * User accounts, sessions and collections are preserved. Only the gaming
 * record and the canonical catalogue are cleared.
 */

import { prisma, pruneOrphanedQueueEntries } from '@omniplay/database';

async function main(): Promise<void> {
  const target = process.argv[2];

  if (!target) {
    console.error(
      'Specify whose data to clear:\n' +
        '  pnpm --filter @omniplay/worker reset you@example.com\n' +
        '  pnpm --filter @omniplay/worker reset --all',
    );
    process.exitCode = 1;
    return;
  }

  if (target === '--all') {
    console.log('Clearing all game data for every user...');

    // Ordered by dependency. Game cascades to most of the rest, but the
    // user-scoped tables are cleared explicitly so the intent is readable.
    const counts = {
      activities: (await prisma.playActivity.deleteMany({})).count,
      ownerships: (await prisma.ownership.deleteMany({})).count,
      statuses: (await prisma.userGameStatus.deleteMany({})).count,
      imports: (await prisma.importBatch.deleteMany({})).count,
      syncJobs: (await prisma.syncJob.deleteMany({})).count,
      cursors: (await prisma.syncCursor.deleteMany({})).count,
      unresolved: (await prisma.unresolvedExternalGame.deleteMany({})).count,
      games: (await prisma.game.deleteMany({})).count,
    };

    // Connections survive so the user does not have to re-authorise; the next
    // sync repopulates from the provider.
    await prisma.connectedAccount.updateMany({ data: { lastSyncAt: null } });

    console.table(counts);
    console.log('\nConnections kept. Run a sync to repopulate from your real accounts.');
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: target.toLowerCase() },
    select: { id: true, username: true },
  });

  if (!user) {
    console.error(`No user with email ${target}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Clearing game data for ${user.username}...`);

  const counts = {
    activities: (await prisma.playActivity.deleteMany({ where: { userId: user.id } })).count,
    ownerships: (await prisma.ownership.deleteMany({ where: { userId: user.id } })).count,
    statuses: (await prisma.userGameStatus.deleteMany({ where: { userId: user.id } })).count,
    achievements: (await prisma.userAchievement.deleteMany({ where: { userId: user.id } })).count,
    imports: (await prisma.importBatch.deleteMany({ where: { userId: user.id } })).count,
    syncJobs: (await prisma.syncJob.deleteMany({ where: { userId: user.id } })).count,
    cursors: (await prisma.syncCursor.deleteMany({ where: { userId: user.id } })).count,
  };

  console.table(counts);

  // The demo scripts fabricate a ConnectedAccount so the sync runner has
  // something to attach to. That row is indistinguishable from a real
  // connection afterwards and will show as "connected" on the settings
  // screen, so `--connections` exists to clear it. Real connections are kept
  // by default: dropping them would force a genuine re-authorisation.
  const droppedConnections = process.argv.includes('--connections');
  if (droppedConnections) {
    const removed = await prisma.connectedAccount.deleteMany({ where: { userId: user.id } });
    console.log(`Removed ${removed.count} provider connection(s).`);
  }

  // Canonical games nobody owns any more are orphans. They are shared across
  // users, so only the genuinely unreferenced ones are removed.
  const orphaned = await prisma.game.deleteMany({
    where: {
      ownerships: { none: {} },
      activities: { none: {} },
      collectionGames: { none: {} },
    },
  });
  console.log(`Removed ${orphaned.count} canonical games no longer referenced by anyone.`);

  // Those games' review-queue entries would otherwise survive as orphans,
  // asking about provider records that no longer exist anywhere.
  const prunedQueue = await pruneOrphanedQueueEntries(prisma);
  if (prunedQueue.pruned > 0) {
    console.log(`Removed ${prunedQueue.pruned} orphaned review-queue entr(ies).`);
  }

  console.log(
    droppedConnections
      ? '\nClean slate. Connect a real account from Settings to populate your library.'
      : '\nConnections kept. Run a sync to repopulate from your real accounts.',
  );
}

main()
  .catch((error: unknown) => {
    console.error('Reset failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

/**
 * Closes review-queue entries that metadata enrichment has already answered.
 *
 *   pnpm --filter @omniplay/worker sweep          # preview, changes nothing
 *   pnpm --filter @omniplay/worker sweep --apply  # actually close them
 *
 * The same operation the Data quality screen offers; this is for running it
 * without a browser. It previews by default, because bulk-resolving a queue
 * of decisions should never be the accidental outcome of a typo.
 */

import { prisma, pruneOrphanedQueueEntries, sweepAutoResolved } from '@omniplay/database';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // Orphans first: they are noise rather than decisions, and removing them
  // makes the resolved/remaining counts below mean something.
  const orphans = await pruneOrphanedQueueEntries(prisma, { dryRun: !apply });
  if (orphans.pruned > 0) {
    console.log(
      apply
        ? `Removed ${orphans.pruned} queue entr(ies) for records that no longer exist.`
        : `${orphans.pruned} queue entr(ies) refer to records that no longer exist.`,
    );
    for (const title of orphans.titles.slice(0, 8)) console.log(`   ${title}`);
    if (orphans.titles.length > 8) console.log(`   ...and ${orphans.titles.length - 8} more`);
    console.log();
  }

  const result = await sweepAutoResolved(prisma, { dryRun: !apply });

  if (result.resolved === 0) {
    console.log(`Nothing to close. ${result.remaining} entr(ies) need a human decision.`);
    return;
  }

  console.log(
    apply
      ? `Closed ${result.resolved} entr(ies) already answered by IGDB metadata.`
      : `${result.resolved} entr(ies) are already mapped to a game with full metadata.`,
  );

  for (const title of result.titles.slice(0, 12)) console.log(`   ${title}`);
  if (result.titles.length > 12) console.log(`   ...and ${result.titles.length - 12} more`);

  console.log(`\n${result.remaining} entr(ies) still need a human decision.`);
  if (!apply) console.log('\nRe-run with --apply to close them.');
}

main()
  .catch((error: unknown) => {
    console.error('Sweep failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

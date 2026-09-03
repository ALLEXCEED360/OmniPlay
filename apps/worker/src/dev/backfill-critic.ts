/**
 * Repairs critic scores that are missing, and records what each one rests on.
 *
 *   pnpm --filter @omniplay/worker backfill:critic          # report only
 *   pnpm --filter @omniplay/worker backfill:critic --apply
 *
 * Two jobs, both consequences of how IGDB models critic reception.
 *
 * First, it attaches scores to a game's parent entry, so a *port* carries none
 * of its own. Enrichment follows that link now, but only for games it matches
 * from here on — a row already holding an `igdbId` is never revisited, so
 * BioShock and Bayonetta would stay blank forever.
 *
 * Second, IGDB will publish an "aggregate" built from a single review. Without
 * the review count there is no way to tell a critical consensus from one
 * person's opinion: Metro Exodus: Enhanced Edition showed 92 off two reviews
 * while the wider critical view put it at 83. So every scored game gets its
 * count recorded, and the interface decides what is worth showing.
 *
 * Ports only for the inheritance, deliberately. A remaster is a different
 * product with its own reception — Metro 2033 Redux is not Metro 2033 — and
 * lending it the original's number would be a quiet lie about how it was
 * received. Those keep the blank they honestly have.
 *
 * Reports before it writes, because a wrong score is worse than a missing one.
 */

import { prisma } from '@omniplay/database';
import { criticRatingFor, IgdbClient, PORT, type IgdbGame } from '@omniplay/providers';

const TYPE_NAMES: Record<number, string> = {
  0: 'main game',
  3: 'bundle',
  5: 'mod',
  8: 'remake',
  9: 'remaster',
  10: 'expanded game',
  11: 'port',
  12: 'fork',
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const clientId = process.env['IGDB_CLIENT_ID'];
  const clientSecret = process.env['IGDB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    console.error('IGDB_CLIENT_ID and IGDB_CLIENT_SECRET are required.');
    process.exitCode = 1;
    return;
  }

  const igdb = new IgdbClient({ clientId, clientSecret });

  const needsCount = await prisma.game.findMany({
    where: {
      mergedIntoId: null,
      igdbId: { not: null },
      aggregatedRating: { not: null },
      criticRatingCount: null,
    },
    select: { id: true, name: true, igdbId: true },
  });

  const needsScore = await prisma.game.findMany({
    where: { mergedIntoId: null, igdbId: { not: null }, aggregatedRating: null },
    select: { id: true, name: true, igdbId: true },
    orderBy: { name: 'asc' },
  });

  if (needsCount.length === 0 && needsScore.length === 0) {
    console.log('Nothing to do: every matched game has a score or is known not to have one.');
    return;
  }

  const ids = [...needsCount, ...needsScore].map((game) => game.igdbId).filter(Boolean) as number[];
  const entries: IgdbGame[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    entries.push(...(await igdb.getGamesByIds(ids.slice(index, index + 100))));
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  // ---- how many critics each existing score rests on ----------------------
  let counted = 0;
  const thin: Array<{ name: string; rating: number; count: number }> = [];

  for (const game of needsCount) {
    const entry = byId.get(game.igdbId!);
    if (!entry) continue;

    // A port's own count is zero; the score it carries came from its parent,
    // so the parent's count is the honest one.
    const critic = await criticRatingFor(igdb, entry);
    if (!critic) continue;

    if (critic.count < 4) thin.push({ name: game.name, ...critic });
    if (apply) {
      await prisma.game.update({
        where: { id: game.id },
        data: { criticRatingCount: critic.count },
      });
    }
    counted += 1;
  }

  if (thin.length > 0) {
    // Named rather than counted, because these are the ones the interface
    // will stop showing and the reader deserves to know which they were.
    console.log(`${thin.length} existing score(s) rest on fewer than four reviews:`);
    for (const entry of thin.sort((a, b) => b.rating - a.rating).slice(0, 12)) {
      console.log(
        `  ${entry.rating.toFixed(0).padStart(3)} from ${entry.count} review(s)  ${entry.name.slice(0, 40)}`,
      );
    }
    if (thin.length > 12) console.log(`  …and ${thin.length - 12} more`);
    console.log('');
  }

  // ---- scores for ports that have none ------------------------------------
  let filled = 0;
  const skipped: Array<{ name: string; why: string }> = [];

  for (const game of needsScore) {
    const entry = byId.get(game.igdbId!);
    if (!entry) {
      skipped.push({ name: game.name, why: 'IGDB no longer returns this entry' });
      continue;
    }

    if (entry.game_type !== PORT) {
      const type = TYPE_NAMES[entry.game_type ?? 0] ?? `type ${entry.game_type}`;
      skipped.push({ name: game.name, why: `${type} — scored on its own terms` });
      continue;
    }

    const critic = await criticRatingFor(igdb, entry);
    if (!critic) {
      skipped.push({ name: game.name, why: 'port, but its parent has no score either' });
      continue;
    }

    console.log(
      `  ${apply ? 'set ' : 'would set'} ${game.name.slice(0, 38).padEnd(40)} ` +
        `${critic.rating.toFixed(0)} from ${critic.count} review(s)`,
    );
    if (apply) {
      await prisma.game.update({
        where: { id: game.id },
        data: { aggregatedRating: critic.rating, criticRatingCount: critic.count },
      });
    }
    filled += 1;
  }

  if (skipped.length > 0) {
    console.log(`\nLeft without a score (${skipped.length}):`);
    for (const entry of skipped) {
      console.log(`  ${entry.name.slice(0, 40).padEnd(42)} ${entry.why}`);
    }
  }

  console.log(
    `\n${filled} score(s) and ${counted} review count(s) ${apply ? 'written' : 'pending'}.`,
  );
  if (!apply) console.log('Re-run with --apply to write them.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

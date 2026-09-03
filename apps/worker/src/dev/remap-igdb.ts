/**
 * Points a game at a different IGDB entry.
 *
 *   pnpm --filter @omniplay/worker remap:igdb battlefield-3 343
 *   pnpm --filter @omniplay/worker remap:igdb battlefield-3 343 --apply
 *
 * Automatic matching is tuned to defer rather than guess, but it still lands
 * on the wrong entry occasionally — usually a bundle, a mod, or one of the
 * several entries a long-lived franchise accumulates. Battlefield 3 resolved
 * to a mod sharing the exact title, which carries no critic score and no
 * release date, while the real game sat at entry 343 with 85 from ten reviews.
 *
 * Rewriting the row by hand in psql would work once. This goes through
 * `applyIgdbMetadataToGame`, the same path enrichment uses, so the result is
 * identical to having matched correctly in the first place — including the
 * critic score inherited from a parent entry where that applies.
 *
 * Reports before it writes. Repointing a game rewrites its identity — name,
 * summary, cover, genres — so seeing the swap first is the whole point.
 */

import { prisma } from '@omniplay/database';
import { IgdbClient } from '@omniplay/providers';
import { applyIgdbMetadataToGame } from '../ingest/game-resolution.js';

const TYPE_NAMES: Record<number, string> = {
  0: 'main game',
  1: 'DLC',
  2: 'expansion',
  3: 'bundle',
  4: 'standalone expansion',
  5: 'mod',
  8: 'remake',
  9: 'remaster',
  10: 'expanded game',
  11: 'port',
  12: 'fork',
};

async function main(): Promise<void> {
  const [slug, rawId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const apply = process.argv.includes('--apply');

  if (!slug || !rawId) {
    console.error('Usage: pnpm --filter @omniplay/worker remap:igdb <game-slug> <igdbId> [--apply]');
    process.exitCode = 1;
    return;
  }

  const igdbId = Number(rawId);
  if (!Number.isInteger(igdbId) || igdbId <= 0) {
    console.error(`"${rawId}" is not an IGDB id.`);
    process.exitCode = 1;
    return;
  }

  const clientId = process.env['IGDB_CLIENT_ID'];
  const clientSecret = process.env['IGDB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    console.error('IGDB_CLIENT_ID and IGDB_CLIENT_SECRET are required.');
    process.exitCode = 1;
    return;
  }

  const game = await prisma.game.findUnique({
    where: { slug },
    select: { id: true, name: true, igdbId: true, aggregatedRating: true, summary: true },
  });
  if (!game) {
    console.error(`No game with slug "${slug}".`);
    process.exitCode = 1;
    return;
  }

  // Another row already holding this igdbId would collide on the unique
  // constraint, and the honest fix for that is a merge, not a remap.
  const clash = await prisma.game.findFirst({
    where: { igdbId, NOT: { id: game.id } },
    select: { name: true, slug: true },
  });
  if (clash) {
    console.error(
      `IGDB ${igdbId} already belongs to "${clash.name}" (${clash.slug}).\n` +
        'Merge the two in /admin rather than remapping onto a taken id.',
    );
    process.exitCode = 1;
    return;
  }

  const igdb = new IgdbClient({ clientId, clientSecret });
  const [entry] = await igdb.getGamesByIds([igdbId]);
  if (!entry) {
    console.error(`IGDB has no entry ${igdbId}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${game.name}  (${slug})\n`);
  console.log(`  from  IGDB ${String(game.igdbId ?? '—').padEnd(8)} score ${game.aggregatedRating?.toFixed(0) ?? '—'}`);
  console.log(
    `  to    IGDB ${String(entry.id).padEnd(8)} score ${entry.aggregated_rating?.toFixed(0) ?? '—'}  ` +
      `"${entry.name}" (${TYPE_NAMES[entry.game_type ?? 0] ?? `type ${entry.game_type}`})`,
  );

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply.');
    return;
  }

  await applyIgdbMetadataToGame(prisma, game.id, entry, igdb);
  const after = await prisma.game.findUnique({
    where: { id: game.id },
    select: { name: true, aggregatedRating: true, summary: true },
  });
  console.log(
    `\nDone. Now "${after?.name}", score ${after?.aggregatedRating?.toFixed(0) ?? '—'}, ` +
      `${after?.summary ? 'has' : 'still has no'} About text.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

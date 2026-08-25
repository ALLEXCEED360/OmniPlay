/**
 * Backfills IGDB metadata against the real API.
 *
 *   pnpm --filter @omniplay/worker enrich          # every game missing metadata
 *   pnpm --filter @omniplay/worker enrich 20       # cap the batch
 *
 * The sibling `demo:enrich` runs the same pipeline against a stubbed catalogue
 * so it works without credentials. This one uses live IGDB, which means it is
 * bound by their documented 4 requests/second — the client's limiter enforces
 * that, so a large library takes a while by design rather than by accident.
 */

import { prisma } from '@omniplay/database';
import { IgdbClient } from '@omniplay/providers';
import { enrichProvisionalGames } from '../ingest/metadata-enrichment.js';

async function main(): Promise<void> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('IGDB_CLIENT_ID and IGDB_CLIENT_SECRET are required. Run `pnpm doctor`.');
    process.exitCode = 1;
    return;
  }

  const limit = Number.parseInt(process.argv[2] ?? '', 10);
  const igdb = new IgdbClient({ clientId, clientSecret });

  const pending = await prisma.game.count({
    where: { igdbId: null, mergedIntoId: null, metadataSyncedAt: null },
  });

  if (pending === 0) {
    console.log('Nothing to enrich — every game already has metadata, or has been tried.');
    console.log('To retry games IGDB could not place, use the Data quality screen.');
    return;
  }

  const batch = Number.isFinite(limit) ? Math.min(limit, pending) : pending;
  console.log(
    `Enriching ${batch} game(s) from IGDB. At 4 requests/second this takes about ` +
      `${Math.ceil(batch / 3)}s.\n`,
  );

  const started = Date.now();
  const results = await enrichProvisionalGames(prisma, igdb, { limit: batch });

  const tally: Record<string, number> = {};
  const notes: string[] = [];

  for (const result of results) {
    tally[result.outcome] = (tally[result.outcome] ?? 0) + 1;

    // Only the outcomes a human might want to act on are worth printing; a
    // list of 58 successes is noise.
    if (result.outcome === 'enriched' || result.outcome === 'merged') continue;

    const game = await prisma.game.findUnique({
      where: { id: result.gameId },
      select: { name: true },
    });
    notes.push(
      `  ${result.outcome.padEnd(10)} ${game?.name ?? result.gameId}` +
        (result.reason ? ` — ${result.reason}` : ''),
    );
  }

  console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s.\n`);
  console.table(tally);

  if (notes.length > 0) {
    console.log('\nNeeds a human decision (see /admin):');
    for (const note of notes) console.log(note);
  }

  const [withGenres, withCovers, remaining] = await Promise.all([
    prisma.game.count({ where: { mergedIntoId: null, genres: { isEmpty: false } } }),
    prisma.game.count({ where: { mergedIntoId: null, coverImage: { not: null } } }),
    prisma.game.count({ where: { igdbId: null, mergedIntoId: null } }),
  ]);

  console.log(
    `\n${withGenres} game(s) now have genres, ${withCovers} have cover art. ` +
      `${remaining} still without IGDB metadata.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Enrichment failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

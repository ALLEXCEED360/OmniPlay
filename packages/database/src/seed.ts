import { PrismaClient } from '@prisma/client';

/**
 * Database bootstrap: extensions, indexes Prisma cannot express, and the
 * platform reference table.
 *
 * Safe to run repeatedly - every statement is idempotent - so it can follow
 * every `db push` and every deploy without a guard.
 */

const prisma = new PrismaClient();

/**
 * Platforms seeded up front so a Steam-only instance can still label
 * ownership correctly before IGDB has ever been called. IGDB ids are filled in
 * later by the metadata sync, which matches on `slug`.
 */
const PLATFORMS = [
  { name: 'PC (Microsoft Windows)', slug: 'win', family: 'PC', manufacturer: 'Microsoft' },
  { name: 'macOS', slug: 'mac', family: 'PC', manufacturer: 'Apple' },
  { name: 'Linux', slug: 'linux', family: 'PC', manufacturer: null },
  { name: 'PlayStation 3', slug: 'ps3', family: 'PlayStation', manufacturer: 'Sony', generation: 7 },
  { name: 'PlayStation 4', slug: 'ps4--1', family: 'PlayStation', manufacturer: 'Sony', generation: 8 },
  { name: 'PlayStation 5', slug: 'ps5', family: 'PlayStation', manufacturer: 'Sony', generation: 9 },
  { name: 'Xbox 360', slug: 'xbox360', family: 'Xbox', manufacturer: 'Microsoft', generation: 7 },
  { name: 'Xbox One', slug: 'xboxone', family: 'Xbox', manufacturer: 'Microsoft', generation: 8 },
  { name: 'Xbox Series X|S', slug: 'series-x-s', family: 'Xbox', manufacturer: 'Microsoft', generation: 9 },
  { name: 'Nintendo Switch', slug: 'switch', family: 'Nintendo', manufacturer: 'Nintendo', generation: 8 },
];

async function main(): Promise<void> {
  console.log('Enabling Postgres extensions...');
  // pg_trgm powers matching level 4; without it the fuzzy candidate query in
  // createResolverPort fails outright rather than degrading.
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS citext');

  console.log('Creating trigram indexes...');
  // Prisma has no syntax for a GIN trigram index, so it is created here. The
  // `%` operator and `similarity()` ordering both depend on it; without the
  // index a fuzzy lookup degrades to a sequential scan of every game.
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS game_normalized_name_trgm_idx ' +
      'ON "Game" USING GIN ("normalizedName" gin_trgm_ops)',
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS game_alias_normalized_name_trgm_idx ' +
      'ON "GameAlias" USING GIN ("normalizedName" gin_trgm_ops)',
  );
  // Case-insensitive search over display names, used by the library search box.
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS game_name_trgm_idx ON "Game" USING GIN ("name" gin_trgm_ops)',
  );

  console.log('Seeding platforms...');
  for (const platform of PLATFORMS) {
    await prisma.platform.upsert({
      where: { slug: platform.slug },
      create: platform,
      update: { family: platform.family, manufacturer: platform.manufacturer },
    });
  }

  console.log(`Done. ${PLATFORMS.length} platforms available.`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

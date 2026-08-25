/**
 * Development harness for IGDB metadata enrichment.
 *
 * Runs the real `enrichProvisionalGames` against the real database, with a
 * `SteamProvider`-style stubbed `fetch` standing in for IGDB. That exercises
 * the genuine client, the genuine scoring rules and the genuine merge path
 * without needing Twitch credentials.
 *
 *   pnpm --filter @omniplay/worker demo:enrich
 */

import { prisma } from '@omniplay/database';
import { IgdbClient } from '@omniplay/providers';
import { enrichProvisionalGames } from '../ingest/metadata-enrichment.js';

/**
 * A stand-in IGDB catalogue covering the demo library.
 *
 * Note what is deliberately present: "Resident Evil 4" but NOT the remake, so
 * the version-marker guard has something to refuse. And "Elden Ring" carries
 * both a Steam and a PlayStation store id, which is how the level-2 mapping
 * gets imported for free.
 */
const CATALOGUE = [
  {
    id: 1877,
    name: 'Cyberpunk 2077',
    slug: 'cyberpunk-2077',
    summary: 'An open-world action-adventure story set in Night City.',
    first_release_date: 1607472000,
    rating: 78.4,
    cover: { image_id: 'co2mjs' },
    genres: [{ name: 'Role-playing (RPG)' }, { name: 'Shooter' }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)', slug: 'win' }],
    involved_companies: [{ developer: true, company: { name: 'CD Projekt RED' } }],
    external_games: [{ category: 1, uid: '1091500' }],
  },
  {
    id: 119133,
    name: 'Elden Ring',
    slug: 'elden-ring',
    summary: 'A vast world where open fields meet sprawling dungeons.',
    first_release_date: 1645747200,
    rating: 94.2,
    cover: { image_id: 'co4jni' },
    genres: [{ name: 'Role-playing (RPG)' }, { name: 'Adventure' }],
    platforms: [
      { id: 6, name: 'PC (Microsoft Windows)', slug: 'win' },
      { id: 167, name: 'PlayStation 5', slug: 'ps5' },
    ],
    involved_companies: [{ developer: true, company: { name: 'FromSoftware' } }],
    external_games: [
      { category: 1, uid: '1245620' },
      { category: 36, uid: 'CUSA-30000' },
    ],
  },
  {
    id: 1942,
    name: 'The Witcher 3: Wild Hunt',
    slug: 'the-witcher-3-wild-hunt',
    first_release_date: 1431993600,
    rating: 93.6,
    cover: { image_id: 'co1wyy' },
    genres: [{ name: 'Role-playing (RPG)' }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)', slug: 'win' }],
    external_games: [{ category: 1, uid: '292030' }],
  },
  {
    id: 25076,
    name: 'Red Dead Redemption 2',
    slug: 'red-dead-redemption-2',
    first_release_date: 1540512000,
    rating: 92.1,
    cover: { image_id: 'co1q1f' },
    genres: [{ name: 'Adventure' }, { name: 'Shooter' }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)', slug: 'win' }],
    external_games: [{ category: 1, uid: '1174180' }],
  },
  {
    id: 119171,
    name: "Baldur's Gate 3",
    slug: 'baldurs-gate-3',
    first_release_date: 1691366400,
    rating: 95.3,
    cover: { image_id: 'co670h' },
    genres: [{ name: 'Role-playing (RPG)' }, { name: 'Turn-based strategy (TBS)' }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)', slug: 'win' }],
    external_games: [{ category: 1, uid: '1086940' }],
  },
  {
    id: 17000,
    name: 'Stardew Valley',
    slug: 'stardew-valley',
    first_release_date: 1456444800,
    rating: 89.0,
    cover: { image_id: 'co4rxg' },
    genres: [{ name: 'Simulator' }, { name: 'Role-playing (RPG)' }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)', slug: 'win' }],
    external_games: [{ category: 1, uid: '413150' }],
  },
  {
    id: 7334,
    name: 'Bloodborne',
    slug: 'bloodborne',
    first_release_date: 1427241600,
    rating: 91.4,
    cover: { image_id: 'co1rs4' },
    genres: [{ name: 'Role-playing (RPG)' }, { name: 'Adventure' }],
    platforms: [{ id: 48, name: 'PlayStation 4', slug: 'ps4--1' }],
    external_games: [{ category: 36, uid: 'CUSA-00207' }],
  },
  {
    id: 19560,
    name: 'God of War',
    slug: 'god-of-war--1',
    first_release_date: 1524182400,
    rating: 92.8,
    cover: { image_id: 'co1tmu' },
    genres: [{ name: 'Adventure' }],
    platforms: [{ id: 48, name: 'PlayStation 4', slug: 'ps4--1' }],
  },
  {
    id: 114283,
    name: 'Ghost of Tsushima',
    slug: 'ghost-of-tsushima',
    first_release_date: 1595203200,
    rating: 88.5,
    cover: { image_id: 'co2dto' },
    genres: [{ name: 'Adventure' }],
    platforms: [{ id: 48, name: 'PlayStation 4', slug: 'ps4--1' }],
  },
  {
    id: 105264,
    name: 'The Last of Us Part II',
    slug: 'the-last-of-us-part-ii',
    first_release_date: 1592524800,
    rating: 89.9,
    cover: { image_id: 'co28n8' },
    genres: [{ name: 'Adventure' }, { name: 'Shooter' }],
    platforms: [{ id: 48, name: 'PlayStation 4', slug: 'ps4--1' }],
  },
  {
    id: 26192,
    name: 'Returnal',
    slug: 'returnal',
    first_release_date: 1619654400,
    rating: 86.0,
    cover: { image_id: 'co2wnj' },
    genres: [{ name: 'Shooter' }],
    platforms: [{ id: 167, name: 'PlayStation 5', slug: 'ps5' }],
  },
  {
    id: 7419,
    name: 'Dota 2',
    slug: 'dota-2',
    first_release_date: 1373414400,
    cover: { image_id: 'co1tmz' },
    genres: [{ name: 'Strategy' }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)', slug: 'win' }],
    external_games: [{ category: 1, uid: '570' }],
  },
  {
    // Present so the version-marker guard has a plausible wrong answer to
    // refuse when "Resident Evil 4 Remake" is looked up.
    id: 19686,
    name: 'Resident Evil 4',
    slug: 'resident-evil-4',
    first_release_date: 1107302400,
    rating: 93.0,
    cover: { image_id: 'co1rs1' },
    genres: [{ name: 'Shooter' }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)', slug: 'win' }],
  },
  {
    id: 55338,
    name: "Marvel's Spider-Man: Miles Morales",
    slug: 'marvels-spider-man-miles-morales',
    first_release_date: 1605139200,
    rating: 85.5,
    cover: { image_id: 'co2mvt' },
    genres: [{ name: 'Adventure' }],
    platforms: [{ id: 167, name: 'PlayStation 5', slug: 'ps5' }],
  },
];

/** Crude relevance filter, standing in for IGDB's own search ranking. */
function search(term: string) {
  const needle = term.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const words = needle.split(/\s+/).filter((word) => word.length > 2);

  return CATALOGUE.filter((game) => {
    const haystack = game.name.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    return words.some((word) => haystack.includes(word));
  }).slice(0, 10);
}

const stubFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);

  if (url.includes('id.twitch.tv')) {
    return new Response(
      JSON.stringify({ access_token: 'stub-token', expires_in: 5184000, token_type: 'bearer' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  const body = String(init?.body ?? '');
  const term = /search "([^"]*)"/.exec(body)?.[1] ?? '';

  return new Response(JSON.stringify(search(term)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as unknown as typeof fetch;

async function main(): Promise<void> {
  const igdb = new IgdbClient({
    clientId: 'stub-client',
    clientSecret: 'stub-secret',
    fetchImpl: stubFetch,
  });

  const before = await prisma.game.count({ where: { igdbId: null, mergedIntoId: null } });
  console.log(`${before} provisional games before enrichment.\n`);

  const results = await enrichProvisionalGames(prisma, igdb, { limit: 100 });

  for (const result of results) {
    const game = await prisma.game.findUnique({
      where: { id: result.gameId },
      select: { name: true },
    });
    const score = result.score !== undefined ? ` (${result.score.toFixed(3)})` : '';
    const reason = result.reason ? ` — ${result.reason}` : '';
    console.log(`  ${result.outcome.padEnd(10)} ${game?.name ?? result.gameId}${score}${reason}`);
  }

  const after = await prisma.game.count({ where: { igdbId: null, mergedIntoId: null } });
  const withGenres = await prisma.game.count({
    where: { mergedIntoId: null, genres: { isEmpty: false } },
  });

  console.log(`\n${after} provisional games remain. ${withGenres} now have genres.`);
}

main()
  .catch((error: unknown) => {
    console.error('Enrichment demo failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

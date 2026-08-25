/**
 * Development seed: runs a real sync against fixture data.
 *
 * This is not a mock of the pipeline - it is the pipeline. A SteamProvider is
 * constructed with a stubbed `fetch` that serves the contract fixtures, and the
 * genuine SyncRunner resolves, upserts and records provenance against the real
 * database.
 *
 * That makes it useful for two things: giving a fresh install something to look
 * at, and exercising resolution and upsert behaviour end to end without needing
 * a Steam API key.
 *
 *   pnpm --filter @omniplay/worker demo
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '@omniplay/database';
import { SteamProvider } from '@omniplay/providers';
import { SyncRunner } from '../ingest/sync-runner.js';

const FIXTURES = fileURLToPath(
  new URL('../../../../packages/providers/fixtures/steam/', import.meta.url),
);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8'));
}

/** A larger library than the test fixture, so the dashboard has some shape. */
const DEMO_LIBRARY = {
  response: {
    game_count: 8,
    games: [
      { appid: 1091500, name: 'Cyberpunk 2077', playtime_forever: 10920, playtime_2weeks: 340, img_icon_url: 'a1', rtime_last_played: 1755820800 },
      { appid: 1245620, name: 'ELDEN RING', playtime_forever: 14820, playtime_2weeks: 120, img_icon_url: 'a2', rtime_last_played: 1753142400 },
      { appid: 292030, name: 'The Witcher 3: Wild Hunt - Game of the Year Edition', playtime_forever: 9600, img_icon_url: 'a3', rtime_last_played: 1690000000 },
      { appid: 1174180, name: 'Red Dead Redemption 2', playtime_forever: 7380, img_icon_url: 'a4', rtime_last_played: 1700000000 },
      { appid: 1086940, name: "Baldur's Gate 3", playtime_forever: 12600, img_icon_url: 'a5', rtime_last_played: 1748000000 },
      { appid: 413150, name: 'Stardew Valley', playtime_forever: 3120, img_icon_url: 'a6', rtime_last_played: 1720000000 },
      { appid: 570, name: 'Dota 2', playtime_forever: 0, img_icon_url: 'a7', rtime_last_played: 0 },
      { appid: 2050650, name: 'Resident Evil 4 Remake', playtime_forever: 2400, img_icon_url: 'a8', rtime_last_played: 1740000000 },
    ],
  },
};

/** Routes the adapter's requests to fixture payloads. */
const stubFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  if (url.includes('GetOwnedGames')) return json(DEMO_LIBRARY);
  if (url.includes('GetPlayerSummaries')) return json(fixture('profile'));
  if (url.includes('GetPlayerAchievements')) {
    // Only Cyberpunk has achievement data in the fixtures; everything else
    // returns Steam's "no stats" 400, which the adapter treats as empty.
    return url.includes('appid=1091500')
      ? json(fixture('achievements'))
      : new Response('no stats', { status: 400 });
  }
  return new Response('not found', { status: 404 });
}) as unknown as typeof fetch;

async function main(): Promise<void> {
  const email = process.argv[2] ?? 'aryan@example.com';

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(
      `No user with email ${email}. Register through the web app first, or pass an email:\n` +
        '  pnpm --filter @omniplay/worker demo you@example.com',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Seeding a demo Steam library for ${user.username}...`);

  const account = await prisma.connectedAccount.upsert({
    where: { userId_provider: { userId: user.id, provider: 'steam' } },
    create: {
      userId: user.id,
      provider: 'steam',
      providerUserId: '76561198000000000',
      displayName: 'aryan (demo)',
      status: 'ACTIVE',
    },
    update: { status: 'ACTIVE' },
  });
  // Steam issues no user token, so an empty credential row is correct here.
  await prisma.providerCredential.upsert({
    where: { connectedAccountId: account.id },
    create: { connectedAccountId: account.id },
    update: {},
  });

  const job = await prisma.syncJob.create({
    data: { userId: user.id, provider: 'steam', status: 'QUEUED', connectedAccountId: account.id },
  });

  const provider = new SteamProvider({
    apiKey: 'demo-key',
    realm: 'http://localhost:4000',
    fetchImpl: stubFetch,
  });

  const runner = new SyncRunner({ prisma });
  const stats = await runner.run(provider, {
    syncJobId: job.id,
    userId: user.id,
    provider: 'steam',
    full: true,
    includeAchievements: true,
  });

  console.log('\nSync complete:');
  console.table(stats);

  const games = await prisma.game.count();
  const ownerships = await prisma.ownership.count({ where: { userId: user.id } });
  const activities = await prisma.playActivity.count({ where: { userId: user.id } });
  console.log(`\n${games} canonical games, ${ownerships} ownerships, ${activities} activities.`);
  console.log('Open http://localhost:3000/dashboard to see it.');
}

main()
  .catch((error: unknown) => {
    console.error('Demo sync failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

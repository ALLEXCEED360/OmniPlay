/**
 * Checks that OMNIPLAY is configured correctly, and says what to do about
 * anything that is not.
 *
 *   pnpm doctor
 *
 * Credentials are read from the environment and never printed. Where a
 * credential can be validated cheaply against the real service — a Steam key,
 * a Twitch app — it is, because "the variable is set" and "the variable works"
 * are very different things, and the second is the one that matters.
 */

import { prisma } from '@omniplay/database';
import { Redis } from 'ioredis';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const checks: Check[] = [];

function record(check: Check): void {
  checks.push(check);
}

/* ------------------------------------------------------------------ *
 * Infrastructure
 * ------------------------------------------------------------------ */

async function checkDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    record({
      name: 'Database',
      status: 'fail',
      detail: 'DATABASE_URL is not set.',
      fix: 'Copy .env.example to .env.',
    });
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;

    // A reachable database with no tables means migrations have not run, which
    // looks identical to "broken" from the app's side.
    const games = await prisma.game.count();
    const users = await prisma.user.count();

    record({
      name: 'Database',
      status: 'ok',
      detail: `Connected. ${users} user(s), ${games} game(s).`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record({
      name: 'Database',
      status: 'fail',
      detail: message.split('\n')[0] ?? 'Could not connect.',
      fix: 'Run: pnpm infra:up && pnpm db:push && pnpm db:seed',
    });
  }
}

async function checkRedis(): Promise<void> {
  if (!process.env.REDIS_URL) {
    record({ name: 'Redis', status: 'fail', detail: 'REDIS_URL is not set.' });
    return;
  }

  const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    await redis.ping();
    record({ name: 'Redis', status: 'ok', detail: 'Connected. Sync jobs can queue.' });
  } catch {
    record({
      name: 'Redis',
      status: 'fail',
      detail: 'Could not connect.',
      fix: 'Run: pnpm infra:up',
    });
  } finally {
    redis.disconnect();
  }
}

function checkSecrets(): void {
  for (const name of ['SESSION_SECRET', 'CREDENTIAL_ENCRYPTION_KEY']) {
    const value = process.env[name];
    if (!value) {
      record({
        name,
        status: 'fail',
        detail: 'Not set.',
        fix: `Generate one with: openssl rand -base64 32`,
      });
    } else if (value.length < 32) {
      record({
        name,
        status: 'fail',
        detail: `Too short (${value.length} characters, needs 32+).`,
        fix: 'Generate one with: openssl rand -base64 32',
      });
    } else {
      record({ name, status: 'ok', detail: 'Set.' });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

async function checkSteam(): Promise<void> {
  const key = process.env.STEAM_API_KEY;

  if (!key) {
    record({
      name: 'Steam',
      status: 'warn',
      detail: 'Not configured, so your Steam library cannot be imported.',
      fix: 'Get a key at https://steamcommunity.com/dev/apikey and set STEAM_API_KEY in .env',
    });
    return;
  }

  // Validated against a well-known public profile: it proves the key works
  // without needing the user's own SteamID.
  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  url.searchParams.set('key', key);
  url.searchParams.set('steamids', '76561197960435530');

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (response.status === 403) {
      record({
        name: 'Steam',
        status: 'fail',
        detail: 'Steam rejected the API key.',
        fix: 'Check STEAM_API_KEY for typos or extra spaces, or regenerate it.',
      });
      return;
    }
    if (!response.ok) {
      record({
        name: 'Steam',
        status: 'warn',
        detail: `Steam returned ${response.status}. It may be having trouble.`,
      });
      return;
    }

    record({ name: 'Steam', status: 'ok', detail: 'API key works.' });
  } catch {
    record({
      name: 'Steam',
      status: 'warn',
      detail: 'Could not reach Steam to check the key.',
      fix: 'Check your internet connection.',
    });
  }
}

async function checkIgdb(): Promise<void> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    record({
      name: 'IGDB',
      status: 'warn',
      detail: 'Not configured. Games will import with thin metadata: no cover art, no genres.',
      fix: 'Create an app at https://dev.twitch.tv/console/apps and set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET',
    });
    return;
  }

  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  try {
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      record({
        name: 'IGDB',
        status: 'fail',
        detail: `Twitch rejected the credentials (${response.status}).`,
        fix: 'Check IGDB_CLIENT_ID and IGDB_CLIENT_SECRET against your Twitch app.',
      });
      return;
    }
    record({ name: 'IGDB', status: 'ok', detail: 'Credentials work.' });
  } catch {
    record({ name: 'IGDB', status: 'warn', detail: 'Could not reach Twitch to check.' });
  }
}

async function checkXbox(): Promise<void> {
  const openXbl = process.env.OPENXBL_API_KEY;

  // The OpenXBL route can actually be validated, unlike an Azure client id,
  // because the key alone is enough to make a real call.
  if (openXbl) {
    try {
      const response = await fetch('https://xbl.io/api/v2/account', {
        headers: {
          'X-Authorization': openXbl,
          accept: 'application/json',
          // Xbox rejects the wildcard locale fetch would otherwise imply.
          'accept-language': 'en-US',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (response.status === 401 || response.status === 403) {
        record({
          name: 'Xbox',
          status: 'fail',
          detail: 'OpenXBL rejected the API key.',
          fix: 'Check OPENXBL_API_KEY, or generate a new one at https://xbl.io',
        });
        return;
      }
      if (!response.ok) {
        record({
          name: 'Xbox',
          status: 'warn',
          detail: `OpenXBL returned ${response.status}.`,
        });
        return;
      }

      record({ name: 'Xbox', status: 'ok', detail: 'OpenXBL key works.' });
      return;
    } catch {
      record({ name: 'Xbox', status: 'warn', detail: 'Could not reach OpenXBL to check.' });
      return;
    }
  }

  if (process.env.XBOX_CLIENT_ID) {
    // Nothing to validate without a user completing the sign-in flow.
    record({
      name: 'Xbox',
      status: 'ok',
      detail: 'Azure client id set. Connect from Settings to verify the full flow.',
    });
    return;
  }

  record({
    name: 'Xbox',
    status: 'warn',
    detail: 'Not configured, so Xbox achievements cannot be imported.',
    fix: 'Easiest: get a free key at https://xbl.io and set OPENXBL_API_KEY in .env',
  });
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const ICONS: Record<Status, string> = { ok: '  OK  ', warn: ' WARN ', fail: ' FAIL ' };

async function main(): Promise<void> {
  console.log('\nOMNIPLAY setup check\n' + '='.repeat(60));

  await checkDatabase();
  await checkRedis();
  checkSecrets();
  await checkSteam();
  await checkXbox();
  await checkIgdb();

  console.log();
  for (const check of checks) {
    console.log(`[${ICONS[check.status]}] ${check.name.padEnd(26)} ${check.detail}`);
    if (check.fix && check.status !== 'ok') {
      console.log(`${' '.repeat(11)}→ ${check.fix}`);
    }
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');

  console.log('\n' + '='.repeat(60));

  if (failed.length > 0) {
    console.log(`${failed.length} problem(s) must be fixed before OMNIPLAY will run.`);
    process.exitCode = 1;
    return;
  }

  if (warned.length > 0) {
    console.log(
      `Ready to run. ${warned.length} platform(s) not configured — that is fine, ` +
        'they simply will not appear as connectable.',
    );
    return;
  }

  console.log('Everything is configured. Connect an account from Settings.');
}

main()
  .catch((error: unknown) => {
    console.error('Setup check failed to run:', error);
    process.exitCode = 1;
  })
  // The shared Prisma client holds a connection pool open, which would keep
  // the process alive after the report has printed.
  .finally(() => void prisma.$disconnect());

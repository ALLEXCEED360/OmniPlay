/**
 * Captures real OpenXBL responses so the adapter is written against fact.
 *
 *   pnpm --filter @omniplay/worker probe:xbox
 *
 * Reads OPENXBL_API_KEY from the environment and never prints it. Writes the
 * responses to packages/providers/fixtures/xbox/ so they can back the contract
 * tests, exactly as the Steam and IGDB fixtures do.
 *
 * This exists because the last integration was built from a remembered schema:
 * IGDB had renamed `external_games.category` to `external_game_source`, every
 * enrichment failed, and the hand-written fixtures happily agreed with the
 * mistake. Capturing first is cheaper than debugging afterwards.
 *
 * The free tier allows 150 requests an hour, so this probes a handful of
 * endpoints once each and stops.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'https://xbl.io/api/v2';
const OUT = fileURLToPath(new URL('../../../../packages/providers/fixtures/xbox/', import.meta.url));

interface Probe {
  name: string;
  path: string;
  /** Filled in from an earlier probe's result, e.g. the caller's own XUID. */
  needsXuid?: boolean;
  needsTitleId?: boolean;
}

const PROBES: Probe[] = [
  { name: 'account', path: '/account' },
  { name: 'player-titles', path: '/player/titleHistory', needsXuid: true },
  { name: 'achievements-player', path: '/achievements/player/{xuid}', needsXuid: true },
  { name: 'achievements-title', path: '/achievements/player/{xuid}/{titleId}', needsXuid: true, needsTitleId: true },
];

/** Trims a response to something readable while keeping its shape intact. */
function sample(value: unknown, arrayLimit = 3): unknown {
  if (Array.isArray(value)) return value.slice(0, arrayLimit).map((item) => sample(item, arrayLimit));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        sample(val, arrayLimit),
      ]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  const key = process.env.OPENXBL_API_KEY;
  if (!key) {
    console.error(
      'OPENXBL_API_KEY is not set.\n' +
        'Get a key at https://xbl.io (sign in with your Microsoft account),\n' +
        'then add it to .env as OPENXBL_API_KEY="..." and run this again.',
    );
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT, { recursive: true });

  let xuid: string | undefined;
  let titleId: string | undefined;

  for (const probe of PROBES) {
    if (probe.needsXuid && !xuid) {
      console.log(`SKIP  ${probe.name} — no XUID discovered yet`);
      continue;
    }
    if (probe.needsTitleId && !titleId) {
      console.log(`SKIP  ${probe.name} — no title id discovered yet`);
      continue;
    }

    const path = probe.path
      .replace('{xuid}', xuid ?? '')
      .replace('{titleId}', titleId ?? '');

    try {
      const response = await fetch(`${BASE}${path}`, {
        headers: {
          'X-Authorization': key,
          accept: 'application/json',
          // Xbox rejects the wildcard locale Node's fetch sends by default:
          // "Accept-Language header with invalid locale value: *".
          'accept-language': 'en-US',
        },
        signal: AbortSignal.timeout(20_000),
      });

      const text = await response.text();

      if (!response.ok) {
        console.log(`FAIL  ${probe.name.padEnd(20)} ${response.status}  ${text.slice(0, 160)}`);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        console.log(`FAIL  ${probe.name.padEnd(20)} response was not JSON`);
        continue;
      }

      writeFileSync(`${OUT}${probe.name}.json`, JSON.stringify(sample(parsed), null, 2));

      const topKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
      console.log(`OK    ${probe.name.padEnd(20)} keys: ${topKeys.join(', ').slice(0, 90)}`);

      // Discover the identifiers later probes need, without a second request.
      if (probe.name === 'account') {
        xuid = findXuid(parsed);
        console.log(`      -> discovered XUID: ${xuid ? 'yes' : 'no'}`);
      }
      if (probe.name === 'player-titles') {
        titleId = findTitleId(parsed);
        console.log(`      -> discovered titleId: ${titleId ?? 'none'}`);
      }
    } catch (error) {
      console.log(
        `FAIL  ${probe.name.padEnd(20)} ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Well under the free tier's 150/hour, and polite regardless.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  console.log(`\nFixtures written to packages/providers/fixtures/xbox/`);
  console.log('These are sampled and may contain your gamertag — review before committing.');
}

/** Digs the caller's XUID out of whatever shape /account returns. */
function findXuid(payload: unknown): string | undefined {
  const seen = JSON.stringify(payload);
  const direct = /"(?:xuid|id)"\s*:\s*"?(\d{15,})"?/.exec(seen);
  return direct?.[1];
}

function findTitleId(payload: unknown): string | undefined {
  const seen = JSON.stringify(payload);
  const match = /"titleId"\s*:\s*"?(\d+)"?/.exec(seen);
  return match?.[1];
}

main().catch((error: unknown) => {
  console.error('Probe failed:', error);
  process.exitCode = 1;
});

/**
 * Links a Steam account by SteamID64, without the OpenID sign-in.
 *
 *   pnpm --filter @omniplay/worker link:steam you@example.com 7656119...
 *
 * Steam's Web API only ever needs a SteamID64, which is public information —
 * the OpenID round-trip exists to *prove* the person signing in owns that
 * account. That proof matters for a hosted service, where anyone could
 * otherwise claim any SteamID. On a local instance run by the account's owner
 * it is ceremony, so this offers a direct path.
 *
 * It is deliberately a dev script rather than an API route: exposing
 * "link any SteamID to my account" over HTTP would let a user claim someone
 * else's library, which is exactly what `verifySteamCallback` prevents.
 */

import { prisma } from '@omniplay/database';

const STEAMID64 = /^\d{17}$/;

async function main(): Promise<void> {
  const email = process.argv[2];
  const steamId = process.argv[3];

  if (!email || !steamId) {
    console.error(
      'Usage: pnpm --filter @omniplay/worker link:steam <email> <steamid64>\n' +
        'Find your SteamID64 in your profile URL: steamcommunity.com/profiles/<id>',
    );
    process.exitCode = 1;
    return;
  }

  if (!STEAMID64.test(steamId)) {
    console.error(
      `"${steamId}" is not a SteamID64. It should be 17 digits.\n` +
        'If your profile uses a custom URL (/id/name), open it and use the /profiles/ form instead.',
    );
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    console.error('STEAM_API_KEY is not set. Run `pnpm doctor` for setup steps.');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, username: true },
  });
  if (!user) {
    console.error(`No OMNIPLAY user with email ${email}.`);
    process.exitCode = 1;
    return;
  }

  // Confirm the account exists and is readable before writing anything, so a
  // typo does not leave a dead connection behind.
  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', steamId);

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    console.error(`Steam returned ${response.status}. Check STEAM_API_KEY.`);
    process.exitCode = 1;
    return;
  }

  const player = ((await response.json()) as {
    response: { players: Array<{ personaname?: string; avatarfull?: string; profileurl?: string; communityvisibilitystate?: number }> };
  }).response.players[0];

  if (!player) {
    console.error(`Steam has no profile for ${steamId}.`);
    process.exitCode = 1;
    return;
  }

  if ((player.communityvisibilitystate ?? 3) < 3) {
    console.warn(
      'Warning: this profile is not public. Steam will return an empty library ' +
        'until "Game details" is set to Public in your Steam privacy settings.',
    );
  }

  // The unique index on (provider, providerUserId) means a SteamID can only
  // belong to one OMNIPLAY user; report that clearly rather than as a crash.
  const claimed = await prisma.connectedAccount.findUnique({
    where: { provider_providerUserId: { provider: 'steam', providerUserId: steamId } },
    select: { userId: true },
  });
  if (claimed && claimed.userId !== user.id) {
    console.error('That SteamID is already linked to a different OMNIPLAY user.');
    process.exitCode = 1;
    return;
  }

  const account = await prisma.connectedAccount.upsert({
    where: { userId_provider: { userId: user.id, provider: 'steam' } },
    create: {
      userId: user.id,
      provider: 'steam',
      providerUserId: steamId,
      displayName: player.personaname ?? null,
      avatar: player.avatarfull ?? null,
      profileUrl: player.profileurl ?? null,
      status: 'ACTIVE',
    },
    update: {
      providerUserId: steamId,
      displayName: player.personaname ?? null,
      avatar: player.avatarfull ?? null,
      profileUrl: player.profileurl ?? null,
      status: 'ACTIVE',
      statusMessage: null,
    },
  });

  // Steam issues no user token — access is via our publisher key — so the
  // credential row exists but is empty by design.
  await prisma.providerCredential.upsert({
    where: { connectedAccountId: account.id },
    create: { connectedAccountId: account.id },
    update: {},
  });

  console.log(`Linked ${player.personaname ?? steamId} to ${user.username}.`);
  console.log('Run a sync from the dashboard, or: pnpm --filter @omniplay/worker sync ' + email);
}

main()
  .catch((error: unknown) => {
    console.error('Linking failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

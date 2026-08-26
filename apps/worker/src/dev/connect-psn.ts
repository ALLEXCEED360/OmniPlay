/**
 * Connects the PlayStation account this instance's npsso belongs to.
 *
 *   pnpm --filter @omniplay/worker connect:psn you@example.com
 *
 * A dev script rather than an API route, for the same reason link-steam is:
 * the npsso identifies exactly one account, so "connect PlayStation" over HTTP
 * would let any signed-in user claim it.
 */

import { prisma, toCredentialRow } from '@omniplay/database';
import { PsnProvider } from '@omniplay/providers';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: pnpm --filter @omniplay/worker connect:psn <email>');
    process.exitCode = 1;
    return;
  }

  const npsso = process.env.PSN_NPSSO;
  if (!npsso) {
    console.error('PSN_NPSSO is not set. Run `pnpm doctor` for how to obtain one.');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.error(`No OMNIPLAY user with email ${email}.`);
    process.exitCode = 1;
    return;
  }

  const provider = new PsnProvider({ npsso });
  const result = await provider.connectDirect();

  const account = await prisma.connectedAccount.upsert({
    where: { userId_provider: { userId: user.id, provider: 'psn' } },
    create: {
      userId: user.id,
      provider: 'psn',
      providerUserId: result.account.providerUserId,
      displayName: result.account.displayName,
      status: 'ACTIVE',
    },
    update: {
      providerUserId: result.account.providerUserId,
      displayName: result.account.displayName,
      status: 'ACTIVE',
      statusMessage: null,
    },
  });

  // Credentials hang off the connected account, not off user+provider.
  const row = toCredentialRow(result.credentials);
  await prisma.providerCredential.upsert({
    where: { connectedAccountId: account.id },
    create: { connectedAccountId: account.id, ...row },
    update: row,
  });

  console.log(`Connected PlayStation account ${result.account.displayName} to ${email}.`);
  console.log('Now run: pnpm --filter @omniplay/worker sync ' + email + ' psn');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

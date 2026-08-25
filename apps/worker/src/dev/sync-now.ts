/**
 * Queues a sync from the command line and waits for it to finish.
 *
 *   pnpm --filter @omniplay/worker sync you@example.com          # every provider
 *   pnpm --filter @omniplay/worker sync you@example.com steam    # just one
 *
 * The dashboard's Sync button does the same thing; this exists so a sync can
 * be run and watched without a browser, which is what you want when checking
 * whether a newly configured provider actually works.
 */

import { Queue } from 'bullmq';
import { prisma } from '@omniplay/database';
import { SYNC_QUEUE, type SyncJobPayload } from '@omniplay/types';

async function main(): Promise<void> {
  const email = process.argv[2];
  const onlyProvider = process.argv[3];

  if (!email) {
    console.error('Usage: pnpm --filter @omniplay/worker sync <email> [provider]');
    process.exitCode = 1;
    return;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('REDIS_URL is not set.');
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

  const accounts = await prisma.connectedAccount.findMany({
    where: {
      userId: user.id,
      ...(onlyProvider ? { provider: onlyProvider } : {}),
      status: { in: ['ACTIVE', 'REAUTH_REQUIRED'] },
    },
  });

  if (accounts.length === 0) {
    console.error(
      onlyProvider
        ? `${user.username} has no ${onlyProvider} account connected.`
        : `${user.username} has no connected accounts. Connect one from Settings first.`,
    );
    process.exitCode = 1;
    return;
  }

  const queue = new Queue<SyncJobPayload>(SYNC_QUEUE, { connection: { url: redisUrl } });
  const jobIds: string[] = [];

  for (const account of accounts) {
    const job = await prisma.syncJob.create({
      data: {
        userId: user.id,
        provider: account.provider,
        connectedAccountId: account.id,
        status: 'QUEUED',
        phase: 'queued',
      },
    });

    await queue.add(
      `sync:${account.provider}`,
      {
        syncJobId: job.id,
        userId: user.id,
        provider: account.provider,
        full: true,
        includeAchievements: true,
      },
      { jobId: job.id },
    );

    jobIds.push(job.id);
    console.log(`Queued ${account.provider} (${account.displayName ?? account.providerUserId})`);
  }

  console.log('\nWaiting for the worker to finish. Make sure it is running.\n');

  // Poll rather than subscribe: the job rows are the source of truth the UI
  // reads too, so watching them checks the same thing a user would see.
  const deadline = Date.now() + 10 * 60 * 1000;
  const done = new Set<string>();

  while (done.size < jobIds.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const jobs = await prisma.syncJob.findMany({ where: { id: { in: jobIds } } });
    for (const job of jobs) {
      if (done.has(job.id)) continue;

      if (job.status === 'RUNNING' || job.status === 'QUEUED') {
        process.stdout.write(
          `\r  ${job.provider}: ${job.phase ?? job.status.toLowerCase()} — ${job.recordsFetched} fetched   `,
        );
        continue;
      }

      done.add(job.id);
      process.stdout.write('\r' + ' '.repeat(70) + '\r');

      if (job.status === 'FAILED') {
        console.log(`  ${job.provider}: FAILED — ${job.error ?? 'no reason recorded'}`);
      } else {
        console.log(
          `  ${job.provider}: ${job.status} — ${job.recordsFetched} fetched, ` +
            `${job.recordsCreated} created, ${job.recordsUpdated} updated, ${job.recordsFailed} failed`,
        );
      }
    }
  }

  if (done.size < jobIds.length) {
    console.log('\nStill running after 10 minutes. Check the worker output.');
  }

  const games = await prisma.ownership.count({ where: { userId: user.id } });
  console.log(`\n${user.username} now has ${games} owned game(s). Open /library to see them.`);

  await queue.close();
}

main()
  .catch((error: unknown) => {
    console.error('Sync failed to start:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { createImportRecordLoader, markBatchProcessed, prisma } from '@omniplay/database';
import { createProviderRegistry, IgdbClient } from '@omniplay/providers';
import {
  METADATA_QUEUE,
  ProviderError,
  SYNC_EVENTS_CHANNEL,
  SYNC_QUEUE,
  type MetadataJobPayload,
  type SyncJobPayload,
  type SyncProgressEvent,
} from '@omniplay/types';
import { SyncRunner } from './ingest/sync-runner.js';
import { enrichProvisionalGames } from './ingest/metadata-enrichment.js';
import { reconcileInterruptedJobs } from './ingest/interrupted-jobs.js';

/**
 * The sync worker.
 *
 * Runs as its own process so a long Steam import cannot occupy an API request
 * thread, and so workers scale independently of the web tier (spec 11, 27).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to start the worker.`);
  return value;
}

const REDIS_URL = requireEnv('REDIS_URL');
requireEnv('DATABASE_URL');
requireEnv('CREDENTIAL_ENCRYPTION_KEY');

// The same loader the API uses, so file-backed providers behave identically
// on both sides (spec 5.3).
const registry = createProviderRegistry(process.env, {
  loadImportRecords: createImportRecordLoader(prisma),
});

const igdb =
  process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET
    ? new IgdbClient({
        clientId: process.env.IGDB_CLIENT_ID,
        clientSecret: process.env.IGDB_CLIENT_SECRET,
      })
    : undefined;

if (!igdb) {
  console.warn(
    'IGDB is not configured. Games will still import, but with provider metadata only ' +
      'and weaker cross-platform matching. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET.',
  );
}

const publisher = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const runner = new SyncRunner({
  prisma,
  igdb,
  publish: async (event: SyncProgressEvent) => {
    await publisher.publish(SYNC_EVENTS_CHANNEL, JSON.stringify(event));
  },
});

const worker = new Worker<SyncJobPayload>(
  SYNC_QUEUE,
  async (job: Job<SyncJobPayload>) => {
    const { syncJobId, userId, provider, full, includeAchievements } = job.data;
    const adapter = registry.find(provider);

    if (!adapter) {
      // A job for a provider this instance no longer configures: fail it
      // permanently rather than retrying forever.
      await failJob(syncJobId, `${provider} is not configured on this instance.`, 'UNAVAILABLE');
      return;
    }

    try {
      const stats = await runner.run(adapter, {
        syncJobId,
        userId,
        provider,
        full,
        includeAchievements,
      });
      // A consumed import must not be re-ingested by the next sync.
      if (adapter.capabilities.importOnly) {
        await markBatchProcessed(prisma, userId, provider);
      }

      console.log(
        `[sync ${syncJobId}] ${provider}: ${stats.fetched} fetched, ${stats.created} created, ` +
          `${stats.updated} updated, ${stats.failed} failed, ${stats.unresolved} unresolved`,
      );
      return stats;
    } catch (error) {
      await handleFailure(syncJobId, userId, provider, error);
      throw error;
    }
  },
  {
    connection: { url: REDIS_URL },
    // Modest concurrency: each job is mostly waiting on a rate-limited
    // provider, and the limiters are per-adapter, not per-job.
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  },
);

/**
 * IGDB metadata enrichment.
 *
 * A separate worker on a separate queue: an admin backfilling 500 games must
 * never delay a user's sync, and the two are throttled by different limits.
 * Concurrency is 1 because IGDB allows 4 requests/second and running these in
 * parallel would only queue inside the client's own limiter.
 */
const metadataWorker = igdb
  ? new Worker<MetadataJobPayload>(
      METADATA_QUEUE,
      async (job: Job<MetadataJobPayload>) => {
        const results = await enrichProvisionalGames(prisma, igdb, {
          ...(job.data.gameIds ? { gameIds: job.data.gameIds } : {}),
          ...(job.data.limit ? { limit: job.data.limit } : {}),
        });

        const tally = results.reduce<Record<string, number>>((acc, result) => {
          acc[result.outcome] = (acc[result.outcome] ?? 0) + 1;
          return acc;
        }, {});

        console.log(`[metadata ${job.id}] ${results.length} processed:`, tally);
        return tally;
      },
      { connection: { url: REDIS_URL }, concurrency: 1 },
    )
  : null;

if (!metadataWorker) {
  console.warn('Metadata enrichment is disabled because IGDB is not configured.');
}

/** Translates a failure into a user-readable SyncJob row (spec 14). */
async function handleFailure(
  syncJobId: string,
  userId: string,
  provider: string,
  error: unknown,
): Promise<void> {
  const providerError = error instanceof ProviderError ? error : null;

  const message = providerError
    ? providerError.message
    : 'Something went wrong during sync. Your existing data is safe.';

  await failJob(syncJobId, message, providerError?.kind ?? 'UNKNOWN');

  // An expired authorisation needs the user to act, so the connection is
  // flagged rather than silently retried.
  if (providerError?.needsReauth) {
    await prisma.connectedAccount
      .update({
        where: { userId_provider: { userId, provider } },
        data: {
          status: 'REAUTH_REQUIRED',
          statusMessage: 'Authorisation expired. Reconnect to resume syncing.',
        },
      })
      .catch(() => {});
  }
}

async function failJob(syncJobId: string, message: string, errorKind: string): Promise<void> {
  await prisma.syncJob
    .update({
      where: { id: syncJobId },
      data: {
        status: 'FAILED',
        phase: 'failed',
        finishedAt: new Date(),
        error: message,
        errorKind,
      },
    })
    .catch(() => {});
}

worker.on('failed', (job, error) => {
  console.error(`[sync] job ${job?.id} failed: ${error.message}`);
});

worker.on('ready', () => {
  console.log(
    `OMNIPLAY worker ready. Providers: ${registry.ids.join(', ') || 'none configured'}`,
  );

  // Anything left mid-flight by a previous process is settled here. A worker
  // that died holding a job cannot come back to it, and the row saying
  // otherwise is a claim the dashboard repeats.
  void reconcileInterruptedJobs(prisma)
    .then(({ reconciled }) => {
      if (reconciled > 0) {
        console.log(
          `[sync] marked ${reconciled} interrupted job(s) as failed — ` +
            'they were still recorded as running when this worker started.',
        );
      }
    })
    .catch((error: unknown) => {
      // Startup housekeeping must never stop the worker from starting.
      console.error('[sync] could not reconcile interrupted jobs:', error);
    });
});

/** Drain in-flight jobs before exiting so a deploy does not lose work. */
async function shutdown(signal: string): Promise<void> {
  console.log(`\nReceived ${signal}, finishing in-flight jobs...`);
  await worker.close();
  await metadataWorker?.close();
  await publisher.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

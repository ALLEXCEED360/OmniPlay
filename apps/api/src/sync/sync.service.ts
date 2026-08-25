import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SYNC_QUEUE, type SyncJobPayload } from '@omniplay/types';
import { ProviderRegistry } from '@omniplay/providers';
import type { User } from '@omniplay/database';
import { PrismaService } from '../common/prisma.service.js';
import { PROVIDER_REGISTRY, SYNC_QUEUE_TOKEN } from '../common/tokens.js';

/**
 * Sync orchestration from the API side.
 *
 * The API's only jobs are to record a SyncJob row and enqueue work. Nothing
 * here talks to a provider: a full Steam library sync can take minutes, and
 * spec 11 is explicit that the user must never wait on it inside an HTTP
 * request.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SYNC_QUEUE_TOKEN) private readonly queue: Queue<SyncJobPayload>,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  /** Queues one provider for a user, reusing an in-flight job if there is one. */
  async enqueue(
    userId: string,
    provider: string,
    options: { full?: boolean; includeAchievements?: boolean } = {},
  ) {
    const account = await this.prisma.client.connectedAccount.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!account) {
      throw new NotFoundException(`No ${provider} account is connected.`);
    }
    if (account.status === 'DISABLED' || account.status === 'REVOKED') {
      throw new BadRequestException(
        `Your ${provider} connection needs to be re-authorised before it can sync.`,
      );
    }

    // Queueing a second sync for the same provider would double every write
    // and race on the same rows; hand back the running job instead.
    const running = await this.prisma.client.syncJob.findFirst({
      where: { userId, provider, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (running) return running;

    const job = await this.prisma.client.syncJob.create({
      data: {
        userId,
        provider,
        connectedAccountId: account.id,
        status: 'QUEUED',
        phase: 'queued',
      },
    });

    await this.queue.add(
      `sync:${provider}`,
      {
        syncJobId: job.id,
        userId,
        provider,
        full: options.full ?? false,
        includeAchievements: options.includeAchievements ?? true,
      },
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86_400 },
      },
    );

    return job;
  }

  /** Queues every connected provider (the "Sync All" button). */
  async enqueueAll(userId: string, options: { full?: boolean } = {}) {
    const accounts = await this.prisma.client.connectedAccount.findMany({
      where: { userId, status: { in: ['ACTIVE', 'REAUTH_REQUIRED'] } },
      select: { provider: true },
    });

    if (accounts.length === 0) {
      throw new BadRequestException('Connect a gaming account before syncing.');
    }

    const jobs = [];
    for (const account of accounts) {
      // One provider being unavailable must not stop the others (spec 13).
      if (!this.registry.has(account.provider)) continue;
      jobs.push(await this.enqueue(userId, account.provider, options));
    }
    return jobs;
  }

  /** Recent sync history, for the progress UI and the error panel. */
  async recentJobs(userId: string, limit = 20) {
    return this.prisma.client.syncJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getJob(user: User, jobId: string) {
    const job = await this.prisma.client.syncJob.findUnique({ where: { id: jobId } });
    // Scoped to the owner: a job id must not be a way to read someone else's
    // sync history.
    if (!job || job.userId !== user.id) throw new NotFoundException('Sync job not found.');
    return job;
  }

  /** Provider health for the status panel (spec 13). */
  providerHealth() {
    return this.registry.list().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      status:
        'health' in provider && typeof provider.health === 'string'
          ? provider.health
          : 'operational',
    }));
  }
}

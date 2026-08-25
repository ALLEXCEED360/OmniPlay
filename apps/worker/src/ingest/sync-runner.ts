import {
  ProviderError,
  type ExternalGame,
  type GamingProvider,
  type ProviderId,
  type ProviderSession,
  type SyncProgressEvent,
} from '@omniplay/types';
import {
  createResolverPort,
  fromCredentialRow,
  needsRefresh,
  toCredentialRow,
  type PrismaClient,
} from '@omniplay/database';
import type { IgdbClient } from '@omniplay/providers';
import { resolveExternalGame } from './game-resolution.js';

/**
 * One provider sync, end to end (spec 11).
 *
 *   load credentials -> refresh if needed -> fetch -> normalise -> resolve
 *   -> upsert -> record provenance -> record statistics -> mark status
 *
 * Design commitments worth stating:
 *
 *  - **Partial success is a real outcome.** A library that imports 1,240 of
 *    1,248 games is far more useful than a sync that rolls back because eight
 *    titles failed to resolve. Per-game failures are counted, not fatal.
 *  - **Nothing is deleted.** A game that disappears from a provider is marked
 *    `removedAt`, becoming "previously owned" rather than vanishing (spec 2.4).
 *  - **Every write carries provenance.** Source, confidence and observation
 *    time travel with the row (spec 2.5).
 */

export interface SyncRunnerDeps {
  prisma: PrismaClient;
  igdb?: IgdbClient | undefined;
  /** Publishes progress for the sync UI; failures here are non-fatal. */
  publish?: (event: SyncProgressEvent) => void | Promise<void>;
}

export interface SyncRequest {
  syncJobId: string;
  userId: string;
  provider: ProviderId;
  full: boolean;
  includeAchievements: boolean;
}

export interface SyncStats {
  fetched: number;
  created: number;
  updated: number;
  failed: number;
  unresolved: number;
}

export class SyncRunner {
  constructor(private readonly deps: SyncRunnerDeps) {}

  async run(provider: GamingProvider, request: SyncRequest): Promise<SyncStats> {
    const { prisma } = this.deps;
    const stats: SyncStats = { fetched: 0, created: 0, updated: 0, failed: 0, unresolved: 0 };

    await prisma.syncJob.update({
      where: { id: request.syncJobId },
      data: { status: 'RUNNING', startedAt: new Date(), phase: 'authenticating' },
    });
    await this.report(request, 'authenticating', null, stats, 'RUNNING');

    const session = await this.loadSession(provider, request);

    // ---- Library -------------------------------------------------------
    await this.report(request, 'library', null, stats, 'RUNNING');
    const seenExternalIds = new Set<string>();
    const gameIdByExternalId = new Map<string, string>();

    for await (const game of provider.getLibrary(session, { full: request.full })) {
      stats.fetched++;
      seenExternalIds.add(game.externalId);

      try {
        const gameId = await this.ingestGame(request, provider.id, game, stats);
        gameIdByExternalId.set(game.externalId, gameId);
      } catch (error) {
        // One unparseable title must not cost the user their whole library.
        stats.failed++;
        this.logGameFailure(request, game, error);
      }

      // Progress is reported per batch, not per game: a 3,000-game library
      // would otherwise generate 3,000 Redis publishes and DB writes.
      if (stats.fetched % 50 === 0) {
        await this.report(request, 'library', null, stats, 'RUNNING');
        await prisma.syncJob.update({
          where: { id: request.syncJobId },
          data: {
            recordsFetched: stats.fetched,
            recordsCreated: stats.created,
            recordsUpdated: stats.updated,
            recordsFailed: stats.failed,
          },
        });
      }
    }

    // ---- Previously-owned detection ------------------------------------
    // Only meaningful after a complete read: an incremental sync legitimately
    // returns a subset, and marking the rest as removed would be wrong.
    if (seenExternalIds.size > 0) {
      await this.markMissingAsRemoved(request, seenExternalIds);
    }

    // ---- Play history --------------------------------------------------
    if (provider.getPlayHistory) {
      await this.report(request, 'playtime', null, stats, 'RUNNING');
      try {
        for await (const event of provider.getPlayHistory(session, { full: request.full })) {
          const gameId = gameIdByExternalId.get(event.externalGameId);
          // An activity for a title the library pass never yielded has nothing
          // to attach to; skipping beats inventing a canonical game for it.
          if (!gameId) continue;

          await this.upsertActivity(request, provider.id, gameId, event);
        }
      } catch (error) {
        stats.failed++;
        this.logPhaseFailure(request, 'playtime', error);
      }
    }

    // ---- Achievements --------------------------------------------------
    if (request.includeAchievements && provider.getAchievements) {
      await this.report(request, 'achievements', null, stats, 'RUNNING');
      await this.ingestAchievements(provider, session, request, gameIdByExternalId, stats);
    }

    // ---- Finalise ------------------------------------------------------
    await prisma.$transaction([
      prisma.syncJob.update({
        where: { id: request.syncJobId },
        data: {
          status: stats.failed > 0 ? 'PARTIAL' : 'SUCCEEDED',
          phase: 'done',
          progress: 100,
          finishedAt: new Date(),
          recordsFetched: stats.fetched,
          recordsCreated: stats.created,
          recordsUpdated: stats.updated,
          recordsFailed: stats.failed,
        },
      }),
      prisma.connectedAccount.update({
        where: { userId_provider: { userId: request.userId, provider: request.provider } },
        data: { lastSyncAt: new Date(), status: 'ACTIVE', statusMessage: null },
      }),
      prisma.syncCursor.upsert({
        where: {
          userId_provider_cursorType: {
            userId: request.userId,
            provider: request.provider,
            cursorType: 'library',
          },
        },
        create: {
          userId: request.userId,
          provider: request.provider,
          cursorType: 'library',
          lastSuccessfulSyncAt: new Date(),
        },
        update: { lastSuccessfulSyncAt: new Date() },
      }),
    ]);

    await this.report(
      request,
      'done',
      100,
      stats,
      stats.failed > 0 ? 'PARTIAL' : 'SUCCEEDED',
    );

    return stats;
  }

  /* ---------------------------------------------------------------- *
   * Steps
   * ---------------------------------------------------------------- */

  /** Loads credentials, refreshing them first when they are near expiry. */
  private async loadSession(
    provider: GamingProvider,
    request: SyncRequest,
  ): Promise<ProviderSession> {
    const { prisma } = this.deps;

    const account = await prisma.connectedAccount.findUnique({
      where: { userId_provider: { userId: request.userId, provider: request.provider } },
      include: { credential: true },
    });
    if (!account) {
      throw new ProviderError('AUTH_INVALID', `No ${request.provider} account is connected.`, {
        provider: request.provider,
      });
    }

    let credentials = fromCredentialRow(account.credential);

    if (needsRefresh(credentials) && provider.refreshCredentials) {
      const refreshed = await provider.refreshCredentials({
        providerUserId: account.providerUserId,
        credentials,
      });
      if (refreshed) {
        credentials = refreshed;
        const fields = toCredentialRow(refreshed);
        await prisma.providerCredential.upsert({
          where: { connectedAccountId: account.id },
          create: { connectedAccountId: account.id, ...fields },
          update: fields,
        });
      }
    }

    return { providerUserId: account.providerUserId, credentials };
  }

  /** Resolves one provider game and records ownership. */
  private async ingestGame(
    request: SyncRequest,
    provider: ProviderId,
    game: ExternalGame,
    stats: SyncStats,
  ): Promise<string> {
    const { prisma } = this.deps;

    const outcome = await resolveExternalGame(
      { prisma, port: createResolverPort(prisma), igdb: this.deps.igdb },
      provider,
      game,
    );
    if (!outcome.confident) stats.unresolved++;

    const now = new Date();

    // Xbox title history proves activity, not entitlement, so it must not
    // create an Ownership row (spec 5.2). Its games still reach the library
    // through PlayActivity.
    if (game.ownership) {
      const existing = await prisma.ownership.findUnique({
        where: {
          userId_provider_externalGameId: {
            userId: request.userId,
            provider,
            externalGameId: game.externalId,
          },
        },
        select: { id: true },
      });

      await prisma.ownership.upsert({
        where: {
          userId_provider_externalGameId: {
            userId: request.userId,
            provider,
            externalGameId: game.externalId,
          },
        },
        create: {
          userId: request.userId,
          gameId: outcome.gameId,
          provider,
          externalGameId: game.externalId,
          ownershipType: game.ownership.type,
          acquiredAt: game.ownership.acquiredAt ?? null,
          firstSeenAt: now,
          lastVerifiedAt: now,
          source: provider,
          confidence: game.confidence,
        },
        update: {
          gameId: outcome.gameId,
          ownershipType: game.ownership.type,
          lastVerifiedAt: now,
          // Seeing it again clears a previous removal: the user reacquired it.
          removedAt: null,
          confidence: game.confidence,
        },
      });

      if (existing) stats.updated++;
      else stats.created++;
    }

    // Steam reports a lifetime total on the library record itself rather than
    // as a play event, so it is captured here.
    if (game.minutesPlayedTotal && game.minutesPlayedTotal > 0) {
      await this.upsertActivity(request, provider, outcome.gameId, {
        externalGameId: game.externalId,
        activityType: 'LIFETIME_TOTAL',
        minutesPlayed: game.minutesPlayedTotal,
        endedAt: game.lastPlayedAt ?? null,
        confidence: game.confidence,
      });
    }

    return outcome.gameId;
  }

  /**
   * Writes an activity row idempotently.
   *
   * The dedupe key is what stops a re-sync from turning one lifetime total
   * into two rows and doubling the user's hours.
   */
  private async upsertActivity(
    request: SyncRequest,
    provider: ProviderId,
    gameId: string,
    event: {
      externalGameId: string;
      activityType: string;
      minutesPlayed?: number | null;
      startedAt?: Date | null;
      endedAt?: Date | null;
      confidence: string;
    },
  ): Promise<void> {
    const dedupeKey = buildDedupeKey(provider, event);

    await this.deps.prisma.playActivity.upsert({
      where: { userId_dedupeKey: { userId: request.userId, dedupeKey } },
      create: {
        userId: request.userId,
        gameId,
        provider,
        activityType: event.activityType as never,
        minutesPlayed: event.minutesPlayed ?? null,
        startedAt: event.startedAt ?? null,
        endedAt: event.endedAt ?? null,
        source: provider,
        confidence: event.confidence as never,
        dedupeKey,
      },
      update: {
        gameId,
        minutesPlayed: event.minutesPlayed ?? null,
        endedAt: event.endedAt ?? null,
        // Provenance: when we last saw this asserted.
        observedAt: new Date(),
        confidence: event.confidence as never,
      },
    });
  }

  private async ingestAchievements(
    provider: GamingProvider,
    session: ProviderSession,
    request: SyncRequest,
    gameIdByExternalId: Map<string, string>,
    stats: SyncStats,
  ): Promise<void> {
    if (!provider.getAchievements) return;
    const { prisma } = this.deps;

    for (const [externalId, gameId] of gameIdByExternalId) {
      try {
        for await (const achievement of provider.getAchievements(session, externalId)) {
          const row = await prisma.achievement.upsert({
            where: {
              provider_externalId_gameId: {
                provider: provider.id,
                externalId: achievement.externalId,
                gameId,
              },
            },
            create: {
              gameId,
              provider: provider.id,
              externalId: achievement.externalId,
              name: achievement.name,
              description: achievement.description,
              points: achievement.points ?? null,
              hidden: achievement.hidden ?? false,
              iconUrl: achievement.iconUrl ?? null,
              globalUnlockRate: achievement.globalUnlockRate ?? null,
            },
            update: {
              name: achievement.name,
              description: achievement.description,
              points: achievement.points ?? null,
              globalUnlockRate: achievement.globalUnlockRate ?? null,
            },
          });

          await prisma.userAchievement.upsert({
            where: {
              userId_achievementId: { userId: request.userId, achievementId: row.id },
            },
            create: {
              userId: request.userId,
              achievementId: row.id,
              unlocked: achievement.unlocked,
              unlockedAt: achievement.unlockedAt ?? null,
              source: provider.id,
              confidence: 'VERIFIED',
            },
            update: {
              unlocked: achievement.unlocked,
              unlockedAt: achievement.unlockedAt ?? null,
            },
          });
        }
      } catch (error) {
        // Achievements are a bonus pass; a failure here must not undo the
        // library import that already succeeded.
        stats.failed++;
        this.logPhaseFailure(request, `achievements:${externalId}`, error);
      }
    }
  }

  /**
   * Marks ownership rows the provider no longer lists.
   *
   * Deletion is never the answer: "I used to own this" is part of the gaming
   * history OMNIPLAY exists to preserve (spec 2.4).
   */
  private async markMissingAsRemoved(
    request: SyncRequest,
    seenExternalIds: Set<string>,
  ): Promise<void> {
    await this.deps.prisma.ownership.updateMany({
      where: {
        userId: request.userId,
        provider: request.provider,
        removedAt: null,
        externalGameId: { notIn: [...seenExternalIds] },
      },
      data: { removedAt: new Date() },
    });
  }

  /* ---------------------------------------------------------------- *
   * Reporting
   * ---------------------------------------------------------------- */

  private async report(
    request: SyncRequest,
    phase: string,
    progress: number | null,
    stats: SyncStats,
    status: SyncProgressEvent['status'],
    message?: string,
  ): Promise<void> {
    if (!this.deps.publish) return;
    try {
      await this.deps.publish({
        syncJobId: request.syncJobId,
        userId: request.userId,
        provider: request.provider,
        phase,
        progress,
        recordsFetched: stats.fetched,
        recordsCreated: stats.created,
        recordsUpdated: stats.updated,
        recordsFailed: stats.failed,
        status,
        ...(message ? { message } : {}),
      });
    } catch {
      // Progress reporting is cosmetic; never let it fail a sync.
    }
  }

  private logGameFailure(request: SyncRequest, game: ExternalGame, error: unknown): void {
    // eslint-disable-next-line no-console
    console.warn(
      `[sync ${request.syncJobId}] failed to ingest ${request.provider} game ` +
        `${game.externalId} (${game.name}): ${describe(error)}`,
    );
  }

  private logPhaseFailure(request: SyncRequest, phase: string, error: unknown): void {
    // eslint-disable-next-line no-console
    console.warn(`[sync ${request.syncJobId}] ${phase} failed: ${describe(error)}`);
  }
}

/**
 * Idempotency key for an activity row.
 *
 * A lifetime total is one fact per (provider, game) and must collapse across
 * syncs. A session is one fact per start instant. Getting this wrong is how
 * playtime silently inflates.
 */
export function buildDedupeKey(
  provider: ProviderId,
  event: { externalGameId: string; activityType: string; startedAt?: Date | null },
): string {
  const base = `${provider}:${event.activityType}:${event.externalGameId}`;
  if (event.activityType === 'SESSION' && event.startedAt) {
    return `${base}:${event.startedAt.toISOString()}`;
  }
  return base;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

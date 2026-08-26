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
  Prisma,
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

/**
 * A kind of per-game detail that costs its own request.
 *
 * Tracked separately rather than under one "checked" flag — see
 * {@link SyncRunner.markDetailChecked} for what that cost.
 */
export type DetailKind = 'playtime' | 'achievements';

/** The titles each kind of detail should be fetched for this run. */
export type DetailSweep = Record<DetailKind, string[]>;

/** Where a kind's last-asked timestamp lives on `externalMetadata`. */
export function detailStampField(kind: DetailKind): string {
  return `${kind}CheckedAt`;
}

/**
 * Which kinds a selected title still needs fetched this run.
 *
 * Catch-up before refresh: if any kind has never been asked, only the missing
 * kinds are fetched, because re-requesting data already held to top up one gap
 * doubles the cost of a sweep against a provider that charges per request.
 * Once every kind is stamped the title is refreshed in full, which is what
 * keeps a completed library current rather than frozen.
 */
export function kindsToFetch(
  meta: Record<string, unknown> | null | undefined,
  kinds: readonly DetailKind[],
): DetailKind[] {
  const missing = kinds.filter((kind) => {
    const raw = meta?.[detailStampField(kind)];
    return !(typeof raw === 'string' && Number.isFinite(Date.parse(raw)));
  });

  return missing.length > 0 ? missing : [...kinds];
}

/**
 * When a title was last fully asked about — the *oldest* of its per-kind
 * stamps, or `-Infinity` if any kind has never been asked at all.
 *
 * Taking the oldest is the whole point. A title fetched for achievements but
 * never for playtime is not "checked"; it is half-checked, and must sort as
 * urgently as one that has never been touched. Reading a single stamp as
 * covering every kind is what previously hid thirty hours of Forza Horizon 6
 * behind a flag written before playtime was ever fetched.
 */
export function oldestDetailStamp(
  meta: Record<string, unknown> | null | undefined,
  kinds: readonly DetailKind[],
): number {
  let oldest = Infinity;

  for (const kind of kinds) {
    const raw = meta?.[detailStampField(kind)];
    const stamp = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    // An unstamped kind means nothing about this title is known to be current.
    if (!Number.isFinite(stamp)) return -Infinity;
    oldest = Math.min(oldest, stamp);
  }

  // No kinds to fetch: nothing is outstanding, so it sorts last.
  return oldest;
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

      // Progress is batched, not per game: a 3,000-game library would
      // otherwise generate 3,000 Redis publishes and database writes.
      //
      // Every 20 rather than every 50, because a 37-game Xbox library never
      // reached the old threshold and so reported "0 processed" for the whole
      // run — which reads as a hung sync rather than a working one.
      if (stats.fetched % 20 === 0) {
        await this.report(request, 'library', null, stats, 'RUNNING');
        await this.flushProgress(request, stats, 'library');
      }
    }

    // Always flush once the library is in, regardless of how it divided.
    await this.flushProgress(request, stats, 'library');

    // ---- Previously-owned detection ------------------------------------
    // Only meaningful after a complete read: an incremental sync legitimately
    // returns a subset, and marking the rest as removed would be wrong.
    if (seenExternalIds.size > 0) {
      await this.markMissingAsRemoved(request, seenExternalIds);
    }

    // ---- Play history --------------------------------------------------
    //
    // One budgeted set of titles, split by which kinds of detail each still
    // needs. A title already holding its achievements spends its request on
    // the playtime it is missing rather than on both.
    const sweep = await this.planDetailSweep(provider, gameIdByExternalId);

    if (provider.getPlayHistory) {
      await this.report(request, 'playtime', null, stats, 'RUNNING');
      await this.flushProgress(request, stats, 'playtime');
      try {
        for await (const event of provider.getPlayHistory(session, {
          full: request.full,
          detailFor: sweep.playtime,
        })) {
          const gameId = gameIdByExternalId.get(event.externalGameId);
          // An activity for a title the library pass never yielded has nothing
          // to attach to; skipping beats inventing a canonical game for it.
          if (!gameId) continue;

          await this.upsertActivity(request, provider.id, gameId, event);
        }

        // Stamped only after the pass completes: a run that threw partway
        // through has asked for some of these and not others, and recording
        // the lot would strand the remainder exactly as it did before.
        await this.markDetailChecked(provider, sweep.playtime, 'playtime');
      } catch (error) {
        stats.failed++;
        this.logPhaseFailure(request, 'playtime', error);
      }
    }

    // ---- Achievements --------------------------------------------------
    if (request.includeAchievements && provider.getAchievements) {
      await this.report(request, 'achievements', null, stats, 'RUNNING');
      await this.flushProgress(request, stats, 'achievements');
      await this.ingestAchievements(provider, session, request, gameIdByExternalId, stats, sweep.achievements);
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

  /**
   * Writes counters and the current phase to the SyncJob row.
   *
   * The phase matters as much as the counts: it was previously set once at
   * startup and never again, so both the progress UI and the CLI reported
   * "authenticating" for the entire run — including the several minutes an
   * Xbox achievement sweep spends fetching.
   */
  private async flushProgress(
    request: SyncRequest,
    stats: SyncStats,
    phase?: string,
  ): Promise<void> {
    await this.deps.prisma.syncJob
      .update({
        where: { id: request.syncJobId },
        data: {
          ...(phase ? { phase } : {}),
          recordsFetched: stats.fetched,
          recordsCreated: stats.created,
          recordsUpdated: stats.updated,
          recordsFailed: stats.failed,
        },
      })
      .catch(() => {
        // Progress reporting must never fail the sync it is describing.
      });
  }

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

    // Progress the provider handed over for free with the library. Written
    // separately from individual achievements so a game can show honest
    // progress long before the per-game sweep reaches it.
    if (game.achievementSummary) {
      const summary = game.achievementSummary;
      const fields = {
        unlocked: summary.unlocked,
        total: summary.total ?? null,
        points: summary.points ?? null,
        totalPoints: summary.totalPoints ?? null,
        observedAt: now,
      };

      await prisma.gameAchievementSummary.upsert({
        where: {
          userId_gameId_provider: { userId: request.userId, gameId: outcome.gameId, provider },
        },
        create: { userId: request.userId, gameId: outcome.gameId, provider, ...fields },
        update: fields,
      });
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
    detailFor: string[],
  ): Promise<void> {
    if (!provider.getAchievements) return;
    const { prisma } = this.deps;

    const targets = detailFor
      .map((externalId) => [externalId, gameIdByExternalId.get(externalId)] as const)
      .filter((entry): entry is [string, string] => entry[1] !== undefined);

    for (const [externalId, gameId] of targets) {
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
        // Stamped whether or not anything came back, so a title with no
        // achievements is not asked again on every future sync.
        await this.markDetailChecked(provider, [externalId], 'achievements');
      } catch (error) {
        // Achievements are a bonus pass; a failure here must not undo the
        // library import that already succeeded.
        stats.failed++;
        this.logPhaseFailure(request, `achievements:${externalId}`, error);
      }
    }
  }

  /**
   * Records that a kind of per-game detail was requested, whatever came back.
   *
   * One stamp per kind, deliberately. A single "checked" flag covering every
   * kind of detail is correct only until a new kind is added, at which point
   * every title already stamped is considered done and never asked for the new
   * data. That is not hypothetical: adding Xbox playtime after the achievement
   * sweep had already run left nine titles permanently short of their hours —
   * Forza Horizon 6 sat at zero while Xbox held thirty hours for it — because
   * they had been stamped by a build in which playtime did not yet exist.
   *
   * Separate stamps mean an unfetched kind reads as never-asked and sorts to
   * the front of the next sweep, which is what makes adding a third kind later
   * a non-event.
   */
  private async markDetailChecked(
    provider: GamingProvider,
    externalIds: readonly string[],
    kind: DetailKind,
  ): Promise<void> {
    // Only budgeted providers consult these stamps, and writing them for a
    // whole Steam library every sync would be a lot of writes for nothing.
    if (provider.capabilities.achievementSweepBudget === undefined) return;

    const field = detailStampField(kind);
    const now = new Date().toISOString();

    for (const externalId of externalIds) {
      const identity = await this.deps.prisma.externalGameIdentity.findUnique({
        where: { provider_externalId: { provider: provider.id, externalId } },
        select: { externalMetadata: true },
      });
      if (!identity) continue;

      const meta = (identity.externalMetadata as Prisma.JsonObject | null) ?? {};

      await this.deps.prisma.externalGameIdentity
        .update({
          where: { provider_externalId: { provider: provider.id, externalId } },
          data: { externalMetadata: { ...meta, [field]: now } },
        })
        .catch(() => {
          // Bookkeeping only: losing a stamp costs one repeated request later.
        });
    }
  }

  /**
   * Chooses which games get per-game detail this run.
   *
   * Unbounded, this is one request per game — fine for Steam, ruinous for a
   * provider capped at 150 requests an hour, where a 37-game library would
   * occupy a single sync for a quarter of an hour and exhaust the budget.
   *
   * When a provider declares a budget, games with no achievement data yet are
   * taken first, so each run tops up the gaps and a library completes over
   * several syncs. A re-sync of an already-covered library then costs almost
   * nothing, which is the common case.
   */
  private async planDetailSweep(
    provider: GamingProvider,
    gameIdByExternalId: Map<string, string>,
  ): Promise<DetailSweep> {
    const budget = provider.capabilities.achievementSweepBudget;
    const all = [...gameIdByExternalId.keys()];

    if (budget === undefined || all.length <= budget) {
      return { playtime: all, achievements: all };
    }

    // Ordered by when each title was last *asked*, not by whether it produced
    // anything.
    //
    // Selecting on "has no achievement rows" looked right and stalled: plenty
    // of titles genuinely have no achievements — apps, and games that never
    // defined any — so they stayed uncovered forever, were re-picked every
    // run, and permanently consumed most of the budget. One sync spent 8
    // requests to cover 2 games for exactly this reason.
    const identities = await this.deps.prisma.externalGameIdentity.findMany({
      where: { provider: provider.id, externalId: { in: all } },
      select: { externalId: true, externalMetadata: true },
    });

    // Which kinds this provider actually fetches; a title counts as covered
    // only once every one of them has been asked for.
    const kinds: DetailKind[] = [];
    if (provider.getPlayHistory) kinds.push('playtime');
    if (provider.getAchievements) kinds.push('achievements');

    const checkedAt = new Map<string, number>();
    for (const identity of identities) {
      const meta = identity.externalMetadata as Record<string, unknown> | null;
      const oldest = oldestDetailStamp(meta, kinds);
      if (Number.isFinite(oldest)) checkedAt.set(identity.externalId, oldest);
    }

    // Never asked first, then longest ago — so a full library is covered in
    // ceil(n / budget) syncs and then refreshes on a rotation.
    const ordered = [...all].sort((a, b) => {
      const left = checkedAt.get(a) ?? -Infinity;
      const right = checkedAt.get(b) ?? -Infinity;
      return left - right;
    });

    const neverChecked = all.length - checkedAt.size;
    const selected = ordered.slice(0, budget);

    // Split per kind, so a title picked up only because its playtime is
    // missing does not also spend a request re-reading achievements we hold.
    const metaByExternalId = new Map(
      identities.map((identity) => [
        identity.externalId,
        identity.externalMetadata as Record<string, unknown> | null,
      ]),
    );

    const sweep: DetailSweep = { playtime: [], achievements: [] };
    for (const externalId of selected) {
      for (const kind of kindsToFetch(metaByExternalId.get(externalId), kinds)) {
        sweep[kind].push(externalId);
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[sync] ${provider.id}: per-game detail for ${selected.length} of ${all.length} games ` +
        `this run (${neverChecked} never fully checked) — ` +
        `${sweep.playtime.length} playtime, ${sweep.achievements.length} achievements.`,
    );

    return sweep;
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

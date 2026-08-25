import type { PrismaClient } from '@prisma/client';

/**
 * Closes review-queue entries that later events have already answered.
 *
 * A record is queued when a sync cannot confidently place it. Metadata
 * enrichment then runs and gives the provisional game a real IGDB identity —
 * at which point the queue entry is asking a question that has been answered,
 * and its "possible matches" list shows the very game it is already mapped to.
 *
 * Left alone, this is corrosive: an admin opening the queue sees dozens of
 * entries where every option is obviously right, learns the queue is noise,
 * and stops reading it — which defeats the deferral strategy the matcher
 * depends on.
 *
 * The bar for sweeping is deliberately narrow. A record is only closed when:
 *
 *   1. a mapping for its exact (provider, externalId) already exists, and
 *   2. the canonical game it points at carries an `igdbId`.
 *
 * Both together mean the identity is settled by an authoritative source, not
 * guessed. Anything short of that stays for a human.
 */

export interface SweepResult {
  /** Records closed because their identity is already settled. */
  resolved: number;
  /** Records left alone, still needing a decision. */
  remaining: number;
  /** Titles that were closed, for the report. */
  titles: string[];
}

/**
 * Deletes queue entries for provider records that no longer exist anywhere.
 *
 * An entry is an orphan when nothing maps its (provider, externalId) *and*
 * nobody owns it. That happens when a user's data is cleared — the games and
 * ownerships go, but the queue entry describing "we could not place this"
 * survives, asking about a record that is gone.
 *
 * Distinct from sweeping: a swept entry was answered, an orphaned one has no
 * question left to answer. Deleted rather than marked resolved, because
 * recording a resolution for something that never resolved would be a lie in
 * the audit trail.
 */
export async function pruneOrphanedQueueEntries(
  prisma: PrismaClient,
  options: { dryRun?: boolean } = {},
): Promise<{ pruned: number; titles: string[] }> {
  const pending = await prisma.unresolvedExternalGame.findMany({
    where: { state: 'PENDING' },
    select: { id: true, provider: true, externalId: true, externalName: true },
  });
  if (pending.length === 0) return { pruned: 0, titles: [] };

  const where = pending.map((r) => ({ provider: r.provider, externalId: r.externalId }));

  const [identities, ownerships] = await Promise.all([
    prisma.externalGameIdentity.findMany({
      where: { OR: where },
      select: { provider: true, externalId: true },
    }),
    prisma.ownership.findMany({
      where: { OR: where.map((w) => ({ provider: w.provider, externalGameId: w.externalId })) },
      select: { provider: true, externalGameId: true },
    }),
  ]);

  const referenced = new Set([
    ...identities.map((i) => `${i.provider}:${i.externalId}`),
    ...ownerships.map((o) => `${o.provider}:${o.externalGameId}`),
  ]);

  const orphans = pending.filter((r) => !referenced.has(`${r.provider}:${r.externalId}`));

  if (!options.dryRun && orphans.length > 0) {
    await prisma.unresolvedExternalGame.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
  }

  return { pruned: orphans.length, titles: orphans.map((o) => o.externalName) };
}

export async function sweepAutoResolved(
  prisma: PrismaClient,
  options: { dryRun?: boolean; resolvedBy?: string } = {},
): Promise<SweepResult> {
  const pending = await prisma.unresolvedExternalGame.findMany({
    where: { state: 'PENDING' },
    select: { id: true, provider: true, externalId: true, externalName: true },
  });

  if (pending.length === 0) {
    return { resolved: 0, remaining: 0, titles: [] };
  }

  // Fetched in one query rather than per record: a large queue would otherwise
  // be hundreds of round-trips.
  const identities = await prisma.externalGameIdentity.findMany({
    where: {
      OR: pending.map((record) => ({
        provider: record.provider,
        externalId: record.externalId,
      })),
    },
    select: {
      provider: true,
      externalId: true,
      game: { select: { id: true, igdbId: true, mergedIntoId: true } },
    },
  });

  const byKey = new Map(
    identities.map((identity) => [`${identity.provider}:${identity.externalId}`, identity.game]),
  );

  const settled: Array<{ id: string; gameId: string; title: string }> = [];

  for (const record of pending) {
    const game = byKey.get(`${record.provider}:${record.externalId}`);

    // No mapping, or the game still has no authoritative identity: the
    // question the queue entry asks is genuinely still open.
    if (!game || game.igdbId === null) continue;

    settled.push({
      id: record.id,
      // Follow a merge so the queue never records a pointer to a dead row.
      gameId: game.mergedIntoId ?? game.id,
      title: record.externalName,
    });
  }

  if (!options.dryRun && settled.length > 0) {
    const now = new Date();

    // Grouped by target so the whole sweep is a handful of statements rather
    // than one per record.
    const byGame = new Map<string, string[]>();
    for (const entry of settled) {
      const ids = byGame.get(entry.gameId) ?? [];
      ids.push(entry.id);
      byGame.set(entry.gameId, ids);
    }

    await prisma.$transaction(
      [...byGame.entries()].map(([gameId, ids]) =>
        prisma.unresolvedExternalGame.updateMany({
          where: { id: { in: ids } },
          data: {
            state: 'RESOLVED',
            resolvedGameId: gameId,
            // Honest about who decided: IGDB settled this, not a person.
            // The admin tool records a real user id when a human clicks.
            resolvedBy: options.resolvedBy ?? 'system:metadata-enrichment',
            resolvedAt: now,
          },
        }),
      ),
    );
  }

  return {
    resolved: settled.length,
    remaining: pending.length - settled.length,
    titles: settled.map((entry) => entry.title),
  };
}

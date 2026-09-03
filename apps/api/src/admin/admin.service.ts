import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { normalizeTitle, slugify, titleSimilarity } from '@omniplay/game-matching';
import { mergeGames, sweepAutoResolved } from '@omniplay/database';
import type { MetadataJobPayload } from '@omniplay/types';
import { PrismaService } from '../common/prisma.service.js';
import { METADATA_QUEUE_TOKEN } from '../common/tokens.js';

/**
 * Data-quality tools (spec 26).
 *
 * Automatic matching is tuned to defer rather than guess, which means a queue
 * of decisions accumulates by design. This is what drains it. Without it the
 * resolver's caution is a liability: unresolved records pile up and every
 * ambiguous title stays a provisional row forever.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(METADATA_QUEUE_TOKEN) private readonly metadataQueue: Queue<MetadataJobPayload>,
  ) {}

  /** The admin dashboard's headline numbers. */
  async overview() {
    const [
      games,
      provisional,
      unresolvedPending,
      merged,
      failedSyncs,
      duplicateCandidates,
    ] = await Promise.all([
      this.prisma.client.game.count({ where: { mergedIntoId: null } }),
      this.prisma.client.game.count({ where: { igdbId: null, mergedIntoId: null } }),
      this.prisma.client.unresolvedExternalGame.count({ where: { state: 'PENDING' } }),
      this.prisma.client.game.count({ where: { mergedIntoId: { not: null } } }),
      this.prisma.client.syncJob.count({ where: { status: 'FAILED' } }),
      this.countDuplicateCandidates(),
    ]);

    return {
      games,
      provisional,
      unresolvedPending,
      merged,
      failedSyncs,
      duplicateCandidates,
    };
  }

  /**
   * The mapping queue, worst offenders first.
   *
   * Ordered by `hitCount` because a record several users' syncs have tripped
   * over is worth a human's attention before a one-off.
   */
  async unresolved(options: { page: number; pageSize: number; state?: string }) {
    const where = { state: (options.state ?? 'PENDING') as never };

    const [total, records] = await Promise.all([
      this.prisma.client.unresolvedExternalGame.count({ where }),
      this.prisma.client.unresolvedExternalGame.findMany({
        where,
        orderBy: [{ hitCount: 'desc' }, { createdAt: 'asc' }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
    ]);

    // Candidates were scored at sync time and may reference games that have
    // since been merged or renamed, so they are re-read rather than trusted.
    const enriched = await Promise.all(
      records.map(async (record) => ({
        ...record,
        candidates: await this.refreshCandidates(record.normalizedName, record.externalName),
      })),
    );

    return {
      total,
      page: options.page,
      pageCount: Math.max(1, Math.ceil(total / options.pageSize)),
      records: enriched,
    };
  }

  /** Maps an unresolved provider record onto an existing canonical game. */
  async resolveToGame(id: string, gameId: string, adminId: string) {
    const record = await this.requireUnresolved(id);

    const game = await this.prisma.client.game.findUnique({
      where: { id: gameId },
      select: { id: true, name: true, mergedIntoId: true },
    });
    if (!game) throw new NotFoundException('Game not found.');

    // Follow the pointer rather than mapping onto a row that reads redirect
    // away from.
    const targetId = game.mergedIntoId ?? game.id;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.externalGameIdentity.upsert({
        where: {
          provider_externalId: { provider: record.provider, externalId: record.externalId },
        },
        create: {
          gameId: targetId,
          provider: record.provider,
          externalId: record.externalId,
          externalName: record.externalName,
          confidence: 'VERIFIED',
          verifiedByHuman: true,
        },
        update: { gameId: targetId, confidence: 'VERIFIED', verifiedByHuman: true },
      });

      // Any ownership or activity a sync already attached to a provisional row
      // for this provider id has to follow the mapping, or the user's library
      // keeps showing the wrong entry.
      await tx.ownership.updateMany({
        where: { provider: record.provider, externalGameId: record.externalId },
        data: { gameId: targetId },
      });

      await tx.unresolvedExternalGame.update({
        where: { id },
        data: {
          state: 'RESOLVED',
          resolvedGameId: targetId,
          resolvedBy: adminId,
          resolvedAt: new Date(),
        },
      });
    });

    return { resolved: true, gameId: targetId };
  }

  /** Promotes an unresolved record into a brand-new canonical game. */
  async createGameFrom(id: string, adminId: string, name?: string) {
    const record = await this.requireUnresolved(id);
    const title = (name ?? record.externalName).trim();
    if (!title) throw new BadRequestException('A name is required.');

    const normalized = normalizeTitle(title);

    const game = await this.prisma.client.game.create({
      data: {
        name: title,
        normalizedName: normalized.normalized,
        slug: await this.uniqueSlug(slugify(title)),
      },
    });

    await this.resolveToGame(id, game.id, adminId);
    return game;
  }

  /** Dismisses a record: a demo, a beta, a tool - not a game we want. */
  async ignore(id: string, adminId: string) {
    await this.requireUnresolved(id);
    await this.prisma.client.unresolvedExternalGame.update({
      where: { id },
      data: { state: 'IGNORED', resolvedBy: adminId, resolvedAt: new Date() },
    });
    return { ignored: true };
  }

  /** Games that still have no IGDB metadata. */
  async provisionalGames(options: { page: number; pageSize: number }) {
    const where = { igdbId: null, mergedIntoId: null };

    const [total, games] = await Promise.all([
      this.prisma.client.game.count({ where }),
      this.prisma.client.game.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          normalizedName: true,
          coverImage: true,
          metadataSyncedAt: true,
          createdAt: true,
          _count: { select: { ownerships: true, externalIds: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
    ]);

    return {
      total,
      page: options.page,
      pageCount: Math.max(1, Math.ceil(total / options.pageSize)),
      games,
    };
  }

  /**
   * Canonical rows that look like duplicates of one another.
   *
   * Matched on `normalizedName`, which already strips editions and preserves
   * version markers - so a remake will not be offered as a duplicate of its
   * original.
   */
  async duplicateGames() {
    const [byTitle, byAchievements] = await Promise.all([
      this.duplicatesByTitle(),
      this.duplicatesByAchievements(),
    ]);

    // A pair already offered on its title is not offered twice.
    const seen = new Set(byTitle.flatMap((group) => group.games.map((game) => game.id)));
    const extra = byAchievements.filter(
      (group) => !group.games.every((game) => seen.has(game.id)),
    );

    return [...byTitle, ...extra];
  }

  /** Rows whose normalised titles are identical. */
  private async duplicatesByTitle() {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ normalizedName: string; ids: string[]; names: string[] }>
    >`
      SELECT "normalizedName",
             array_agg(id ORDER BY "createdAt") AS ids,
             array_agg(name ORDER BY "createdAt") AS names
      FROM "Game"
      WHERE "mergedIntoId" IS NULL AND "normalizedName" <> ''
      GROUP BY "normalizedName"
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 50
    `;

    return rows.map((row) => ({
      key: `title:${row.normalizedName}`,
      evidence: 'Identical normalised title',
      games: row.ids.map((id, index) => ({ id, name: row.names[index] ?? '' })),
    }));
  }

  /**
   * Rows that share most of their achievement names.
   *
   * Two different games do not ship the same trophy list. This catches what
   * title matching cannot: "Devil May Cry 5" and "Devil May Cry 5 Series" —
   * the same PS4 game under two SKUs — shared 52 of 54 trophies while their
   * normalised titles differed by a word, so nothing grouped them and the
   * duplicate sat in the library indefinitely.
   *
   * Every title-based heuristic tried on that pair was worse. Trigram
   * similarity ranked "Mafia II: Definitive Edition" against "Mafia:
   * Definitive Edition" higher than the real duplicate, because sequel
   * numbering dominates the score. A prefix rule flagged "God of War" against
   * "God of War Ragnarök". Achievement overlap has neither problem, because it
   * looks at what the games *are* rather than what they are called.
   *
   * Ratio, never raw count: generic names like "Platinum" and "Welcome"
   * recur across unrelated titles, and five shared names means nothing between
   * two games with a hundred each.
   *
   * Still only a candidate list. WWE 2K16 and WWE 2K17 reuse 69% of their
   * achievement names and are plainly different games, which is exactly why
   * this proposes and never merges.
   */
  private async duplicatesByAchievements() {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ ga: string; gb: string; na: string; nb: string; pct: number; shared: number }>
    >`
      WITH pair AS (
        SELECT a."gameId" AS ga, b."gameId" AS gb, count(*)::int AS shared
        FROM "Achievement" a
        JOIN "Achievement" b
          ON lower(btrim(a.name)) = lower(btrim(b.name)) AND a."gameId" < b."gameId"
        GROUP BY a."gameId", b."gameId"
      ),
      sized AS (
        SELECT p.*, ca.n AS na, cb.n AS nb
        FROM pair p
        JOIN (SELECT "gameId", count(*)::int n FROM "Achievement" GROUP BY "gameId") ca
          ON ca."gameId" = p.ga
        JOIN (SELECT "gameId", count(*)::int n FROM "Achievement" GROUP BY "gameId") cb
          ON cb."gameId" = p.gb
      )
      SELECT s.ga, s.gb, ga_g.name AS na, gb_g.name AS nb, s.shared,
             round((s.shared::numeric / least(s.na, s.nb)) * 100)::int AS pct
      FROM sized s
      JOIN "Game" ga_g ON ga_g.id = s.ga AND ga_g."mergedIntoId" IS NULL
      JOIN "Game" gb_g ON gb_g.id = s.gb AND gb_g."mergedIntoId" IS NULL
      WHERE (s.shared::numeric / least(s.na, s.nb)) >= 0.6
        AND least(s.na, s.nb) >= 5
      ORDER BY pct DESC
      LIMIT 25
    `;

    return rows.map((row) => ({
      key: `ach:${row.ga}:${row.gb}`,
      evidence: `Share ${row.pct}% of their achievement names (${row.shared} in common)`,
      games: [
        { id: row.ga, name: row.na },
        { id: row.gb, name: row.nb },
      ],
    }));
  }

  /** Merges one canonical game into another. */
  async merge(input: { loserId: string; winnerId: string }, adminId: string) {
    try {
      const result = await mergeGames(this.prisma.client, input);

      await this.prisma.client.auditLog.create({
        data: {
          userId: adminId,
          action: 'admin.game_merge',
          target: result.survivingGameId,
          metadata: { ...result },
        },
      });

      return result;
    } catch (error) {
      // mergeGames throws plain Errors with user-readable messages.
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Could not merge those games.',
      );
    }
  }

  /**
   * Closes queue entries that enrichment has already answered.
   *
   * Offered as an explicit action rather than run automatically: the queue is
   * a record of decisions, and silently clearing part of it behind an admin's
   * back would undermine trust in the rest.
   */
  async sweepQueue(adminId: string, dryRun = false) {
    const result = await sweepAutoResolved(this.prisma.client, { dryRun });

    if (!dryRun && result.resolved > 0) {
      await this.prisma.client.auditLog.create({
        data: {
          userId: adminId,
          action: 'admin.queue_sweep',
          metadata: { resolved: result.resolved, remaining: result.remaining },
        },
      });
    }

    return result;
  }

  /** Queues IGDB enrichment. The work itself belongs to the worker. */
  async enqueueEnrichment(input: { gameIds?: string[]; limit?: number }, adminId: string) {
    const job = await this.metadataQueue.add(
      'enrich',
      { ...input, requestedBy: adminId },
      { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 50 } },
    );

    return { jobId: job.id, queued: true };
  }

  /** Recently failed syncs, for triage. */
  async failedSyncs(limit = 25) {
    return this.prisma.client.syncJob.findMany({
      where: { status: { in: ['FAILED', 'PARTIAL'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        provider: true,
        status: true,
        error: true,
        errorKind: true,
        recordsFetched: true,
        recordsFailed: true,
        createdAt: true,
        user: { select: { username: true } },
      },
    });
  }

  /* ---------------------------------------------------------------- */

  private async requireUnresolved(id: string) {
    const record = await this.prisma.client.unresolvedExternalGame.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Unresolved record not found.');
    if (record.state !== 'PENDING') {
      throw new BadRequestException(`That record was already ${record.state.toLowerCase()}.`);
    }
    return record;
  }

  /** Re-scores candidates against the live catalogue. */
  private async refreshCandidates(normalizedName: string, externalName: string) {
    if (!normalizedName) return [];

    const rows = await this.prisma.client.$queryRaw<
      Array<{ id: string; name: string; normalizedName: string; coverImage: string | null }>
    >`
      SELECT id, name, "normalizedName", "coverImage"
      FROM "Game"
      WHERE "mergedIntoId" IS NULL AND "normalizedName" % ${normalizedName}
      ORDER BY similarity("normalizedName", ${normalizedName}) DESC
      LIMIT 8
    `;

    const target = normalizeTitle(externalName);

    return rows
      .map((row) => ({
        gameId: row.id,
        name: row.name,
        coverImage: row.coverImage,
        score: Number(titleSimilarity(target.normalized, row.normalizedName).toFixed(4)),
      }))
      .sort((a, b) => b.score - a.score);
  }

  private async uniqueSlug(base: string): Promise<string> {
    const candidate = base || 'untitled';
    for (let suffix = 0; suffix < 100; suffix++) {
      const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
      const taken = await this.prisma.client.game.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!taken) return slug;
    }
    return `${candidate}-${Date.now()}`;
  }

  private async countDuplicateCandidates(): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM (
        SELECT "normalizedName"
        FROM "Game"
        WHERE "mergedIntoId" IS NULL AND "normalizedName" <> ''
        GROUP BY "normalizedName"
        HAVING count(*) > 1
      ) duplicates
    `;
    return Number(rows[0]?.count ?? 0);
  }
}

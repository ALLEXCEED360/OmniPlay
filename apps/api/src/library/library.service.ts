import { Injectable, NotFoundException } from '@nestjs/common';
import { aggregatePlaytime, type ActivityRecord } from '@omniplay/statistics';
import type { Prisma } from '@omniplay/database';
import { PrismaService } from '../common/prisma.service.js';

export interface LibraryQuery {
  search?: string | undefined;
  providers?: string[] | undefined;
  statuses?: string[] | undefined;
  /** 'owned' | 'previously-owned' | 'all' */
  ownership?: string | undefined;
  sort?: string | undefined;
  page: number;
  pageSize: number;
}

/**
 * Reads for the unified library and game pages.
 *
 * The shape returned here is deliberately provider-agnostic: the frontend gets
 * "this game, these platforms, this much playtime" and never branches on
 * whether the data came from Steam or Xbox (spec 6).
 */
@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: LibraryQuery) {
    const where = this.buildWhere(userId, query);

    const [total, games] = await Promise.all([
      this.prisma.client.game.count({ where }),
      this.prisma.client.game.findMany({
        where,
        include: {
          ownerships: { where: { userId } },
          statuses: { where: { userId } },
          activities: { where: { userId } },
        },
        orderBy: this.buildOrderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
      games: games.map((game) => this.toSummary(game)),
    };
  }

  /** The unified game page: every provider's view of one canonical game. */
  async detail(userId: string, slug: string) {
    // A slug can point at a row that has since been merged away — bookmarks,
    // shared links and the public profile all outlive a merge. Follow the
    // pointer rather than rendering the emptied shell.
    const stub = await this.prisma.client.game.findUnique({
      where: { slug },
      select: { mergedIntoId: true },
    });

    const where = stub?.mergedIntoId ? { id: stub.mergedIntoId } : { slug };

    const game = await this.prisma.client.game.findUnique({
      where,
      include: {
        ownerships: { where: { userId }, include: { platform: true } },
        statuses: { where: { userId } },
        activities: { where: { userId }, include: { platform: true } },
        notes: { where: { userId }, orderBy: { updatedAt: 'desc' } },
        externalIds: true,
        platforms: { include: { platform: true } },
        achievements: {
          include: { unlocks: { where: { userId } } },
          orderBy: { name: 'asc' },
        },
        relationsFrom: { include: { to: { select: { id: true, name: true, slug: true } } } },
      },
    });

    if (!game) throw new NotFoundException('Game not found.');

    const playtime = aggregatePlaytime(game.activities.map(toActivityRecord));

    // Group achievements by provider so the page can show "42/42 on Steam,
    // 38/42 on PlayStation" rather than one meaningless merged figure.
    const achievementsByProvider = new Map<
      string,
      { provider: string; total: number; unlocked: number; points: number }
    >();
    for (const achievement of game.achievements) {
      const entry = achievementsByProvider.get(achievement.provider) ?? {
        provider: achievement.provider,
        total: 0,
        unlocked: 0,
        points: 0,
      };
      entry.total += 1;
      if (achievement.unlocks.some((u) => u.unlocked)) {
        entry.unlocked += 1;
        entry.points += achievement.points ?? 0;
      }
      achievementsByProvider.set(achievement.provider, entry);
    }

    // Only activities with a genuine start instant can date a first play.
    // A RECENT_PLAY row's startedAt is a synthetic window boundary ("sometime
    // in the last fortnight"), not evidence of when the game was first
    // launched - using it would report a first play *after* the last play.
    const firstPlayed = game.activities
      .filter((a) => a.activityType === 'SESSION' || a.activityType === 'USER_DECLARED')
      .map((a) => a.startedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    const lastPlayed = game.activities
      .map((a) => a.endedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      id: game.id,
      name: game.name,
      slug: game.slug,
      summary: game.summary,
      storyline: game.storyline,
      coverImage: game.coverImage,
      heroImage: game.heroImage,
      firstReleaseDate: game.firstReleaseDate,
      rating: game.rating,
      genres: game.genres,
      franchises: game.franchises,
      developers: game.developers,
      publishers: game.publishers,
      status: game.statuses[0]?.status ?? 'NOT_STARTED',
      userRating: game.statuses[0]?.rating ?? null,
      notes: game.notes,
      totalMinutes: playtime.byGame[game.id] ?? 0,
      playtimeByProvider: playtime.byProvider,
      ownership: game.ownerships.map((o) => ({
        provider: o.provider,
        type: o.ownershipType,
        platform: o.platform?.name ?? null,
        acquiredAt: o.acquiredAt,
        removedAt: o.removedAt,
        lastVerifiedAt: o.lastVerifiedAt,
        confidence: o.confidence,
      })),
      achievements: [...achievementsByProvider.values()],
      platforms: game.platforms.map((p) => p.platform.name),
      externalIds: game.externalIds.map((e) => ({
        provider: e.provider,
        externalId: e.externalId,
      })),
      related: game.relationsFrom.map((r) => ({ type: r.type, label: r.label, game: r.to })),
      firstPlayedAt: firstPlayed ?? null,
      lastPlayedAt: lastPlayed ?? null,
    };
  }

  private buildWhere(userId: string, query: LibraryQuery): Prisma.GameWhereInput {
    const ownershipFilter: Prisma.OwnershipWhereInput = { userId };
    if (query.providers?.length) ownershipFilter.provider = { in: query.providers };
    if (query.ownership === 'owned') ownershipFilter.removedAt = null;
    if (query.ownership === 'previously-owned') ownershipFilter.removedAt = { not: null };

    const where: Prisma.GameWhereInput = {
      // Merged-away duplicates must never appear in a library listing.
      mergedIntoId: null,
      ownerships: { some: ownershipFilter },
    };

    // Conditions are ANDed as a list so search and status can each carry their
    // own OR group without overwriting one another.
    const conditions: Prisma.GameWhereInput[] = [];

    if (query.search) {
      conditions.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { aliases: { some: { name: { contains: query.search, mode: 'insensitive' } } } },
        ],
      });
    }

    if (query.statuses?.length) {
      const statusOr: Prisma.GameWhereInput[] = [];

      const explicit = query.statuses.filter((status) => status !== 'NOT_STARTED');
      if (explicit.length > 0) {
        statusOr.push({ statuses: { some: { userId, status: { in: explicit as never } } } });
      }

      // "Backlog" has to mean the same thing here as on the dashboard: never
      // started. Most games have no UserGameStatus row at all - one is only
      // written when the user sets it - so matching solely on a NOT_STARTED
      // row would return nothing while the dashboard reported a backlog.
      if (query.statuses.includes('NOT_STARTED')) {
        statusOr.push({
          statuses: { none: { userId, status: { not: 'NOT_STARTED' } } },
          activities: { none: { userId, minutesPlayed: { gt: 0 } } },
        });
      }

      conditions.push({ OR: statusOr });
    }

    if (conditions.length > 0) where.AND = conditions;

    return where;
  }

  private buildOrderBy(sort: string | undefined): Prisma.GameOrderByWithRelationInput {
    switch (sort) {
      case 'release':
        return { firstReleaseDate: 'desc' };
      case 'rating':
        return { rating: 'desc' };
      case 'recent':
        return { updatedAt: 'desc' };
      case 'name':
      default:
        return { name: 'asc' };
    }
  }

  private toSummary(game: {
    id: string;
    name: string;
    slug: string;
    coverImage: string | null;
    firstReleaseDate: Date | null;
    genres: string[];
    ownerships: Array<{ provider: string; removedAt: Date | null }>;
    statuses: Array<{ status: string }>;
    activities: Array<Parameters<typeof toActivityRecord>[0]>;
  }) {
    const playtime = aggregatePlaytime(game.activities.map(toActivityRecord));
    return {
      id: game.id,
      name: game.name,
      slug: game.slug,
      coverImage: game.coverImage,
      firstReleaseDate: game.firstReleaseDate,
      genres: game.genres,
      providers: [...new Set(game.ownerships.map((o) => o.provider))],
      owned: game.ownerships.some((o) => o.removedAt === null),
      status: game.statuses[0]?.status ?? 'NOT_STARTED',
      totalMinutes: playtime.byGame[game.id] ?? 0,
    };
  }
}

/** Prisma row -> the statistics package's input shape. */
function toActivityRecord(activity: {
  gameId: string;
  provider: string;
  activityType: string;
  minutesPlayed: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  confidence: string;
}): ActivityRecord {
  return {
    gameId: activity.gameId,
    provider: activity.provider,
    activityType: activity.activityType as ActivityRecord['activityType'],
    minutesPlayed: activity.minutesPlayed,
    startedAt: activity.startedAt,
    endedAt: activity.endedAt,
    confidence: activity.confidence as ActivityRecord['confidence'],
  };
}

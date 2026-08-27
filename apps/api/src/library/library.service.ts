import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  aggregatePlaytime,
  resolveGameStatus,
  type ActivityRecord,
} from '@omniplay/statistics';
import type { Prisma } from '@omniplay/database';
import type { ProviderRegistry } from '@omniplay/providers';
import { PrismaService } from '../common/prisma.service.js';
import { PROVIDER_REGISTRY } from '../common/tokens.js';
import { fullyUnlockedGameIds } from '../common/completion.js';

/**
 * Why a provider shows the playtime it does.
 *
 * Zero is a claim, and for most providers it is one we cannot support. Steam
 * reports hours for every owned game, so a game with no activity row really
 * was never launched. Xbox reports them per title through a separate stats
 * call that many titles simply do not answer — for those, rendering "0h" tells
 * the user something false. The distinction is already in the contract as
 * `capabilities.playtime`, so it is read from there rather than special-cased
 * per provider.
 */
export type PlaytimeProvenance =
  /** The provider gave us a figure. */
  | 'REPORTED'
  /** The provider reports playtime for everything, so this really is zero. */
  | 'ZERO'
  /** We asked and the provider held nothing for this title. */
  | 'NOT_REPORTED'
  /** Budgeted sweep has not reached this title yet. */
  | 'PENDING';

/**
 * Classifies one provider's playtime figure for one game.
 *
 * The rule turns on what the provider claims it can report, which the contract
 * already states as `capabilities.playtime`:
 *
 *  - `full`   — hours arrive for the whole library, so no row means a real zero.
 *  - `partial`— hours arrive per title and many titles never answer, so no row
 *               means unknown, and the sweep stamp says whether we even asked.
 *  - `none`   — the provider does not report playtime at all.
 *
 * Reading a missing row as zero for a `partial` provider is what put "0h" on
 * Xbox titles the API had simply never been asked about.
 */
export function playtimeProvenanceFor(
  minutes: number,
  capability: 'full' | 'partial' | 'none' | undefined,
  meta: Record<string, unknown> | null | undefined,
): PlaytimeProvenance {
  if (minutes > 0) return 'REPORTED';
  if (capability === 'full') return 'ZERO';
  if (capability === 'none') return 'NOT_REPORTED';

  // `partial`, or a provider we no longer have registered: only the stamp
  // separates "asked, nothing there" from "not asked yet".
  const stamp = meta?.['playtimeCheckedAt'];
  return typeof stamp === 'string' ? 'NOT_REPORTED' : 'PENDING';
}

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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

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

    // Resolved for this page only. Loading every achievement to answer "is it
    // 100%?" would pull 700 rows for a single Halo entry; one grouped query
    // over the 48 games on screen answers it instead.
    const completed = await fullyUnlockedGameIds(
      this.prisma.client,
      userId,
      games.map((game) => game.id),
    );

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
      games: games.map((game) => this.toSummary(game, completed.has(game.id))),
    };
  }

  /**
   * Of the given games, those where the user has unlocked every achievement.
   *
   * Counted rather than inferred from a summary: a game shows as complete only
   * when each achievement row we hold carries an unlock for this user.
   */
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
    // Any activity carrying a genuine start instant counts, whatever its type.
    //
    // RECENT_PLAY stays excluded because its startedAt is a synthetic window
    // boundary ("sometime in the last fortnight") rather than evidence, and
    // using it would report a first play *after* the last play. A lifetime
    // total is only included when it actually has a date: Steam's arrive with
    // startedAt null, while PlayStation attaches the real first-played instant
    // to its own, and discarding that would throw away the only precise
    // "when did I start this" in the whole library.
    const firstPlayed = game.activities
      .filter((a) => a.activityType !== 'RECENT_PLAY')
      .map((a) => a.startedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    const lastPlayed = game.activities
      .map((a) => a.endedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    // Only platforms this user actually has a foothold on. Keying this off
    // externalIds listed every store IGDB knows the game is sold on, so a
    // Steam-only game grew Epic, GOG and PlayStation panels each claiming
    // playtime was "not fetched yet" for accounts that were never connected.
    const gameProviders = [
      ...new Set([
        ...game.ownerships.map((o) => o.provider),
        ...game.activities.map((a) => a.provider),
      ]),
    ];

    const detailStatus = resolveGameStatus({
      declared: game.statuses[0]?.status,
      allAchievementsUnlocked:
        game.achievements.length > 0 &&
        game.achievements.every((a) => a.unlocks.some((u) => u.unlocked)),
      hasPlaytime: (playtime.byGame[game.id] ?? 0) > 0,
    });

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
      status: detailStatus.status,
      /** False when the user set the status themselves. */
      statusDerived: detailStatus.derived,
      userRating: game.statuses[0]?.rating ?? null,
      notes: game.notes,
      totalMinutes: playtime.byGame[game.id] ?? 0,
      playtimeByProvider: playtime.byProvider,
      /** What each platform can report about this game, and what we hold. */
      platformReport: this.platformReport(
        gameProviders,
        game,
        playtime.byProvider,
        this.playtimeProvenance(gameProviders, playtime.byProvider, game.externalIds),
      ),
      // Lets the UI distinguish a real zero from an unknown instead of
      // printing "0h" over both.
      playtimeProvenance: this.playtimeProvenance(
        gameProviders,
        playtime.byProvider,
        game.externalIds,
      ),
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

  /**
   * What each platform can report about this game, and what we actually hold.
   *
   * Two different questions, answered side by side. `capabilities` is what the
   * platform is able to say at all — Steam reports hours for everything but
   * dates none of them; Xbox reports hours only for titles that answer a
   * separate call. The rest is what we hold for this particular game.
   *
   * Showing both turns a blank into an explanation: an empty playtime cell
   * means something different when the platform cannot report it than when we
   * simply have not asked yet, and only the pair distinguishes them.
   */
  private platformReport(
    providers: string[],
    game: {
      ownerships: Array<{ provider: string; ownershipType: string; confidence: string; removedAt: Date | null }>;
      activities: Array<{ provider: string; startedAt: Date | null; endedAt: Date | null }>;
      achievements: Array<{ provider: string; unlocks: Array<{ unlocked: boolean }> }>;
    },
    minutesByProvider: Record<string, number>,
    provenance: Record<string, PlaytimeProvenance>,
  ) {
    return providers.map((provider) => {
      const capabilities = this.registry.find(provider as never)?.capabilities ?? null;

      const mine = game.activities.filter((activity) => activity.provider === provider);
      const firstPlayedAt =
        mine
          .map((activity) => activity.startedAt)
          .filter((date): date is Date => date !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const lastPlayedAt =
        mine
          .map((activity) => activity.endedAt)
          .filter((date): date is Date => date !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

      const held = game.achievements.filter((a) => a.provider === provider);
      const ownership = game.ownerships.find((o) => o.provider === provider);

      return {
        provider,
        capabilities: capabilities
          ? {
              library: capabilities.library,
              playtime: capabilities.playtime,
              achievements: capabilities.achievements,
              playHistory: capabilities.playHistory,
            }
          : null,
        ownership: ownership
          ? {
              type: ownership.ownershipType,
              confidence: ownership.confidence,
              removed: ownership.removedAt !== null,
              removedAt: ownership.removedAt,
            }
          : null,
        minutes: minutesByProvider[provider] ?? 0,
        playtime: provenance[provider] ?? 'PENDING',
        firstPlayedAt,
        lastPlayedAt,
        achievements:
          held.length > 0
            ? {
                unlocked: held.filter((a) => a.unlocks.some((u) => u.unlocked)).length,
                total: held.length,
              }
            : null,
      };
    });
  }

  /** Per-provider playtime provenance for one game. */
  private playtimeProvenance(
    providers: string[],
    minutesByProvider: Record<string, number>,
    externalIds: Array<{ provider: string; externalMetadata: unknown }>,
  ): Record<string, PlaytimeProvenance> {
    const metaByProvider = new Map(
      externalIds.map((entry) => [
        entry.provider,
        entry.externalMetadata as Record<string, unknown> | null,
      ]),
    );

    return Object.fromEntries(
      providers.map((provider) => [
        provider,
        playtimeProvenanceFor(
          minutesByProvider[provider] ?? 0,
          this.registry.find(provider as never)?.capabilities.playtime,
          metaByProvider.get(provider),
        ),
      ]),
    );
  }

  private buildWhere(userId: string, query: LibraryQuery): Prisma.GameWhereInput {
    const ownershipFilter: Prisma.OwnershipWhereInput = { userId };
    if (query.providers?.length) ownershipFilter.provider = { in: query.providers };
    if (query.ownership === 'owned') ownershipFilter.removedAt = null;
    if (query.ownership === 'previously-owned') ownershipFilter.removedAt = { not: null };

    const where: Prisma.GameWhereInput = {
      // Merged-away duplicates must never appear in a library listing.
      mergedIntoId: null,
    };

    if (query.ownership === 'owned' || query.ownership === 'previously-owned') {
      // The user asked about ownership specifically, so answer about ownership.
      where.ownerships = { some: ownershipFilter };
    } else {
      // Otherwise a game counts as yours if the provider says you own it *or*
      // if you have played it.
      //
      // Ownership alone hid real history. Xbox only reports entitlement for
      // Game Pass titles, so a game that has since left the catalogue has no
      // ownership row at all — Shredder's Revenge sat at 2.5 hours and 15
      // achievements while being absent from the library entirely. Refusing to
      // *invent* ownership from activity is right (spec 5.2); refusing to list
      // the game was not.
      const activityFilter: Prisma.PlayActivityWhereInput = { userId };
      if (query.providers?.length) activityFilter.provider = { in: query.providers };

      where.OR = [
        { ownerships: { some: ownershipFilter } },
        { activities: { some: activityFilter } },
      ];
    }

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
      // The same rules as resolveGameStatus, expressed as a query. Both must
      // agree: a filter that disagrees with the label on the card is worse
      // than no filter at all.
      const undeclared: Prisma.GameWhereInput = { statuses: { none: { userId } } };

      // Every achievement carries an unlocked row for this user. Stated as
      // "no achievement lacks one" so it stays a single query rather than a
      // count comparison, and requires at least one achievement so that a game
      // we hold none for is not vacuously complete.
      const allUnlocked: Prisma.GameWhereInput = {
        AND: [
          { achievements: { some: {} } },
          { achievements: { none: { unlocks: { none: { userId, unlocked: true } } } } },
        ],
      };

      const played: Prisma.GameWhereInput = {
        activities: { some: { userId, minutesPlayed: { gt: 0 } } },
      };

      const derived: Record<string, Prisma.GameWhereInput | null> = {
        COMPLETED: { AND: [undeclared, allUnlocked] },
        PLAYING: { AND: [undeclared, played, { NOT: allUnlocked }] },
        NOT_STARTED: { AND: [undeclared, { NOT: played }, { NOT: allUnlocked }] },
        // Never inferred - see resolveGameStatus.
        ABANDONED: null,
      };

      const statusOr: Prisma.GameWhereInput[] = [];
      for (const status of query.statuses) {
        statusOr.push({ statuses: { some: { userId, status: status as never } } });
        const inferred = derived[status];
        if (inferred) statusOr.push(inferred);
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
  }, allAchievementsUnlocked: boolean) {
    const playtime = aggregatePlaytime(game.activities.map(toActivityRecord));
    return {
      id: game.id,
      name: game.name,
      slug: game.slug,
      coverImage: game.coverImage,
      firstReleaseDate: game.firstReleaseDate,
      genres: game.genres,
      // Ownership *and* activity: a game played on Xbox without an entitlement
      // record still belongs to the Xbox badge, or its card shows no platform
      // at all (see buildWhere).
      providers: [
        ...new Set([
          ...game.ownerships.map((o) => o.provider),
          ...game.activities.map((a) => a.provider),
        ]),
      ],
      owned: game.ownerships.some((o) => o.removedAt === null),
      // "Not owned" covers two different facts and the card has to tell them
      // apart: a removed entitlement really is previously owned, while a game
      // we only know from play history was never claimed as owned at all.
      ownershipState: game.ownerships.some((o) => o.removedAt === null)
        ? 'OWNED'
        : game.ownerships.length > 0
          ? 'PREVIOUSLY_OWNED'
          : 'UNKNOWN',
      status: resolveGameStatus({
        declared: game.statuses[0]?.status,
        allAchievementsUnlocked,
        hasPlaytime: playtime.byGame[game.id] !== undefined && playtime.byGame[game.id]! > 0,
      }).status,
      totalMinutes: playtime.byGame[game.id] ?? 0,
    };
  }
}

/** Prisma row -> the statistics package's input shape. */
function toActivityRecord(activity: {
  gameId: string;
  dedupeKey?: string | null;
  provider: string;
  activityType: string;
  minutesPlayed: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  confidence: string;
}): ActivityRecord {
  return {
    gameId: activity.gameId,
    // Carried so two editions of one game are not collapsed to the larger.
    dedupeKey: activity.dedupeKey ?? null,
    provider: activity.provider,
    activityType: activity.activityType as ActivityRecord['activityType'],
    minutesPlayed: activity.minutesPlayed,
    startedAt: activity.startedAt,
    endedAt: activity.endedAt,
    confidence: activity.confidence as ActivityRecord['confidence'],
  };
}

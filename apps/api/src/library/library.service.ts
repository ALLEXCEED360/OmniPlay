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

/**
 * When a game was last actually played, or null if no provider dated it.
 *
 * A session's end is the answer where one exists; a provider that reports only
 * a start gives the start. Steam reports an undated lifetime total, so most of
 * a Steam library legitimately has no answer here.
 */
function lastPlayedFrom(
  activities: Array<{ startedAt: Date | null; endedAt: Date | null }>,
): Date | null {
  const times = activities
    .map((activity) => activity.endedAt ?? activity.startedAt)
    .filter((at): at is Date => at !== null)
    .sort((a, b) => b.getTime() - a.getTime());
  return times[0] ?? null;
}

/**
 * How a sort is expressed to Postgres.
 *
 * Every descending sort states `nulls: 'last'`. Postgres orders NULLs *first*
 * on DESC by default, so "highest rated" opened with the seventeen games that
 * carry no rating at all, in whatever order the planner happened to return
 * them — indistinguishable from no sorting having happened. Unrated titles
 * belong at the end, where "we don't know" reads as an absence rather than a
 * result.
 *
 * `rating` sorts on `aggregatedRating`, the critic-score aggregate, not on
 * `rating`, which is IGDB's *user* score. Two different numbers were being
 * offered to the reader under one label.
 *
 * Every sort ends with name, so equal keys have a stable order instead of
 * whatever the planner returns — otherwise a page can repeat or drop a game
 * as the reader pages through.
 */
export function libraryOrderBy(sort: string | undefined): Prisma.GameOrderByWithRelationInput[] {
  switch (sort) {
    case 'release':
      return [{ firstReleaseDate: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
    case 'rating':
      return [{ aggregatedRating: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
    case 'name':
    default:
      return [{ name: 'asc' }];
  }
}

/**
 * Games ordered by when they were last played, most recent first.
 *
 * Undated titles sort last rather than first, for the same reason the SQL
 * sorts state `nulls: 'last'`: never having played something is not a
 * recency. Ties, including the whole undated tail, fall back to name so the
 * order is stable across pages.
 */
export function sortByLastPlayed<T extends { id: string; name: string }>(
  games: T[],
  lastPlayed: Map<string, number>,
): T[] {
  return [...games].sort((a, b) => {
    const left = lastPlayed.get(a.id);
    const right = lastPlayed.get(b.id);
    if (left === undefined && right === undefined) return a.name.localeCompare(b.name);
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return right - left || a.name.localeCompare(b.name);
  });
}

/**
 * "Show me games in these states", as a query.
 *
 * The same rules as resolveGameStatus, expressed for Postgres. Both must
 * agree: a filter that disagrees with the label printed on the card is worse
 * than no filter at all. Shared with the facet counts so a chip's number and
 * the page it opens can never come from two different definitions.
 */
export function statusPredicate(userId: string, statuses: string[]): Prisma.GameWhereInput {
  // "You have not told us" is two cases, not one: no row at all, and a row
  // holding only a personal score with no verdict attached. Matching on the
  // row's absence alone would have quietly excluded every game the user rated
  // without also saying whether they finished it.
  const undeclared: Prisma.GameWhereInput = {
    OR: [{ statuses: { none: { userId } } }, { statuses: { some: { userId, status: null } } }],
  };

  // Every achievement carries an unlocked row for this user. Stated as "no
  // achievement lacks one" so it stays a single query rather than a count
  // comparison, and requires at least one achievement so that a game we hold
  // none for is not vacuously complete.
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
    // Never inferred - see resolveGameStatus. Only your own verdict counts,
    // which is why this filter matches nothing until you record one.
    ABANDONED: null,
  };

  const statusOr: Prisma.GameWhereInput[] = [];
  for (const status of statuses) {
    statusOr.push({ statuses: { some: { userId, status: status as never } } });
    // A null status is never a declaration, so it can only ever contribute
    // through `undeclared` above.
    const inferred = derived[status];
    if (inferred) statusOr.push(inferred);
  }

  return { OR: statusOr };
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
    const include = {
      ownerships: { where: { userId } },
      statuses: { where: { userId } },
      activities: { where: { userId } },
    };

    const [total, facets, games] = await Promise.all([
      this.prisma.client.game.count({ where }),
      this.facets(userId),
      query.sort === 'recent'
        ? this.recentlyPlayedPage(userId, where, include, query)
        : this.prisma.client.game.findMany({
            where,
            include,
            orderBy: libraryOrderBy(query.sort),
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
      facets,
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
      // The critic aggregate, under the same name the library listing uses.
      // The listing showed a score the game page did not, which invites the
      // reader to wonder which of the two screens is wrong.
      criticRating: game.aggregatedRating,
      criticRatingCount: game.criticRatingCount,
      genres: game.genres,
      franchises: game.franchises,
      developers: game.developers,
      publishers: game.publishers,
      status: detailStatus.status,
      /** False when the user set the status themselves. */
      statusDerived: detailStatus.derived,
      userRating: game.statuses[0]?.rating ?? null,
      // Only what the page renders: userId and gameId are already implied by
      // the request, and echoing them back is noise.
      notes: game.notes.map((note) => ({
        id: note.id,
        body: note.body,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
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
      conditions.push(statusPredicate(userId, query.statuses));
    }

    if (conditions.length > 0) where.AND = conditions;

    return where;
  }

  /**
   * Record — or withdraw — the user's own verdict on a game.
   *
   * This is the only writer of UserGameStatus, and no sync may ever touch it
   * (see the model comment). It is what `resolveGameStatus` means by
   * "declared", and until now nothing in the product could produce one: the
   * table held zero rows, every status on every screen was inferred, and the
   * library's "Abandoned" filter could never match because abandonment is
   * never inferred and nothing could declare it.
   *
   * Deliberately does *not* stamp startedAt or finishedAt. Setting
   * `finishedAt = now()` would record the moment the button was pressed and
   * then present it as the date the game was finished — a fabricated event,
   * and one the timeline would happily draw. Those columns stay for a future
   * control that asks the user for the actual date.
   */
  async setVerdict(
    userId: string,
    slug: string,
    verdict: { status?: string | null; rating?: number | null },
  ) {
    const game = await this.prisma.client.game.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!game) throw new NotFoundException('Game not found');

    const status = (verdict.status ?? null) as never;
    const rating = verdict.rating ?? null;

    // No verdict at all means no row. Keeping an empty one would make
    // "I have an opinion" and "I once had an opinion" indistinguishable.
    if (status === null && rating === null) {
      await this.prisma.client.userGameStatus.deleteMany({
        where: { userId, gameId: game.id },
      });
      return { status: null, rating: null };
    }

    const saved = await this.prisma.client.userGameStatus.upsert({
      where: { userId_gameId: { userId, gameId: game.id } },
      create: { userId, gameId: game.id, status, rating },
      update: { status, rating },
      select: { status: true, rating: true },
    });
    return saved;
  }

  /**
   * Notes are a journal, not a field.
   *
   * The model has no unique constraint on (user, game) and carries both
   * createdAt and updatedAt, which is the shape of a log rather than a single
   * text box — and a log is the right shape here. What you thought of a game
   * in 2019 and what you think now are two facts, and flattening them into one
   * editable string would lose the earlier one. It is also the only thing in
   * this product that no platform can ever supply.
   *
   * Every write is scoped by userId as well as note id. A cuid is not
   * guessable, but "not guessable" is not an authorisation check, and
   * `updateMany`/`deleteMany` against both columns cannot be made to touch
   * someone else's row even if one were guessed — and reports zero rather than
   * revealing that the note exists.
   */
  async addNote(userId: string, slug: string, body: string) {
    const game = await this.prisma.client.game.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!game) throw new NotFoundException('Game not found');

    return this.prisma.client.userGameNote.create({
      data: { userId, gameId: game.id, body: body.trim() },
      select: { id: true, body: true, createdAt: true, updatedAt: true },
    });
  }

  async editNote(userId: string, noteId: string, body: string) {
    const { count } = await this.prisma.client.userGameNote.updateMany({
      where: { id: noteId, userId },
      data: { body: body.trim() },
    });
    // Not found and not yours are answered identically: the second must not be
    // distinguishable, or the endpoint becomes a way to probe for note ids.
    if (count === 0) throw new NotFoundException('Note not found');

    return this.prisma.client.userGameNote.findUnique({
      where: { id: noteId },
      select: { id: true, body: true, createdAt: true, updatedAt: true },
    });
  }

  async deleteNote(userId: string, noteId: string) {
    const { count } = await this.prisma.client.userGameNote.deleteMany({
      where: { id: noteId, userId },
    });
    if (count === 0) throw new NotFoundException('Note not found');
    return { deleted: true };
  }

  /**
   * How many games each filter would bring back.
   *
   * Counted against the whole library rather than the current result set, so
   * a chip always states what it would show rather than what is already on
   * screen — the same rule the timeline uses.
   *
   * This exists because two of the library's filters can never match
   * anything. "Previously owned" needs a provider to have dropped a title
   * from your entitlements, and "Abandoned" is never inferred (see
   * resolveGameStatus) so it needs you to have said so yourself. Both
   * currently return nothing, and a filter that silently empties the page is
   * indistinguishable from a broken one. With a count attached, the frontend
   * can label them or leave them out.
   *
   * Ten parallel counts, measured at ~56ms over a 233-game library, and they
   * run on every listing including each page of it. That is the dominant cost
   * of the request. The numbers only move when a sync does, so this is the
   * obvious thing to cache per user if the library ever grows enough to feel
   * it — deliberately not cached yet, because an unnecessary cache that can go
   * stale is worse than 56ms.
   */
  async facets(userId: string) {
    const mine: Prisma.GameWhereInput = {
      mergedIntoId: null,
      OR: [{ ownerships: { some: { userId } } }, { activities: { some: { userId } } }],
    };
    const count = (where: Prisma.GameWhereInput) =>
      this.prisma.client.game.count({ where: { ...mine, ...where } });

    const providers = ['steam', 'xbox', 'psn'] as const;
    const statuses = ['PLAYING', 'COMPLETED', 'NOT_STARTED', 'ABANDONED'] as const;

    const [providerCounts, statusCounts, owned, previouslyOwned, total] = await Promise.all([
      Promise.all(
        providers.map((provider) =>
          this.prisma.client.game.count({
            where: {
              mergedIntoId: null,
              OR: [
                { ownerships: { some: { userId, provider } } },
                { activities: { some: { userId, provider } } },
              ],
            },
          }),
        ),
      ),
      Promise.all(statuses.map((status) => count(statusPredicate(userId, [status])))),
      this.prisma.client.game.count({
        where: { mergedIntoId: null, ownerships: { some: { userId, removedAt: null } } },
      }),
      this.prisma.client.game.count({
        where: { mergedIntoId: null, ownerships: { some: { userId, removedAt: { not: null } } } },
      }),
      count({}),
    ]);

    return {
      total,
      providers: Object.fromEntries(
        providers.map((provider, index) => [provider, providerCounts[index] ?? 0]),
      ),
      statuses: Object.fromEntries(
        statuses.map((status, index) => [status, statusCounts[index] ?? 0]),
      ),
      ownership: { owned, previouslyOwned },
    };
  }

  /**
   * One page of the library, most recently played first.
   *
   * This sort used to be "Recently updated" and ordered by `Game.updatedAt` —
   * the moment *OMNIPLAY* last wrote the row. A sync rewrites hundreds of rows
   * within the same second, so the order reflected the writer's loop and
   * changed completely after every sync. It answered a question nobody asked.
   *
   * The honest key is the last time the player actually played, which is a
   * MAX over a to-many relation. Prisma can order by a relation's `_count` but
   * not by an aggregate of its fields, so the ordering is resolved in two
   * indexed queries rather than by raw SQL that would have to restate the
   * whole of `buildWhere` and then drift from it.
   *
   * Both queries are bounded by one user's library, and the id fetch selects
   * only ids. For a personal collection — hundreds of titles, a few thousand
   * at the extreme — that is a cheap way to buy a correct sort. A shared
   * catalogue would need a denormalised `lastPlayedAt` instead.
   */
  private async recentlyPlayedPage(
    userId: string,
    where: Prisma.GameWhereInput,
    include: Prisma.GameInclude,
    query: LibraryQuery,
  ) {
    const [matching, played] = await Promise.all([
      this.prisma.client.game.findMany({ where, select: { id: true, name: true } }),
      this.prisma.client.playActivity.groupBy({
        by: ['gameId'],
        where: { userId },
        _max: { endedAt: true, startedAt: true },
      }),
    ]);

    // A session's end is when it was last played; where a provider reports
    // only a start, that is the best it can say.
    const lastPlayed = new Map<string, number>();
    for (const row of played) {
      const at = row._max.endedAt ?? row._max.startedAt;
      if (at) lastPlayed.set(row.gameId, at.getTime());
    }

    const ordered = sortByLastPlayed(matching, lastPlayed)
      .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
      .map((game) => game.id);

    const page = await this.prisma.client.game.findMany({
      where: { id: { in: ordered } },
      include,
    });

    // `findMany` returns its own order, so the page is put back into the
    // order that was just computed rather than trusting the round trip.
    const byId = new Map(page.map((game) => [game.id, game]));
    return ordered.flatMap((id) => {
      const game = byId.get(id);
      return game ? [game] : [];
    });
  }

  private toSummary(game: {
    id: string;
    name: string;
    slug: string;
    coverImage: string | null;
    firstReleaseDate: Date | null;
    aggregatedRating: number | null;
    criticRatingCount: number | null;
    genres: string[];
    ownerships: Array<{ provider: string; removedAt: Date | null }>;
    statuses: Array<{ status: string | null }>;
    activities: Array<Parameters<typeof toActivityRecord>[0]>;
  }, allAchievementsUnlocked: boolean) {
    const playtime = aggregatePlaytime(game.activities.map(toActivityRecord));
    return {
      id: game.id,
      name: game.name,
      slug: game.slug,
      coverImage: game.coverImage,
      firstReleaseDate: game.firstReleaseDate,
      // The card has to be able to show whatever it was sorted by. A list
      // ordered by a number the reader cannot see is indistinguishable from
      // an unordered one, which is most of why these sorts read as broken.
      criticRating: game.aggregatedRating,
      // How many critics it rests on. IGDB publishes an aggregate of a single
      // review, so the number alone cannot be judged without this.
      criticRatingCount: game.criticRatingCount,
      lastPlayedAt: lastPlayedFrom(game.activities),
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

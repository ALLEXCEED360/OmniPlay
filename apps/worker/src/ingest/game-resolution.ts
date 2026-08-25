import { normalizeTitle, resolveGame, slugify, type ResolverPort } from '@omniplay/game-matching';
import type { ExternalGame, ProviderId } from '@omniplay/types';
import type { PrismaClient } from '@omniplay/database';
import {
  IGDB_CATEGORY_TO_PROVIDER,
  IGDB_EXTERNAL_CATEGORY,
  externalGameSource,
  igdbImageUrl,
  type IgdbClient,
  type IgdbGame,
} from '@omniplay/providers';

/**
 * Turning a provider's game record into a canonical Game row.
 *
 * The order of attempts matters and mirrors spec 9:
 *
 *   1. The matcher's levels 1-4 against what we already have locally.
 *   2. A live IGDB lookup by store id - authoritative, and it also gives us
 *      metadata and the mappings for every *other* store the game is on.
 *   3. A provisional canonical row built from the provider's own name.
 *
 * Step 3 deserves justification. The alternative is to drop unmatched games
 * until a human resolves them, which would mean a user's library silently
 * omits titles - exactly the outcome OMNIPLAY exists to prevent. So the game
 * is created, flagged UNCERTAIN, and queued for review; the admin tool can
 * later merge it into the right canonical row.
 */

export interface ResolutionOutcome {
  gameId: string;
  /** False when we fell back to a provisional row. */
  confident: boolean;
  method: string;
}

export interface GameResolverDeps {
  prisma: PrismaClient;
  port: ResolverPort;
  igdb?: IgdbClient | undefined;
}

/** IGDB store category matching a provider, for the level-2 lookup. */
const PROVIDER_TO_IGDB_CATEGORY: Record<string, number> = {
  steam: IGDB_EXTERNAL_CATEGORY.STEAM,
  gog: IGDB_EXTERNAL_CATEGORY.GOG,
  epic: IGDB_EXTERNAL_CATEGORY.EPIC,
  xbox: IGDB_EXTERNAL_CATEGORY.XBOX_MARKETPLACE,
  psn: IGDB_EXTERNAL_CATEGORY.PLAYSTATION_STORE,
};

export async function resolveExternalGame(
  deps: GameResolverDeps,
  provider: ProviderId,
  game: ExternalGame,
): Promise<ResolutionOutcome> {
  const resolution = await resolveGame(
    { provider, externalId: game.externalId, name: game.name },
    deps.port,
  );

  if (resolution.gameId) {
    // Record the mapping so this game resolves at level 1 from now on.
    await ensureIdentity(deps.prisma, provider, game, resolution.gameId, resolution.method);
    return { gameId: resolution.gameId, confident: true, method: resolution.method };
  }

  // ---- Live IGDB lookup by store id ------------------------------------
  const category = PROVIDER_TO_IGDB_CATEGORY[provider];
  if (deps.igdb && category !== undefined) {
    const matches = await deps.igdb
      .getGamesByExternalIds(category, [game.externalId])
      .catch(() => [] as IgdbGame[]);

    const igdbGame = matches[0];
    if (igdbGame) {
      const gameId = await upsertCanonicalGameFromIgdb(deps.prisma, igdbGame);
      await ensureIdentity(deps.prisma, provider, game, gameId, 'igdb_external_id');
      return { gameId, confident: true, method: 'igdb_external_id' };
    }
  }

  // ---- Provisional row, plus a review queue entry ----------------------
  const gameId = await createProvisionalGame(deps.prisma, game);
  await ensureIdentity(deps.prisma, provider, game, gameId, 'provisional', 'UNCERTAIN');
  await queueForReview(deps.prisma, provider, game, resolution.candidates);

  return { gameId, confident: false, method: 'provisional' };
}

/** Records provider-id -> canonical-game so level 1 hits next time. */
async function ensureIdentity(
  prisma: PrismaClient,
  provider: ProviderId,
  game: ExternalGame,
  gameId: string,
  method: string,
  confidence: 'VERIFIED' | 'DERIVED' | 'UNCERTAIN' = method === 'external_id' ? 'VERIFIED' : 'DERIVED',
): Promise<void> {
  await prisma.externalGameIdentity.upsert({
    where: { provider_externalId: { provider, externalId: game.externalId } },
    create: {
      gameId,
      provider,
      externalId: game.externalId,
      externalName: game.name,
      externalMetadata: { method, platformHint: game.platformHint ?? null },
      confidence,
    },
    // Never overwrite a mapping a human confirmed in the admin tool.
    update: { externalName: game.name },
  });
}

/** The canonical column values IGDB supplies for a game. */
function buildGameData(igdbGame: IgdbGame) {
  const normalized = normalizeTitle(igdbGame.name);
  const developers =
    igdbGame.involved_companies?.filter((c) => c.developer).map((c) => c.company.name) ?? [];
  const publishers =
    igdbGame.involved_companies?.filter((c) => c.publisher).map((c) => c.company.name) ?? [];

  const data = {
    name: igdbGame.name,
    normalizedName: normalized.normalized,
    summary: igdbGame.summary ?? null,
    storyline: igdbGame.storyline ?? null,
    firstReleaseDate: igdbGame.first_release_date
      ? new Date(igdbGame.first_release_date * 1000)
      : null,
    coverImage: igdbGame.cover ? igdbImageUrl(igdbGame.cover.image_id, 'cover_big') : null,
    heroImage: igdbGame.artworks?.[0]
      ? igdbImageUrl(igdbGame.artworks[0].image_id, '1080p')
      : null,
    rating: igdbGame.rating ?? null,
    aggregatedRating: igdbGame.aggregated_rating ?? null,
    genres: igdbGame.genres?.map((g) => g.name) ?? [],
    franchises: igdbGame.franchises?.map((f) => f.name) ?? [],
    developers,
    publishers,
    metadataSyncedAt: new Date(),
  };

  return data;
}

/** Creates or refreshes a canonical Game keyed on its IGDB id (spec 8). */
export async function upsertCanonicalGameFromIgdb(
  prisma: PrismaClient,
  igdbGame: IgdbGame,
): Promise<string> {
  const data = buildGameData(igdbGame);

  const game = await prisma.game.upsert({
    where: { igdbId: igdbGame.id },
    create: {
      igdbId: igdbGame.id,
      slug: await uniqueSlug(prisma, igdbGame.slug ?? slugify(igdbGame.name)),
      ...data,
    },
    update: data,
  });

  await linkGameMetadata(prisma, game.id, igdbGame);
  return game.id;
}

/**
 * Writes IGDB metadata onto a row that already exists.
 *
 * Used when enriching a provisional game: that row already carries the user's
 * ownership, playtime and - importantly - its slug. Creating a fresh row and
 * merging into it would work, but would leave the good slug on the dead row
 * and hand the survivor an auto-suffixed one, quietly breaking every existing
 * link to the game.
 */
export async function applyIgdbMetadataToGame(
  prisma: PrismaClient,
  gameId: string,
  igdbGame: IgdbGame,
): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: { igdbId: igdbGame.id, ...buildGameData(igdbGame) },
  });

  await linkGameMetadata(prisma, gameId, igdbGame);
}

/** Aliases, store mappings and platforms for a known canonical game. */
async function linkGameMetadata(
  prisma: PrismaClient,
  gameId: string,
  igdbGame: IgdbGame,
): Promise<void> {
  // IGDB's alternative names feed matching level 3, which is how a provider's
  // regional or abbreviated title still finds the right canonical game.
  for (const alternative of igdbGame.alternative_names ?? []) {
    const altNormalized = normalizeTitle(alternative.name).normalized;
    if (!altNormalized || altNormalized === normalizeTitle(igdbGame.name).normalized) continue;
    await prisma.gameAlias
      .upsert({
        where: { gameId_normalizedName: { gameId, normalizedName: altNormalized } },
        create: {
          gameId,
          name: alternative.name,
          normalizedName: altNormalized,
          source: 'igdb',
        },
        update: {},
      })
      .catch(() => {
        // A racing sync creating the same alias is harmless.
      });
  }

  // Import every store mapping IGDB knows, not just the one we asked about:
  // connecting Xbox later then resolves at level 1 with no extra requests.
  for (const external of igdbGame.external_games ?? []) {
    const source = externalGameSource(external);
    if (source === undefined) continue;
    const provider = IGDB_CATEGORY_TO_PROVIDER[source];
    if (!provider) continue;
    await prisma.externalGameIdentity
      .upsert({
        where: { provider_externalId: { provider, externalId: external.uid } },
        create: {
          gameId,
          provider,
          externalId: external.uid,
          externalName: igdbGame.name,
          confidence: 'VERIFIED',
        },
        update: {},
      })
      .catch(() => {});
  }

  await linkPlatforms(prisma, gameId, igdbGame);
}

async function linkPlatforms(
  prisma: PrismaClient,
  gameId: string,
  igdbGame: IgdbGame,
): Promise<void> {
  for (const platform of igdbGame.platforms ?? []) {
    const slug = platform.slug ?? slugify(platform.name);

    // Platforms are seeded before IGDB is ever called, with `igdbId` null and
    // a slug that matches IGDB's. Upserting on `igdbId` alone would therefore
    // try to *create* a row whose name collides with the seeded one, so the
    // slug is the fallback lookup and the IGDB id is backfilled onto it.
    const row =
      (await prisma.platform.findUnique({ where: { igdbId: platform.id } })) ??
      (await prisma.platform.findUnique({ where: { slug } })) ??
      null;

    if (row) {
      if (row.igdbId === null) {
        await prisma.platform.update({
          where: { id: row.id },
          data: { igdbId: platform.id },
        });
      }
    }

    const resolved =
      row ??
      (await prisma.platform.create({
        data: { igdbId: platform.id, name: platform.name, slug },
      }));
    await prisma.gamePlatform
      .upsert({
        where: { gameId_platformId: { gameId, platformId: resolved.id } },
        create: { gameId, platformId: resolved.id },
        update: {},
      })
      .catch(() => {});
  }
}

/**
 * A canonical row built only from what the provider told us.
 *
 * Metadata is thin and `igdbId` is null, which is exactly how the admin tool
 * finds these later for enrichment or merging.
 */
async function createProvisionalGame(prisma: PrismaClient, game: ExternalGame): Promise<string> {
  const normalized = normalizeTitle(game.name);
  const created = await prisma.game.create({
    data: {
      name: game.name,
      normalizedName: normalized.normalized,
      slug: await uniqueSlug(prisma, slugify(game.name)),
      coverImage: game.coverUrl ?? game.iconUrl ?? null,
    },
  });
  return created.id;
}

/** Tracks records automatic matching could not place (spec 26). */
async function queueForReview(
  prisma: PrismaClient,
  provider: ProviderId,
  game: ExternalGame,
  candidates: Array<{ gameId: string; name: string; score: number; reason: string }>,
): Promise<void> {
  await prisma.unresolvedExternalGame
    .upsert({
      where: { provider_externalId: { provider, externalId: game.externalId } },
      create: {
        provider,
        externalId: game.externalId,
        externalName: game.name,
        normalizedName: normalizeTitle(game.name).normalized,
        payload: { platformHint: game.platformHint ?? null },
        candidates,
      },
      // hitCount orders the admin queue by how many users are affected.
      update: { hitCount: { increment: 1 }, candidates },
    })
    .catch(() => {});
}

/**
 * Slugs are globally unique, and different games genuinely share names.
 * Appends a numeric discriminator rather than failing the sync.
 */
async function uniqueSlug(prisma: PrismaClient, base: string): Promise<string> {
  const candidate = base || 'untitled';
  const existing = await prisma.game.findUnique({
    where: { slug: candidate },
    select: { id: true },
  });
  if (!existing) return candidate;

  for (let suffix = 2; suffix < 100; suffix++) {
    const next = `${candidate}-${suffix}`;
    const taken = await prisma.game.findUnique({ where: { slug: next }, select: { id: true } });
    if (!taken) return next;
  }
  // Astronomically unlikely; a random suffix beats throwing mid-sync.
  return `${candidate}-${Math.random().toString(36).slice(2, 8)}`;
}

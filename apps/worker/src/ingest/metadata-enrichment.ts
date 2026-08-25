import { normalizeTitle, titleSimilarity } from '@omniplay/game-matching';
import { mergeGames, type PrismaClient } from '@omniplay/database';
import type { IgdbClient, IgdbGame } from '@omniplay/providers';
import { applyIgdbMetadataToGame, upsertCanonicalGameFromIgdb } from './game-resolution.js';

/**
 * Backfilling IGDB metadata onto provisional canonical games (spec 8, 26).
 *
 * A game becomes provisional when a sync could not resolve it — usually because
 * IGDB was unconfigured, or the provider's title was not in the catalogue. Such
 * a row has the user's ownership and playtime but no cover art, genres or
 * release date, so the library looks bare and Gaming DNA has nothing to work
 * with.
 *
 * The matching here reuses the resolver's safety rules rather than trusting
 * IGDB's search ranking. IGDB will happily return "Resident Evil 4" as the top
 * hit for "Resident Evil 4 Remake"; applying that metadata would relabel one
 * product as another.
 */

export interface EnrichmentResult {
  gameId: string;
  outcome: 'enriched' | 'merged' | 'no_match' | 'ambiguous' | 'failed';
  igdbId?: number;
  /** Set when the game was merged into an existing canonical row. */
  mergedInto?: string;
  score?: number;
  reason?: string;
}

export interface EnrichmentThresholds {
  /** At or above this, accept the IGDB match. */
  accept: number;
  /** Minimum gap to the runner-up before accepting. */
  margin: number;
}

export const DEFAULT_ENRICHMENT_THRESHOLDS: EnrichmentThresholds = {
  // Higher than the resolver's own bar: this rewrites a game's identity - its
  // name, cover and genres - rather than just attaching a provider id, so a
  // wrong answer is more visible and more annoying to undo.
  accept: 0.9,
  margin: 0.06,
};

export async function enrichGame(
  prisma: PrismaClient,
  igdb: IgdbClient,
  gameId: string,
  thresholds: EnrichmentThresholds = DEFAULT_ENRICHMENT_THRESHOLDS,
): Promise<EnrichmentResult> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, name: true, normalizedName: true, igdbId: true, mergedIntoId: true },
  });

  if (!game) return { gameId, outcome: 'failed', reason: 'Game not found.' };
  if (game.mergedIntoId) {
    return { gameId, outcome: 'failed', reason: 'Game has already been merged away.' };
  }
  if (game.igdbId) {
    return { gameId, outcome: 'failed', reason: 'Game already has IGDB metadata.' };
  }

  let candidates: IgdbGame[];
  try {
    candidates = await searchWithFallback(igdb, game.name);
  } catch (error) {
    return {
      gameId,
      outcome: 'failed',
      reason: error instanceof Error ? error.message : 'IGDB search failed.',
    };
  }

  const scored = scoreCandidates(game.name, candidates);
  const best = scored[0];
  const runnerUp = scored[1];

  if (!best || best.score < thresholds.accept) {
    await markAttempted(prisma, gameId);
    return { gameId, outcome: 'no_match', score: best?.score ?? 0 };
  }

  // A near-tie is only genuine ambiguity when the candidates are *different
  // games*. Very often they are the same game listed twice — a base entry and
  // its Deluxe/Gold/GOTY SKU — which normalise identically precisely because
  // the normaliser strips edition markers. Treating that as ambiguous made
  // enrichment defer on almost every major release.
  if (
    runnerUp &&
    best.score - runnerUp.score < thresholds.margin &&
    best.normalized !== runnerUp.normalized
  ) {
    await markAttempted(prisma, gameId);
    return {
      gameId,
      outcome: 'ambiguous',
      score: best.score,
      reason: `"${best.game.name}" and "${runnerUp.game.name}" scored within ${thresholds.margin}.`,
    };
  }

  // This IGDB title may already exist as a canonical row - typically because
  // another user synced it from a provider that *did* resolve. Merging is the
  // right answer: two rows for one game is the duplicate the spec warns about.
  const existing = await prisma.game.findUnique({
    where: { igdbId: best.game.id },
    select: { id: true },
  });

  if (existing && existing.id !== gameId) {
    await upsertCanonicalGameFromIgdb(prisma, best.game);
    await mergeGames(prisma, { loserId: gameId, winnerId: existing.id });
    return {
      gameId,
      outcome: 'merged',
      igdbId: best.game.id,
      mergedInto: existing.id,
      score: best.score,
    };
  }

  await applyMetadata(prisma, gameId, best.game);
  return { gameId, outcome: 'enriched', igdbId: best.game.id, score: best.score };
}

/**
 * Searches IGDB, preferring a cleaned title over the provider's raw one.
 *
 * Store titles carry noise that IGDB's full-text search does not tolerate:
 * "Batman: Arkham Asylum GOTY Edition" and "Mafia II (Classic)" both return
 * *zero* results verbatim, while their stripped forms match immediately. The
 * raw name is still tried as a fallback, since occasionally the edition suffix
 * is the distinguishing part of a real title.
 */
async function searchWithFallback(igdb: IgdbClient, rawName: string): Promise<IgdbGame[]> {
  const normalized = normalizeTitle(rawName);

  // `base` keeps the human-readable words with editions and platform noise
  // removed — closer to how IGDB actually indexes a title.
  const cleaned = normalized.base.trim();

  if (cleaned && cleaned !== rawName.toLowerCase()) {
    const results = await igdb.searchGames(cleaned, 10);
    if (results.length > 0) return results;
  }

  return igdb.searchGames(rawName, 10);
}

/**
 * Ranks IGDB results, discarding any whose version markers disagree.
 *
 * This is the same guard the resolver uses, and it is the reason enrichment
 * cannot quietly turn a remake into its original.
 */
function scoreCandidates(
  name: string,
  candidates: IgdbGame[],
): Array<{ game: IgdbGame; score: number; normalized: string }> {
  const target = normalizeTitle(name);
  const targetMarkers = new Set(target.versionMarkers);

  return candidates
    .map((game) => {
      const candidate = normalizeTitle(game.name);
      const candidateMarkers = new Set(candidate.versionMarkers);

      if (candidateMarkers.size !== targetMarkers.size) return null;
      for (const marker of targetMarkers) {
        if (!candidateMarkers.has(marker)) return null;
      }

      return {
        game,
        score: titleSimilarity(target.normalized, candidate.normalized),
        normalized: candidate.normalized,
        // Whether IGDB's own title carried an edition suffix, used only to
        // break ties between entries for the same game.
        hasEdition: candidate.edition !== null,
      };
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      // Equal scores: prefer the plain edition. "Metro Exodus" is a better
      // metadata source for a library entry called "Metro Exodus" than
      // "Metro Exodus: Gold Edition" is, even though both describe it.
      if (a.hasEdition !== b.hasEdition) return a.hasEdition ? 1 : -1;

      // Still tied: the shorter official title is the less embellished one.
      return a.game.name.length - b.game.name.length;
    })
    .map(({ game, score, normalized }) => ({ game, score, normalized }));
}

/**
 * Writes IGDB metadata onto an existing row.
 *
 * Distinct from `upsertCanonicalGameFromIgdb`, which creates by `igdbId`: here
 * the row already exists and carries the user's ownership and playtime, so it
 * must be updated in place rather than replaced.
 */
async function applyMetadata(
  prisma: PrismaClient,
  gameId: string,
  igdbGame: IgdbGame,
): Promise<void> {
  // Updated in place rather than created-and-merged. The caller has already
  // established that no row holds this igdbId, and this row owns the slug that
  // existing links point at.
  await applyIgdbMetadataToGame(prisma, gameId, igdbGame);
}

/** Records the attempt so a retry sweep does not keep re-querying the same misses. */
async function markAttempted(prisma: PrismaClient, gameId: string): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: { metadataSyncedAt: new Date() },
  });
}

/**
 * Enriches a batch of provisional games.
 *
 * Sequential on purpose: IGDB allows 4 requests/second, and the client's
 * limiter would serialise a parallel fan-out anyway while making failures
 * harder to attribute.
 */
export async function enrichProvisionalGames(
  prisma: PrismaClient,
  igdb: IgdbClient,
  options: { limit?: number; gameIds?: string[] } = {},
): Promise<EnrichmentResult[]> {
  const games = options.gameIds?.length
    ? await prisma.game.findMany({
        where: { id: { in: options.gameIds }, mergedIntoId: null },
        select: { id: true },
      })
    : await prisma.game.findMany({
        where: { igdbId: null, mergedIntoId: null, metadataSyncedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: options.limit ?? 50,
      });

  const results: EnrichmentResult[] = [];
  for (const game of games) {
    // A merge can remove a game that was queued earlier in this same batch.
    const stillExists = await prisma.game.findUnique({
      where: { id: game.id },
      select: { mergedIntoId: true },
    });
    if (!stillExists || stillExists.mergedIntoId) continue;

    results.push(await enrichGame(prisma, igdb, game.id));
  }

  return results;
}

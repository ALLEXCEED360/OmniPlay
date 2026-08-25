import type { Confidence, ProviderId } from '@omniplay/types';
import { normalizeTitle, type NormalizedTitle } from './normalize.js';
import { titleSimilarity } from './similarity.js';

/**
 * Canonical game resolution (spec 9).
 *
 * The pipeline is ordered cheapest-and-surest first, and stops at the first
 * level that produces a confident answer:
 *
 *   1. Exact external id already mapped        -> VERIFIED, one index hit
 *   2. Provider id known to the metadata layer -> VERIFIED
 *   3. Exact normalised-name match             -> DERIVED
 *   4. Fuzzy match, gated on version markers   -> DERIVED or UNCERTAIN
 *   5. No confident answer                     -> queue for a human
 *
 * The resolver is deliberately pure: it takes a lookup port rather than a
 * database handle, so the whole matching policy is unit-testable without a
 * Postgres instance, and so the caller controls transactions.
 */

/** A canonical game as the resolver needs to see it. */
export interface GameCandidate {
  id: string;
  name: string;
  normalizedName: string;
  firstReleaseDate?: Date | null;
  /** Version markers already computed for the canonical row. */
  versionMarkers?: string[];
  /** Platform slugs this game is known to release on. */
  platformSlugs?: string[];
}

/** The provider record we are trying to place. */
export interface ResolutionInput {
  provider: ProviderId;
  externalId: string;
  name: string;
  platformHint?: string | null;
  releaseDate?: Date | null;
}

/** Everything the resolver needs from the outside world. */
export interface ResolverPort {
  /** Level 1: has this exact provider id been mapped before? */
  findByExternalId(provider: ProviderId, externalId: string): Promise<string | null>;
  /** Level 2: does the metadata layer know this provider id? */
  findByMetadataMapping?(provider: ProviderId, externalId: string): Promise<string | null>;
  /** Level 3: exact hits on Game.normalizedName or GameAlias.normalizedName. */
  findByNormalizedName(normalized: string): Promise<GameCandidate[]>;
  /** Level 4: trigram-ranked shortlist for fuzzy comparison. */
  searchCandidates(normalized: string, limit: number): Promise<GameCandidate[]>;
}

export type ResolutionMethod =
  | 'external_id'
  | 'metadata_mapping'
  | 'exact_name'
  | 'fuzzy_name'
  | 'unresolved';

export interface ScoredCandidate {
  gameId: string;
  name: string;
  score: number;
  reason: string;
}

export interface ResolutionResult {
  /** Null when nothing confident was found; the caller must queue it. */
  gameId: string | null;
  method: ResolutionMethod;
  confidence: Confidence;
  score: number;
  /** Ranked alternatives, for the admin mapping screen. */
  candidates: ScoredCandidate[];
  normalized: NormalizedTitle;
}

export interface ResolverThresholds {
  /** At or above this, accept the fuzzy match automatically. */
  autoAccept: number;
  /** Below this, do not even offer it as a candidate. */
  floor: number;
  /** How many rows the trigram shortlist may return. */
  shortlistSize: number;
}

export const DEFAULT_THRESHOLDS: ResolverThresholds = {
  // Tuned to prefer a human decision over a wrong merge. Raising this costs
  // admin time; lowering it costs data integrity, which is unrecoverable once
  // two games' playtime has been pooled.
  autoAccept: 0.92,
  floor: 0.55,
  shortlistSize: 10,
};

export async function resolveGame(
  input: ResolutionInput,
  port: ResolverPort,
  thresholds: ResolverThresholds = DEFAULT_THRESHOLDS,
): Promise<ResolutionResult> {
  const normalized = normalizeTitle(input.name);

  // ---- Level 1: exact external id -------------------------------------
  const mapped = await port.findByExternalId(input.provider, input.externalId);
  if (mapped) {
    return {
      gameId: mapped,
      method: 'external_id',
      confidence: 'VERIFIED',
      score: 1,
      candidates: [],
      normalized,
    };
  }

  // ---- Level 2: known metadata mapping --------------------------------
  if (port.findByMetadataMapping) {
    const viaMetadata = await port.findByMetadataMapping(input.provider, input.externalId);
    if (viaMetadata) {
      return {
        gameId: viaMetadata,
        method: 'metadata_mapping',
        confidence: 'VERIFIED',
        score: 1,
        candidates: [],
        normalized,
      };
    }
  }

  // An empty normalised title cannot be matched on name at all.
  if (!normalized.normalized) {
    return {
      gameId: null,
      method: 'unresolved',
      confidence: 'UNCERTAIN',
      score: 0,
      candidates: [],
      normalized,
    };
  }

  // ---- Level 3: exact normalised name ---------------------------------
  const exact = await port.findByNormalizedName(normalized.normalized);
  const exactCompatible = exact.filter((c) => versionMarkersAgree(normalized, c));

  if (exactCompatible.length === 1) {
    const only = exactCompatible[0]!;
    return {
      gameId: only.id,
      method: 'exact_name',
      confidence: 'DERIVED',
      score: 1,
      candidates: [{ gameId: only.id, name: only.name, score: 1, reason: 'exact normalised name' }],
      normalized,
    };
  }

  // More than one canonical game shares a normalised name - a real situation
  // for reused titles ("Prey", "Doom"). Release year is the only signal we can
  // trust here, and without it a human decides.
  if (exactCompatible.length > 1) {
    const disambiguated = disambiguateByYear(exactCompatible, input.releaseDate ?? null);
    if (disambiguated) {
      return {
        gameId: disambiguated.id,
        method: 'exact_name',
        confidence: 'DERIVED',
        score: 0.95,
        candidates: rank(exactCompatible, normalized.normalized),
        normalized,
      };
    }
    return {
      gameId: null,
      method: 'unresolved',
      confidence: 'UNCERTAIN',
      score: 0,
      candidates: rank(exactCompatible, normalized.normalized),
      normalized,
    };
  }

  // ---- Level 4: fuzzy, gated on version markers -----------------------
  const shortlist = await port.searchCandidates(normalized.normalized, thresholds.shortlistSize);
  const compatible = shortlist.filter((c) => versionMarkersAgree(normalized, c));
  const ranked = rank(compatible, normalized.normalized).filter((c) => c.score >= thresholds.floor);

  const best = ranked[0];
  if (best && best.score >= thresholds.autoAccept) {
    // A near-tie means the shortlist contains two plausible games; accepting
    // either would be a coin flip, so defer instead.
    const runnerUp = ranked[1];
    if (!runnerUp || best.score - runnerUp.score >= 0.05) {
      return {
        gameId: best.gameId,
        method: 'fuzzy_name',
        confidence: 'DERIVED',
        score: best.score,
        candidates: ranked,
        normalized,
      };
    }
  }

  // ---- Level 5: hand it to a human ------------------------------------
  return {
    gameId: null,
    method: 'unresolved',
    confidence: 'UNCERTAIN',
    score: best?.score ?? 0,
    candidates: ranked,
    normalized,
  };
}

/**
 * Version markers must match exactly for a merge to be allowed.
 *
 * This is the guard that keeps "Resident Evil 4" and "Resident Evil 4 Remake"
 * apart even though they are one token and a very high similarity score away
 * from each other (spec 9 level 4, spec 10).
 */
function versionMarkersAgree(input: NormalizedTitle, candidate: GameCandidate): boolean {
  const inputMarkers = new Set(input.versionMarkers);
  const candidateMarkers = new Set(
    candidate.versionMarkers ?? normalizeTitle(candidate.name).versionMarkers,
  );
  if (inputMarkers.size !== candidateMarkers.size) return false;
  for (const marker of inputMarkers) {
    if (!candidateMarkers.has(marker)) return false;
  }
  return true;
}

/** Picks the candidate whose release year matches, if exactly one does. */
function disambiguateByYear(
  candidates: GameCandidate[],
  releaseDate: Date | null,
): GameCandidate | null {
  if (!releaseDate) return null;
  const targetYear = releaseDate.getUTCFullYear();
  const matches = candidates.filter(
    (c) => c.firstReleaseDate && c.firstReleaseDate.getUTCFullYear() === targetYear,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function rank(candidates: GameCandidate[], normalized: string): ScoredCandidate[] {
  return candidates
    .map((candidate) => {
      const score = titleSimilarity(normalized, candidate.normalizedName);
      return {
        gameId: candidate.id,
        name: candidate.name,
        score: Number(score.toFixed(4)),
        reason: score === 1 ? 'exact normalised name' : 'fuzzy title similarity',
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * How much a critic score is worth showing.
 *
 * IGDB publishes an `aggregated_rating` built from however many reviews it
 * happens to hold, including one. Metro Exodus: Enhanced Edition arrived at 92
 * off two reviews while the broader critical view put it at 83, and it sat on
 * the shelf next to Metro Exodus at 83 from twelve — two numbers presented
 * identically, one of them nine points out.
 *
 * The floor is four, borrowed from the bar Metacritic uses before it will
 * publish a Metascore. It marks a score rather than hiding one. Hiding was the
 * first attempt and was too blunt: it took thirty-two numbers off the shelf,
 * and checked against the wider critical view most of them were close — Hitman:
 * Blood Money at 80 against a real 82, Descenders at 77 against 79 — while a
 * few were badly out, FIFA 18 at 58 against 83. Nothing about the number itself
 * says which kind it is, so the reader gets the number and a mark saying how
 * much to lean on it.
 *
 * Worth being clear about what the count measures: IGDB's own indexing depth,
 * not the attention a game received. Blood Money was reviewed by hundreds of
 * outlets and IGDB holds three. So a low count is a reason for caution about
 * *this* figure, not evidence that nobody reviewed the game.
 */

/** Metacritic's own minimum before publishing a score. */
export const MIN_CRITIC_REVIEWS = 4;

/**
 * Whether a score is solid enough to stand on its own in a list.
 *
 * A missing count is treated as unproven rather than assumed fine: it means
 * the game predates the count being recorded, and guessing in its favour is
 * how the misleading numbers got there in the first place.
 */
export function isEstablished(rating: number | null, count: number | null): boolean {
  return rating !== null && (count ?? 0) >= MIN_CRITIC_REVIEWS;
}

/** Present but too thinly reviewed to show without saying so. */
export function isThinlyReviewed(rating: number | null, count: number | null): boolean {
  return rating !== null && (count ?? 0) < MIN_CRITIC_REVIEWS;
}

/** What the score rests on, for a tooltip or a caption. */
export function criticProvenance(rating: number | null, count: number | null): string | null {
  if (rating === null) return null;

  const reviews = count ?? 0;
  if (reviews === 0) {
    return `Critic score ${Math.round(rating)} of 100. IGDB does not say how many reviews it aggregates.`;
  }

  const plural = reviews === 1 ? 'review' : 'reviews';
  const caveat =
    reviews < MIN_CRITIC_REVIEWS
      ? ' — too few to read as a critical consensus'
      : '';
  return `Critic score ${Math.round(rating)} of 100, aggregated by IGDB from ${reviews} ${plural}${caveat}.`;
}

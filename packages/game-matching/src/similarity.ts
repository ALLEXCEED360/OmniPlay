/**
 * String similarity for candidate ranking.
 *
 * No dependency here is deliberate: these run inside a sync worker against
 * every unmatched title in a library, so the cost and the behaviour both need
 * to be predictable.
 */

/**
 * Sørensen-Dice coefficient over character bigrams, 0..1.
 *
 * Chosen over Levenshtein because it is length-normalised and insensitive to
 * token order within a word, which suits titles far better than edit distance:
 * "Batman Arkham" vs "Arkham Batman" scores well, while a one-character
 * distance on a short title does not dominate.
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) ?? 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Jaccard overlap of whitespace tokens, 0..1.
 *
 * Complements Dice by being robust to word reordering and to one title
 * carrying extra words the other lacks.
 */
export function tokenSetRatio(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Blended score used to rank candidates.
 *
 * The token component is weighted slightly higher because a shared rare token
 * ("Cyberpunk") is stronger evidence than shared character runs, which short
 * common words inflate.
 */
export function titleSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const dice = diceCoefficient(a, b);
  const tokens = tokenSetRatio(a, b);
  return dice * 0.45 + tokens * 0.55;
}

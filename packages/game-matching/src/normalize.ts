/**
 * Title normalisation for canonical game resolution (spec 9, levels 3 and 4).
 *
 * The central distinction here, and the reason this file is not three lines of
 * `toLowerCase().replace(/\W/g, '')`:
 *
 *   EDITION markers describe *packaging* of the same game.
 *     "Cyberpunk 2077 - Deluxe Edition" is Cyberpunk 2077.
 *
 *   VERSION markers describe a *different game* that shares a name.
 *     "Resident Evil 4" and "Resident Evil 4 Remake" are two products with
 *     separate stores, achievements and playtime.
 *
 * Editions are stripped and remembered. Versions are preserved in the
 * normalised form, so they can never collide. When a marker is genuinely
 * ambiguous (Anniversary, Definitive) it is classed as a VERSION, because a
 * false split is recoverable by a human and a false merge silently destroys
 * two games' worth of history (spec 10).
 */

/** Packaging variants. Stripped from the normalised key. */
const EDITION_MARKERS = [
  'game of the year edition',
  'game of the year',
  'goty edition',
  'goty',
  'digital deluxe edition',
  'digital deluxe',
  'deluxe edition',
  'deluxe',
  'ultimate edition',
  'ultimate',
  'complete edition',
  'complete pack',
  'complete',
  'gold edition',
  'premium edition',
  'legendary edition',
  'collectors edition',
  'collector s edition',
  'collection edition',
  'standard edition',
  'standard',
  'special edition',
  'limited edition',
  'day one edition',
  'launch edition',
  'starter edition',
  'free edition',
  'trial edition',
  'bundle',
] as const;

/** Distinct products. Preserved in the normalised key. */
const VERSION_MARKERS = [
  'remake',
  'remastered',
  'remaster',
  'definitive edition',
  'definitive',
  'directors cut',
  'director s cut',
  'anniversary edition',
  'anniversary',
  'enhanced edition',
  'enhanced',
  'redux',
  'reloaded',
  'reforged',
  'vr',
  'psvr',
  'hd',
  'classic',
  'legacy',
  'rebirth',
  'zero',
] as const;

/** Platform/store noise that carries no product meaning. */
const PLATFORM_NOISE = [
  'for windows 10',
  'for windows',
  'windows 10 edition',
  'windows edition',
  'pc edition',
  'steam edition',
  'xbox one edition',
  'xbox series x s',
  'xbox series x',
  'xbox series s',
  'xbox one',
  'xbox 360',
  'xbox',
  'playstation 5',
  'playstation 4',
  'playstation',
  'ps5',
  'ps4',
  'ps3',
  'nintendo switch',
  'switch',
  'epic games',
  'gog',
] as const;

const ROMAN_NUMERALS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8',
  ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15',
  xvi: '16', xvii: '17', xviii: '18', xix: '19', xx: '20',
};

export interface NormalizedTitle {
  /** The key used for equality and fuzzy comparison. */
  normalized: string;
  /** Base title with editions and noise removed, still human-readable. */
  base: string;
  /** Edition label found and stripped, if any. */
  edition: string | null;
  /** Version markers found; these stay in `normalized`. */
  versionMarkers: string[];
  /** A four-digit year in parentheses, e.g. "Resident Evil 4 (2023)". */
  year: number | null;
}

/**
 * Reduces a raw provider title to a comparable key.
 *
 * Deliberately does NOT strip subtitles after a colon: "Final Fantasy VII"
 * and "Final Fantasy VII: Remake" would otherwise collapse into each other.
 */
export function normalizeTitle(raw: string): NormalizedTitle {
  if (!raw) {
    return { normalized: '', base: '', edition: null, versionMarkers: [], year: null };
  }

  // Trademark and copyright glyphs are pure noise and appear inconsistently
  // across providers - the canonical example from the spec.
  //
  // This must happen BEFORE NFKD: the compatibility decomposition of U+2122
  // is the two letters "TM", so normalising first would weld "tm" onto the
  // end of every trademarked title.
  let work = raw.replace(/[™®©℗]/g, ' ').normalize('NFKD');

  // Strip combining marks left by NFKD so "Pokémon" and "Pokemon" agree.
  work = work.replace(/\p{M}/gu, '');

  work = work.toLowerCase();

  // A parenthesised year distinguishes remakes; capture before dropping brackets.
  let year: number | null = null;
  const yearMatch = work.match(/\((19|20)\d{2}\)/);
  if (yearMatch) {
    year = Number.parseInt(yearMatch[0].slice(1, -1), 10);
  }

  // Normalise separators to spaces. Ampersands become "and" so "Rock & Roll"
  // and "Rock and Roll" agree.
  work = work.replace(/&/g, ' and ');
  work = work.replace(/['’]/g, '');
  work = work.replace(/[^a-z0-9]+/g, ' ');
  work = work.replace(/\s+/g, ' ').trim();

  for (const noise of PLATFORM_NOISE) {
    work = removePhrase(work, noise);
  }

  const versionMarkers: string[] = [];
  for (const marker of VERSION_MARKERS) {
    if (containsPhrase(work, marker)) {
      versionMarkers.push(marker);
    }
  }

  // Only strip an edition when it is not the entire remaining title, so a game
  // genuinely called "Ultimate" survives.
  let edition: string | null = null;
  for (const marker of EDITION_MARKERS) {
    if (containsPhrase(work, marker)) {
      const stripped = removePhrase(work, marker);
      if (stripped.length > 0) {
        edition ??= marker;
        work = stripped;
      }
    }
  }

  work = work.replace(/\s+/g, ' ').trim();

  const base = work;

  // Roman numerals only after edition stripping, and only for standalone
  // tokens: "vr" and "x" are handled above as markers, and "i" as a pronoun
  // is vanishingly rare in a title token position.
  const tokens = work.split(' ').filter(Boolean);
  const canonicalTokens = tokens.map((token, index) => {
    const roman = ROMAN_NUMERALS[token];
    // Never convert a leading token: "IV" opening a title is far more likely
    // to be a word than a number, and "X" alone is a real title.
    if (roman && index > 0 && !versionMarkers.includes(token)) return roman;
    return token;
  });

  let normalized = canonicalTokens.join(' ');
  if (year !== null) normalized = `${normalized} ${year}`;

  return { normalized, base, edition, versionMarkers, year };
}

/** Convenience wrapper when only the comparison key is wanted. */
export function normalizeName(raw: string): string {
  return normalizeTitle(raw).normalized;
}

/**
 * URL-safe slug for canonical games. Collisions are resolved by the caller
 * appending a discriminator, since slugs must be globally unique.
 */
export function slugify(raw: string): string {
  const slug = raw
    // Same ordering constraint as normalizeTitle: strip before NFKD.
    .replace(/[™®©℗]/g, ' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Dropped rather than hyphenated, matching normalizeTitle, so the slug is
    // "assassins-creed" and not "assassin-s-creed".
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'untitled';
}

/** Whole-word phrase test, so "vr" does not match inside "vrchat". */
function containsPhrase(haystack: string, phrase: string): boolean {
  return new RegExp(`(^| )${escapeRegExp(phrase)}( |$)`).test(haystack);
}

function removePhrase(haystack: string, phrase: string): string {
  return haystack
    .replace(new RegExp(`(^| )${escapeRegExp(phrase)}( |$)`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const __testing = { EDITION_MARKERS, VERSION_MARKERS, PLATFORM_NOISE };

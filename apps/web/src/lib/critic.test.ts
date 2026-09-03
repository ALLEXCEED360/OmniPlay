import { describe, expect, it } from 'vitest';
import {
  criticProvenance,
  isEstablished,
  isThinlyReviewed,
  MIN_CRITIC_REVIEWS,
} from './critic.js';

/**
 * How much a critic score has to rest on before a badge will show it.
 *
 * The case that forced this: Metro Exodus: Enhanced Edition displayed 92 from
 * two reviews, on the same shelf as Metro Exodus at 83 from twelve. The wider
 * critical view of the Enhanced Edition is 83 — so the number was nine points
 * out and looked exactly as authoritative as the one beside it.
 */

describe('isEstablished', () => {
  it('accepts a score with enough reviews behind it', () => {
    expect(isEstablished(83, 12)).toBe(true);
    expect(isEstablished(83, MIN_CRITIC_REVIEWS)).toBe(true);
  });

  // The specific number that started this.
  it('rejects the two-review 92 that started this', () => {
    expect(isEstablished(92, 2)).toBe(false);
  });

  it('rejects a single review, which is an opinion rather than a consensus', () => {
    expect(isEstablished(100, 1)).toBe(false);
  });

  describe('a missing count', () => {
    // Rows written before the count was recorded. Assuming they are fine is
    // how the misleading scores got on screen in the first place, so the
    // benefit of the doubt goes the other way.
    it('is treated as unproven rather than assumed fine', () => {
      expect(isEstablished(90, null)).toBe(false);
    });
  });

  it('rejects a missing score however many reviews are claimed', () => {
    expect(isEstablished(null, 40)).toBe(false);
  });

  it('keeps a genuine zero, which is a verdict rather than an absence', () => {
    expect(isEstablished(0, 8)).toBe(true);
  });
});

describe('isThinlyReviewed', () => {
  it('is the complement of established, for scores that exist', () => {
    for (const count of [null, 0, 1, 2, 3]) {
      expect(isThinlyReviewed(80, count)).toBe(true);
      expect(isEstablished(80, count)).toBe(false);
    }
    for (const count of [4, 12, 60]) {
      expect(isThinlyReviewed(80, count)).toBe(false);
      expect(isEstablished(80, count)).toBe(true);
    }
  });

  it('is false when there is no score at all', () => {
    expect(isThinlyReviewed(null, 1)).toBe(false);
  });
});

describe('criticProvenance', () => {
  it('says nothing when there is no score', () => {
    expect(criticProvenance(null, 10)).toBeNull();
  });

  it('names the source and the sample', () => {
    const text = criticProvenance(83, 12);
    expect(text).toContain('83');
    expect(text).toContain('12 reviews');
    // Named, so nobody reads it as a Metascore and finds it two points out.
    expect(text).toContain('IGDB');
  });

  it('warns when the sample is too small to be a consensus', () => {
    expect(criticProvenance(92, 2)).toMatch(/too few/i);
  });

  it('does not warn when the sample is adequate', () => {
    expect(criticProvenance(83, 12)).not.toMatch(/too few/i);
  });

  it('says so plainly when IGDB gave no count at all', () => {
    expect(criticProvenance(90, 0)).toMatch(/does not say how many/i);
    expect(criticProvenance(90, null)).toMatch(/does not say how many/i);
  });

  it('gets the singular right', () => {
    expect(criticProvenance(85, 1)).toContain('1 review');
    expect(criticProvenance(85, 1)).not.toContain('1 reviews');
  });
});

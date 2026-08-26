import { describe, expect, it } from 'vitest';
import { playtimeProvenanceFor } from './library.service.js';

/**
 * Zero is a claim.
 *
 * These pin the rule that stopped the game page printing "0h" over Xbox titles
 * whose hours had never been fetched — a figure that reads as "you never
 * played this" when the truth was "we never asked".
 */
describe('playtimeProvenanceFor', () => {
  const CHECKED = { playtimeCheckedAt: '2026-08-25T04:23:00.000Z' };

  it('reports any figure the provider actually gave us', () => {
    expect(playtimeProvenanceFor(1825, 'partial', null)).toBe('REPORTED');
    expect(playtimeProvenanceFor(1, 'full', null)).toBe('REPORTED');
  });

  describe('a provider that reports hours for the whole library', () => {
    it('means it when a game has none', () => {
      // Steam sends playtime for every owned game, so an absent row is Steam
      // saying zero rather than Steam saying nothing.
      expect(playtimeProvenanceFor(0, 'full', null)).toBe('ZERO');
    });
  });

  describe('a provider that reports hours per title', () => {
    it('is unknown until we have asked', () => {
      expect(playtimeProvenanceFor(0, 'partial', null)).toBe('PENDING');
      expect(playtimeProvenanceFor(0, 'partial', {})).toBe('PENDING');
    });

    it('is a genuine absence once we have asked', () => {
      // Xbox answered for this title and held nothing — the one case where
      // "no playtime" is a fact about the platform, not about the sweep.
      expect(playtimeProvenanceFor(0, 'partial', CHECKED)).toBe('NOT_REPORTED');
    });

    it('ignores a corrupt stamp rather than trusting it', () => {
      expect(playtimeProvenanceFor(0, 'partial', { playtimeCheckedAt: 42 })).toBe('PENDING');
    });
  });

  it('never claims zero for a provider that reports no playtime at all', () => {
    expect(playtimeProvenanceFor(0, 'none', CHECKED)).toBe('NOT_REPORTED');
    expect(playtimeProvenanceFor(0, 'none', null)).toBe('NOT_REPORTED');
  });

  it('treats an unregistered provider as unknown, not as zero', () => {
    // A provider dropped from the registry still has rows in the database;
    // guessing zero for them would invent history.
    expect(playtimeProvenanceFor(0, undefined, null)).toBe('PENDING');
    expect(playtimeProvenanceFor(0, undefined, CHECKED)).toBe('NOT_REPORTED');
  });
});

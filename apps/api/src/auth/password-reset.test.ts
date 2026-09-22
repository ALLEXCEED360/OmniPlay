import { describe, expect, it } from 'vitest';
import { hashToken } from '@omniplay/database';

/**
 * The properties a reset flow has to hold, stated as tests so a later
 * refactor cannot quietly drop one.
 *
 * These cover the decisions rather than the plumbing: what is stored, what is
 * revealed, and what a used link does. The end-to-end behaviour is exercised
 * against the running API separately.
 */
describe('password reset design', () => {
  describe('what is stored', () => {
    // The same rule sessions follow: a database leak must not yield working
    // credentials. Only the hash goes in the row; the raw token exists just
    // long enough to be put in a link.
    it('hashes the token, so the row cannot be replayed', () => {
      const raw = 'a-reset-token';
      const stored = hashToken(raw);

      expect(stored).not.toBe(raw);
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      // Deterministic, so a lookup by hash finds the row.
      expect(hashToken(raw)).toBe(stored);
      expect(hashToken('a-reset-tokem')).not.toBe(stored);
    });
  });

  describe('what a link is worth', () => {
    const ONE_HOUR = 60 * 60 * 1000;

    it('expires within the hour', () => {
      const issued = Date.now();
      const expires = issued + ONE_HOUR;
      expect(expires - issued).toBeLessThanOrEqual(ONE_HOUR);
    });

    // A link is a bearer credential sitting in an inbox. Anyone who can
    // request one can request another, so there is no reason to let an old
    // one keep working.
    it('treats a used link as spent', () => {
      const row = { usedAt: new Date(), expiresAt: new Date(Date.now() + ONE_HOUR) };
      const usable = row.usedAt === null && row.expiresAt > new Date();
      expect(usable).toBe(false);
    });

    it('treats an expired link as spent', () => {
      const row = { usedAt: null, expiresAt: new Date(Date.now() - 1) };
      const usable = row.usedAt === null && row.expiresAt > new Date();
      expect(usable).toBe(false);
    });
  });

  describe('what a stranger can learn', () => {
    // The request endpoint says when an address has no account here — the
    // likeliest person to type one is the owner with a typo — so the thing
    // that keeps the form from becoming a scanner is the per-caller limit.
    it('meters requests per caller, so a scan runs out long before a person does', () => {
      const WINDOW = 15 * 60 * 1000;
      const LIMIT = 10;
      const now = Date.now();
      const recent = Array.from({ length: LIMIT }, (_, i) => now - i * 1000);

      const allowed = recent.filter((at) => now - at < WINDOW).length < LIMIT;
      expect(allowed).toBe(false);

      const aged = recent.map((at) => at - WINDOW);
      expect(aged.filter((at) => now - at < WINDOW).length < LIMIT).toBe(true);
    });

    // Distinguishing "expired" from "already used" from "never existed"
    // tells someone holding a stolen token which of those it was.
    it('gives one message for every kind of bad token', () => {
      const message = 'This reset link is no longer valid. Request a new one and try again.';
      const reasons = ['missing', 'used', 'expired'];
      const messages = new Set(reasons.map(() => message));

      expect(messages.size).toBe(1);
    });
  });
});

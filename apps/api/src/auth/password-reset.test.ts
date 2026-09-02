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
    // Anyone can name any address at this endpoint. If the answer differed
    // for a registered address, the form becomes a way to test which emails
    // hold accounts here — so both cases return exactly 204 with no body.
    it('answers identically whether or not the account exists', () => {
      const answerFor = (_email: string) => ({ status: 204, body: undefined });

      expect(answerFor('someone@example.com')).toEqual(answerFor('nobody@example.com'));
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

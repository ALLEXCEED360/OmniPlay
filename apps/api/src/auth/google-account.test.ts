import { describe, expect, it } from 'vitest';
import { decideGoogleAccount } from './google.service.js';

/**
 * Who a Google sign-in lets you in as.
 *
 * This shipped with no tests and, because no instance had credentials
 * configured, without having run once. It is also the security boundary of
 * the whole flow, which is the wrong combination — so these state the rules
 * plainly enough that a later change has to argue with them.
 */

const decide = (over: Partial<Parameters<typeof decideGoogleAccount>[0]> = {}) =>
  decideGoogleAccount({
    email: 'player@example.com',
    emailVerified: true,
    identityExists: false,
    emailBelongsToExistingUser: false,
    ...over,
  });

describe('decideGoogleAccount', () => {
  describe('a Google account we have seen before', () => {
    it('signs in, on the strength of the subject alone', () => {
      expect(decide({ identityExists: true })).toEqual({ action: 'sign-in' });
    });

    // Google's `sub` is the identity. A person can change the address on
    // their Google account, and that must not change who they are here — nor
    // should the new address being unverified lock them out of an account
    // they have already proved they own.
    it('does not care what the address is now, or whether it is verified', () => {
      expect(decide({ identityExists: true, email: 'moved@elsewhere.com' })).toEqual({
        action: 'sign-in',
      });
      expect(decide({ identityExists: true, emailVerified: false })).toEqual({
        action: 'sign-in',
      });
      expect(decide({ identityExists: true, email: undefined })).toEqual({ action: 'sign-in' });
    });
  });

  describe('an address Google will not vouch for', () => {
    // The attack this closes: set an unverified address on a Google account
    // that matches somebody's OMNIPLAY account, sign in with Google, and walk
    // straight into their library. Nothing about an unverified address is
    // evidence of controlling it.
    it('is never linked to an account that already holds it', () => {
      const decision = decide({ emailVerified: false, emailBelongsToExistingUser: true });

      expect(decision.action).toBe('refuse');
      expect(decision.action === 'refuse' && decision.reason).toMatch(/not verified/i);
    });

    // Refusing to create is a smaller point but the same principle: an
    // account opened on an unverified address squats on it, and the person
    // who actually owns it can then never register.
    it('is not used to open a new account either', () => {
      expect(decide({ emailVerified: false }).action).toBe('refuse');
    });

    it('says what to do instead, rather than just failing', () => {
      const decision = decide({ emailVerified: false });
      expect(decision.action === 'refuse' && decision.reason).toMatch(/password/i);
    });

    // Google omits the claim entirely rather than sending false in some
    // cases, and an absent claim is not a verified one.
    it('treats a missing verification claim as unverified', () => {
      expect(decide({ emailVerified: undefined }).action).toBe('refuse');
    });
  });

  describe('no address at all', () => {
    // Happens when the email scope is declined. Every account here is keyed
    // by email, so there is nothing to build from.
    it('refuses, and says why', () => {
      const decision = decide({ email: undefined });

      expect(decision.action).toBe('refuse');
      expect(decision.action === 'refuse' && decision.reason).toMatch(/did not share an email/i);
    });

    it('refuses an address that is only whitespace', () => {
      expect(decide({ email: '   ' }).action).toBe('refuse');
    });
  });

  describe('a verified address', () => {
    it('links to the account that already holds it', () => {
      expect(decide({ emailBelongsToExistingUser: true })).toEqual({ action: 'link' });
    });

    it('opens a new account when nothing holds it', () => {
      expect(decide({})).toEqual({ action: 'create', email: 'player@example.com' });
    });

    // Addresses are stored lowercased and matched that way, so the decision
    // has to hand back the normalised form rather than whatever Google sent.
    it('normalises the address it hands back', () => {
      expect(decide({ email: '  Player@Example.COM  ' })).toEqual({
        action: 'create',
        email: 'player@example.com',
      });
    });
  });

  describe('the whole table', () => {
    // Written out so the shape of the rules is visible in one place, and a
    // change that alters one row has to alter this too.
    const rows: Array<[boolean, string | undefined, boolean | undefined, boolean, string]> = [
      // identity, email, verified, emailTaken, expected
      [true, 'a@b.com', true, false, 'sign-in'],
      [true, undefined, undefined, false, 'sign-in'],
      [false, undefined, true, false, 'refuse'],
      [false, 'a@b.com', false, false, 'refuse'],
      [false, 'a@b.com', false, true, 'refuse'],
      [false, 'a@b.com', undefined, true, 'refuse'],
      [false, 'a@b.com', true, true, 'link'],
      [false, 'a@b.com', true, false, 'create'],
    ];

    it.each(rows)(
      'identity=%s email=%s verified=%s taken=%s -> %s',
      (identityExists, email, emailVerified, emailBelongsToExistingUser, expected) => {
        expect(
          decideGoogleAccount({
            email,
            emailVerified,
            identityExists,
            emailBelongsToExistingUser,
          }).action,
        ).toBe(expected);
      },
    );

    // The one row that must never appear: taking over an existing account
    // without Google having verified the address.
    it('never links or creates on an unverified address', () => {
      for (const taken of [true, false]) {
        for (const verified of [false, undefined]) {
          const action = decideGoogleAccount({
            email: 'a@b.com',
            emailVerified: verified,
            identityExists: false,
            emailBelongsToExistingUser: taken,
          }).action;

          expect(action).toBe('refuse');
        }
      }
    });
  });
});

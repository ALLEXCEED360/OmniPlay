import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateToken,
  hashToken,
  resetEncryptionKeyCache,
  safeEquals,
} from './crypto.js';

/**
 * Provider tokens grant read access to someone else's Xbox account, so these
 * are the tests that matter most in this package.
 */

const KEY_A = 'dGVzdC1rZXktZm9yLW9tbmlwbGF5LWVuY3J5cHRpb24hIQ==';
const KEY_B = 'YW5vdGhlci10ZXN0LWtleS1mb3Itb21uaXBsYXktdGVzdHMh';

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = KEY_A;
  resetEncryptionKeyCache();
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value', () => {
    const secret = 'xsts-token-value';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('round-trips unicode and long values intact', () => {
    const secret = `${'a'.repeat(4000)}-日本語-🎮`;
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces a different ciphertext each time', () => {
    // A fresh nonce per encryption; identical ciphertexts would leak that two
    // users hold the same token.
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('emits a versioned envelope so keys can be rotated later', () => {
    expect(encryptSecret('x').split('.')).toHaveLength(4);
    expect(encryptSecret('x').startsWith('v1.')).toBe(true);
  });

  it('never leaves the plaintext visible in the envelope', () => {
    expect(encryptSecret('super-secret-token')).not.toContain('super-secret-token');
  });

  describe('tamper resistance', () => {
    it('refuses a payload whose ciphertext was altered', () => {
      const [v, iv, tag, data] = encryptSecret('original').split('.');
      const flipped = Buffer.from(data!, 'base64');
      flipped[0] ^= 0xff;
      expect(() =>
        decryptSecret([v, iv, tag, flipped.toString('base64')].join('.')),
      ).toThrow();
    });

    it('refuses a payload whose auth tag was altered', () => {
      const [v, iv, , data] = encryptSecret('original').split('.');
      const forgedTag = Buffer.alloc(16, 1).toString('base64');
      expect(() => decryptSecret([v, iv, forgedTag, data].join('.'))).toThrow();
    });

    it('refuses a payload encrypted under a different key', () => {
      const payload = encryptSecret('original');
      process.env.CREDENTIAL_ENCRYPTION_KEY = KEY_B;
      resetEncryptionKeyCache();
      expect(() => decryptSecret(payload)).toThrow();
    });

    it('refuses a malformed envelope', () => {
      expect(() => decryptSecret('not-an-envelope')).toThrow(/Malformed/);
    });

    it('refuses an unknown envelope version', () => {
      const payload = encryptSecret('x').replace(/^v1\./, 'v99.');
      expect(() => decryptSecret(payload)).toThrow(/version/);
    });
  });

  describe('key configuration', () => {
    it('fails loudly when no key is configured', () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      resetEncryptionKeyCache();
      expect(() => encryptSecret('x')).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    });

    it('rejects a key that is too short to be plausible', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = 'short';
      resetEncryptionKeyCache();
      expect(() => encryptSecret('x')).toThrow(/at least 32/);
    });

    it('accepts a long non-base64 passphrase by hashing it to length', () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = 'a-long-development-passphrase-that-is-not-base64!';
      resetEncryptionKeyCache();
      expect(decryptSecret(encryptSecret('x'))).toBe('x');
    });
  });
});

describe('hashToken', () => {
  it('is deterministic and hides the input', () => {
    const token = 'session-cookie-value';
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it('separates different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('generateToken', () => {
  it('produces url-safe, non-repeating values', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('safeEquals', () => {
  it('compares equal and unequal values correctly', () => {
    expect(safeEquals('abc', 'abc')).toBe(true);
    expect(safeEquals('abc', 'abd')).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    expect(safeEquals('abc', 'abcdef')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('Correct horse battery staple', hash)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('same', a)).resolves.toBe(true);
    await expect(verifyPassword('same', b)).resolves.toBe(true);
  });

  it('records its cost parameters so they can be raised later', async () => {
    const [scheme, N, r, p] = (await hashPassword('x')).split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(N)).toBe(65536);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it('handles unicode and long passwords', async () => {
    const password = `🔐-日本語-${'x'.repeat(180)}`;
    const hash = await hashPassword(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  describe('malformed stored hashes', () => {
    it.each([
      ['empty', ''],
      ['not a hash', 'plaintext'],
      ['wrong scheme', 'bcrypt$65536$8$1$c2FsdA==$aGFzaA=='],
      ['too few fields', 'scrypt$65536$8$c2FsdA=='],
      ['non-numeric cost', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
    ])('returns false rather than throwing for %s', async (_label, stored) => {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    });
  });
});

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Promise wrapper over scrypt.
 *
 * Hand-written rather than `promisify(scrypt)` because promisify resolves to
 * the three-argument overload and loses the options parameter we need for the
 * cost settings below.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing with scrypt.
 *
 * scrypt over bcrypt/argon2 because it ships in Node's standard library: no
 * native module, no prebuilt-binary problems across Windows/Linux/CI, and it
 * is a memory-hard KDF that OWASP considers acceptable when configured as
 * below. Argon2id would be marginally preferable if a native dependency were
 * acceptable.
 *
 * Format: `scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>`
 * Parameters live in the string so raising the cost later does not invalidate
 * existing hashes.
 */

const PARAMS = { N: 2 ** 16, r: 8, p: 1, keyLength: 64 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, PARAMS.keyLength, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    // Node's default maxmem is too small for N=2^16 and throws without this.
    maxmem: 256 * 1024 * 1024,
  });

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
    string, string, string, string, string, string,
  ];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const expected = Buffer.from(hashB64, 'base64');
  let derived: Buffer;
  try {
    derived = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  // Length check first: timingSafeEqual throws on a mismatch.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

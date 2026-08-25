import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Envelope encryption for provider credentials.
 *
 * Provider tokens are the most sensitive thing OMNIPLAY stores: they grant
 * read access to someone else's Xbox account. They are encrypted here, at the
 * boundary of the database package, so there is no code path that writes a
 * plaintext token to a column.
 *
 * Format: `v1.<iv-b64>.<tag-b64>.<ciphertext-b64>`
 *
 * The version prefix exists so a key rotation can decrypt v1 with the old key
 * and re-wrap as v2 without guessing at the payload shape.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const CURRENT_VERSION = 'v1';

let cachedKey: Buffer | null = null;

/**
 * Derives the 32-byte key from CREDENTIAL_ENCRYPTION_KEY.
 *
 * A base64 or hex value of exactly 32 bytes is used directly. Anything else is
 * hashed to length, which keeps local development workable while still
 * refusing obviously unsafe input.
 */
export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    );
  }
  if (raw.length < 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters.');
  }

  for (const encoding of ['base64', 'hex'] as const) {
    try {
      const decoded = Buffer.from(raw, encoding);
      if (decoded.length === 32) {
        cachedKey = decoded;
        return cachedKey;
      }
    } catch {
      // fall through to the hash path
    }
  }

  cachedKey = createHash('sha256').update(raw, 'utf8').digest();
  return cachedKey;
}

/** Test seam: forget the derived key so a changed env var takes effect. */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    CURRENT_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted payload.');
  }
  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== CURRENT_VERSION) {
    throw new Error(`Unsupported credential encryption version: ${version}`);
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  // GCM authentication failure throws here, which is what we want: a tampered
  // or wrong-key row must fail loudly rather than yield garbage.
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Nullable convenience wrappers, since most credential fields are optional. */
export function encryptOptional(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : encryptSecret(value);
}

export function decryptOptional(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : decryptSecret(value);
}

/** Session cookies are stored as a hash, never in the clear. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time compare for state/nonce values. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

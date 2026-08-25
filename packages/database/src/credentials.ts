import type { ProviderCredentials } from '@omniplay/types';
import type { ProviderCredential } from '@prisma/client';
import { decryptOptional, encryptOptional } from './crypto.js';

/**
 * The only sanctioned translation between a ProviderCredential row and the
 * plaintext credentials an adapter uses.
 *
 * Keeping both directions here means the encryption boundary is one file wide.
 * Nothing else in the codebase should touch `accessTokenEncrypted`.
 */

/** Columns written by `toCredentialRow`, excluding row identity. */
export interface EncryptedCredentialFields {
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  extraEncrypted: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export function toCredentialRow(credentials: ProviderCredentials): EncryptedCredentialFields {
  return {
    accessTokenEncrypted: encryptOptional(credentials.accessToken),
    refreshTokenEncrypted: encryptOptional(credentials.refreshToken),
    // `extra` holds provider-specific secrets (Xbox userhash and XSTS token),
    // so it is encrypted as a whole rather than stored as readable JSON.
    extraEncrypted: credentials.extra ? encryptOptional(JSON.stringify(credentials.extra)) : null,
    expiresAt: credentials.expiresAt ?? null,
    scopes: credentials.scopes ?? [],
  };
}

export function fromCredentialRow(row: ProviderCredential | null): ProviderCredentials {
  if (!row) return {};

  const extraJson = decryptOptional(row.extraEncrypted);
  let extra: Record<string, unknown> | undefined;
  if (extraJson) {
    try {
      extra = JSON.parse(extraJson) as Record<string, unknown>;
    } catch {
      // A corrupt extra blob should degrade to "needs reconnect", not crash
      // the whole sync; the adapter will report AUTH_EXPIRED when it finds
      // the XSTS token missing.
      extra = undefined;
    }
  }

  return {
    accessToken: decryptOptional(row.accessTokenEncrypted),
    refreshToken: decryptOptional(row.refreshTokenEncrypted),
    expiresAt: row.expiresAt,
    scopes: row.scopes,
    ...(extra ? { extra } : {}),
  };
}

/** True when the credential is expired or close enough to warrant a refresh. */
export function needsRefresh(credentials: ProviderCredentials, skewMs = 120_000): boolean {
  if (!credentials.expiresAt) return false;
  return credentials.expiresAt.getTime() - skewMs <= Date.now();
}

import type { ExternalGame, ProviderId, ProviderSession } from '@omniplay/types';
import type { PrismaClient } from '@prisma/client';

/**
 * Storage side of file-backed providers (spec 5.3).
 *
 * Lives in the database package because both the API (which writes batches)
 * and the worker (which consumes them) need identical behaviour, and neither
 * app may import from the other.
 */

/**
 * Builds the loader that import-backed providers read through.
 *
 * The provider adapter calls this and gets `ExternalGame[]` - exactly what a
 * Steam or Xbox adapter would produce from an HTTP response. That symmetry is
 * the whole point: nothing downstream can tell the difference.
 */
export function createImportRecordLoader(prisma: PrismaClient) {
  return async (provider: ProviderId, session: ProviderSession): Promise<ExternalGame[]> => {
    // Import accounts are keyed "import:<userId>", since no provider-side
    // identity exists for a file.
    const userId = session.providerUserId.replace(/^import:/, '');

    const batch = await prisma.importBatch.findFirst({
      where: { userId, provider, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!batch) return [];

    const records = batch.records as unknown as ExternalGame[];

    // Dates are strings after the JSON round-trip. The ingestion pipeline
    // expects Date objects and would otherwise write invalid timestamps.
    return records.map((record) => ({
      ...record,
      lastPlayedAt: reviveDate(record.lastPlayedAt),
      ...(record.ownership
        ? {
            ownership: {
              ...record.ownership,
              acquiredAt: reviveDate(record.ownership.acquiredAt),
            },
          }
        : {}),
    }));
  };
}

/**
 * Marks pending batches consumed.
 *
 * Called after a successful ingestion; without it every subsequent sync would
 * re-import the same file. Upserts make that harmless, but it would also make
 * every sync report thousands of records it did not really fetch.
 */
export async function markBatchProcessed(
  prisma: PrismaClient,
  userId: string,
  provider: ProviderId,
): Promise<void> {
  await prisma.importBatch.updateMany({
    where: { userId, provider, status: 'PENDING' },
    data: { status: 'PROCESSED', processedAt: new Date() },
  });
}

function reviveDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

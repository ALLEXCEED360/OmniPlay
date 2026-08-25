import { BadRequestException, Injectable } from '@nestjs/common';
import { IMPORT_PROVIDER_IDS, findCatalogueEntry, parseImportFile } from '@omniplay/providers';
import type { ProviderId } from '@omniplay/types';
import { PrismaService } from '../common/prisma.service.js';

/**
 * File-backed provider ingestion (spec 5.3).
 *
 * An upload creates a `ConnectedAccount` and a pending `ImportBatch`. The
 * SyncRunner then consumes it through the ordinary provider interface, so the
 * records go through the same resolution, provenance and dedupe as anything
 * that arrived over an API.
 */

/**
 * Providers whose data arrives by file, taken from the catalogue rather than
 * hard-coded — otherwise adding Ubisoft or EA silently fails at upload.
 */
const IMPORT_PROVIDERS = new Set<ProviderId>(IMPORT_PROVIDER_IDS);

/** Guards against a paste large enough to exhaust memory during parsing. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService) {}

  static isImportProvider(provider: ProviderId): boolean {
    return IMPORT_PROVIDERS.has(provider);
  }

  /**
   * Parses an uploaded file and stores it for the next sync.
   *
   * Parsing happens here rather than in the worker so the user gets their
   * warnings immediately - "row 14 had no title" is only useful while they are
   * still looking at the file they just chose.
   */
  async createBatch(input: {
    userId: string;
    provider: ProviderId;
    content: string;
    filename?: string | undefined;
  }) {
    if (!ImportService.isImportProvider(input.provider)) {
      throw new BadRequestException(`${input.provider} does not accept file imports.`);
    }
    if (!input.content.trim()) {
      throw new BadRequestException('That file is empty.');
    }
    if (Buffer.byteLength(input.content, 'utf8') > MAX_IMPORT_BYTES) {
      throw new BadRequestException('That file is larger than the 5 MB import limit.');
    }

    let parsed;
    try {
      parsed = parseImportFile(input.content, { provider: input.provider });
    } catch (error) {
      // Parser errors are written for users ("check for a trailing comma"),
      // so they are surfaced rather than replaced with a generic message.
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Could not read that file.',
      );
    }

    if (parsed.games.length === 0) {
      throw new BadRequestException(
        'No games were found in that file. It needs a header row with at least a "title" column.',
      );
    }

    const account = await this.prisma.client.connectedAccount.upsert({
      where: { userId_provider: { userId: input.userId, provider: input.provider } },
      create: {
        userId: input.userId,
        provider: input.provider,
        // No provider-side identity exists for an import, so the account is
        // keyed on our own user id to satisfy the uniqueness constraint.
        providerUserId: `import:${input.userId}`,
        displayName: `${findCatalogueEntry(input.provider)?.displayName ?? input.provider} (imported)`,
        status: 'ACTIVE',
      },
      update: { status: 'ACTIVE', statusMessage: null },
    });

    // Supersede any batch the previous upload left unconsumed, so two uploads
    // in a row do not both get ingested.
    await this.prisma.client.importBatch.updateMany({
      where: { userId: input.userId, provider: input.provider, status: 'PENDING' },
      data: { status: 'SUPERSEDED', processedAt: new Date() },
    });

    const batch = await this.prisma.client.importBatch.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        filename: input.filename ?? null,
        format: input.content.trimStart().startsWith('[') ? 'json' : 'csv',
        records: parsed.games as unknown as object,
        recordCount: parsed.games.length,
        warnings: parsed.warnings as unknown as object,
        status: 'PENDING',
      },
    });

    await this.prisma.client.auditLog.create({
      data: {
        userId: input.userId,
        action: 'provider.import',
        target: input.provider,
        metadata: { batchId: batch.id, records: parsed.games.length },
      },
    });

    return {
      batchId: batch.id,
      accountId: account.id,
      imported: parsed.imported,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
    };
  }

  async listBatches(userId: string) {
    return this.prisma.client.importBatch.findMany({
      where: { userId },
      // `records` is deliberately excluded: it can be megabytes.
      select: {
        id: true,
        provider: true,
        filename: true,
        format: true,
        recordCount: true,
        status: true,
        warnings: true,
        createdAt: true,
        processedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}

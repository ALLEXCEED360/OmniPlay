import {
  ProviderError,
  type AuthCompleteResult,
  type AuthStartResult,
  type ExternalGame,
  type ExternalPlayEvent,
  type GamingProvider,
  type ProviderCapabilities,
  type ProviderId,
  type ProviderSession,
} from '@omniplay/types';

/**
 * A provider whose data arrives by file rather than by API (spec 5.3).
 *
 * This is the real test of the provider abstraction. PlayStation has no public
 * consumer API, so rather than bolting on a separate import pipeline, an
 * import-backed source implements the *same* `GamingProvider` contract. The
 * SyncRunner, entity resolution, provenance, statistics and every UI screen
 * work on it unchanged — none of them know the difference.
 *
 * The one thing it cannot do is authenticate, which is stated honestly through
 * `capabilities.importOnly` rather than by throwing somewhere surprising. The
 * connect flow branches on that flag, not on the provider's name.
 */

/** Supplies the pending import records for a user. */
export type ImportRecordLoader = (
  provider: ProviderId,
  session: ProviderSession,
) => Promise<ExternalGame[]>;

export interface ImportProviderConfig {
  id: ProviderId;
  displayName: string;
  loadRecords: ImportRecordLoader;
  /** Overrides for a source that can supply more than the generic minimum. */
  capabilities?: Partial<ProviderCapabilities>;
}

export class ImportProvider implements GamingProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly config: ImportProviderConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
    this.capabilities = {
      // Whatever the user chose to put in the file. Complete by their measure,
      // never verifiable by ours.
      library: 'partial',
      playtime: 'partial',
      achievements: 'none',
      playHistory: 'none',
      profile: 'none',
      incrementalSync: false,
      importOnly: true,
      ...config.capabilities,
    };
  }

  /**
   * There is no authorisation flow to start.
   *
   * The message is worded for a user who somehow reached this path, not for a
   * developer reading a stack trace.
   */
  async beginAuth(): Promise<AuthStartResult> {
    throw new ProviderError(
      'UNAVAILABLE',
      `${this.displayName} does not offer a sign-in for third-party apps. ` +
        'Upload a library file instead.',
      { provider: this.id },
    );
  }

  async completeAuth(): Promise<AuthCompleteResult> {
    throw new ProviderError(
      'UNAVAILABLE',
      `${this.displayName} connections are created by uploading a file.`,
      { provider: this.id },
    );
  }

  async *getLibrary(session: ProviderSession): AsyncIterable<ExternalGame> {
    for (const game of await this.config.loadRecords(this.id, session)) {
      yield game;
    }
  }

  /**
   * Playtime the user declared.
   *
   * Emitted as `USER_DECLARED` rather than `LIFETIME_TOTAL` so statistics can
   * tell a figure someone typed from one a platform reported — and so it is
   * never presented with the same confidence.
   */
  async *getPlayHistory(session: ProviderSession): AsyncIterable<ExternalPlayEvent> {
    for (const game of await this.config.loadRecords(this.id, session)) {
      if (!game.minutesPlayedTotal || game.minutesPlayedTotal <= 0) continue;
      yield {
        externalGameId: game.externalId,
        activityType: 'USER_DECLARED',
        minutesPlayed: game.minutesPlayedTotal,
        endedAt: game.lastPlayedAt ?? null,
        confidence: 'DECLARED',
      };
    }
  }

  async disconnect(): Promise<void> {
    // Nothing external to revoke; the caller deletes the local records.
  }
}

/**
 * The PlayStation provider.
 *
 * Deliberately *not* built on a reverse-engineered endpoint (spec 5.3, 41).
 * If official or partner access is obtained later, a PsnApiProvider can replace
 * this behind the same interface with no change anywhere else.
 */
export function createPsnProvider(loadRecords: ImportRecordLoader): ImportProvider {
  return new ImportProvider({
    id: 'psn',
    displayName: 'PlayStation',
    loadRecords,
  });
}

/**
 * A catch-all source for physical copies, retro consoles and anything else a
 * user wants on record (spec 2.4). Same machinery, different label.
 */
export function createManualProvider(loadRecords: ImportRecordLoader): ImportProvider {
  return new ImportProvider({
    id: 'manual',
    displayName: 'Manual entry',
    loadRecords,
  });
}

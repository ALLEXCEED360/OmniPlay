import type { ProviderId } from './domain.js';

/**
 * The queue contract shared by the API (which enqueues) and the worker (which
 * consumes). Keeping it in `types` rather than in either app is what stops the
 * two from drifting into a silent mismatch on a job payload field.
 */

// BullMQ rejects ':' in queue names (it uses the colon as its own Redis key
// separator), so this is hyphenated while the pub/sub channel below is not.
export const SYNC_QUEUE = 'omniplay-sync';

export interface SyncJobPayload {
  syncJobId: string;
  userId: string;
  provider: ProviderId;
  /** Ignore cursors and re-read the provider from scratch. */
  full: boolean;
  /** Also sweep achievements, which costs one request per game on Steam. */
  includeAchievements: boolean;
}

/** Progress events published back to the API over Redis pub/sub (spec 14). */
export const SYNC_EVENTS_CHANNEL = 'omniplay:sync:events';

export interface SyncProgressEvent {
  syncJobId: string;
  userId: string;
  provider: ProviderId;
  phase: string;
  /** 0-100, or null when the provider cannot report a total. */
  progress: number | null;
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELLED';
  message?: string;
}

/**
 * Metadata enrichment runs on its own queue, not the sync queue.
 *
 * A user pressing Sync must not queue behind an admin's 500-game IGDB backfill,
 * and the two have completely different rate profiles: sync is bounded by the
 * provider, enrichment by IGDB's 4 requests/second.
 */
export const METADATA_QUEUE = 'omniplay-metadata';

export interface MetadataJobPayload {
  /** Specific games to enrich; omit to sweep provisional rows. */
  gameIds?: string[];
  /** Cap on a sweep, so one job cannot run for hours. */
  limit?: number;
  /** Who asked, for the audit log. */
  requestedBy?: string;
}

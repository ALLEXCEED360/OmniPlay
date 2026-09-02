import { describe, expect, it } from 'vitest';
import { INTERRUPTED_AFTER_MS, selectInterrupted, type JobLike } from './interrupted-jobs.js';

/**
 * Which jobs are genuinely abandoned.
 *
 * The cost of getting this wrong runs both ways, so both directions are
 * pinned: too eager and a running sync is declared dead underneath itself,
 * too lax and the dashboard keeps reporting work that stopped days ago.
 */

const NOW = new Date('2026-09-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 60 * 60 * 1000;

const job = (over: Partial<JobLike> = {}): JobLike => ({
  id: 'j1',
  status: 'RUNNING',
  startedAt: ago(HOUR),
  createdAt: ago(HOUR),
  ...over,
});

describe('selectInterrupted', () => {
  describe('leaves alone', () => {
    it('a sync that started recently', () => {
      expect(selectInterrupted([job({ startedAt: ago(5 * 60_000) })], NOW)).toEqual([]);
    });

    // The threshold is generous precisely so a slow-but-live sweep is never
    // cut off. One minute under it is still running.
    it('a long sync that is still inside the threshold', () => {
      const nearly = job({ startedAt: ago(INTERRUPTED_AFTER_MS - 60_000) });
      expect(selectInterrupted([nearly], NOW)).toEqual([]);
    });

    it('jobs that already reached a final state', () => {
      const finished = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL'].map((status) =>
        job({ status, startedAt: ago(100 * HOUR) }),
      );
      expect(selectInterrupted(finished, NOW)).toEqual([]);
    });
  });

  describe('reconciles', () => {
    it('a job still marked running long after the threshold', () => {
      // The real one: an xbox sync recorded as running for forty-five hours.
      const stranded = job({ id: 'xbox', startedAt: ago(45 * HOUR) });
      expect(selectInterrupted([stranded], NOW).map((j) => j.id)).toEqual(['xbox']);
    });

    // A row orphaned before any worker picked it up has no startedAt at all,
    // and judging it by createdAt is the only way it is ever caught.
    it('a queued job that no worker ever started', () => {
      const orphan = job({ status: 'QUEUED', startedAt: null, createdAt: ago(10 * HOUR) });
      expect(selectInterrupted([orphan], NOW).map((j) => j.id)).toEqual(['j1']);
    });

    it('does not treat a freshly queued job as orphaned', () => {
      const fresh = job({ status: 'QUEUED', startedAt: null, createdAt: ago(30_000) });
      expect(selectInterrupted([fresh], NOW)).toEqual([]);
    });
  });

  describe('the boundary', () => {
    it('is inclusive at exactly the threshold', () => {
      expect(selectInterrupted([job({ startedAt: ago(INTERRUPTED_AFTER_MS) })], NOW)).toHaveLength(
        1,
      );
    });
  });

  describe('a second worker', () => {
    // The history here includes two workers running at once by accident. If
    // startup reconciliation killed every RUNNING row, one starting worker
    // would destroy the other's in-flight jobs — so the threshold has to be
    // long enough that only genuinely dead work is inside it.
    it('cannot kill work another worker just started', () => {
      const inFlight = [
        job({ id: 'a', startedAt: ago(30_000) }),
        job({ id: 'b', startedAt: ago(20 * 60_000) }),
      ];
      expect(selectInterrupted(inFlight, NOW)).toEqual([]);
    });
  });

  it('sorts nothing and keeps only what it was given', () => {
    const jobs = [job({ id: 'a', startedAt: ago(50 * HOUR) }), job({ id: 'b' })];
    const picked = selectInterrupted(jobs, NOW);
    expect(picked).toHaveLength(1);
    expect(jobs).toHaveLength(2);
  });
});

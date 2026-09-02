import type { PrismaClient } from '@omniplay/database';

/**
 * Sync jobs that were running when their worker stopped existing.
 *
 * Nothing reconciled these. A worker killed mid-sync — a deploy, a crash, a
 * developer restarting the stack — left its SyncJob row saying RUNNING, and
 * nothing would ever say otherwise: the row is our own bookkeeping, not
 * BullMQ's, so BullMQ's stalled-job handling never touches it. One xbox sync
 * had been "running" for forty-five hours.
 *
 * That is worse than a plain failure. A job that failed is a fact you can act
 * on; a job that is permanently mid-flight is a question, and it makes the
 * dashboard claim work is happening when nothing is.
 */

/**
 * How long a sync may legitimately run before a RUNNING row is treated as
 * abandoned.
 *
 * Deliberately generous. There is no heartbeat on these rows, so "still
 * working" and "died an hour ago" look identical from here, and the only safe
 * reading is the one that cannot cut off a real sync. A full PlayStation
 * trophy sweep is the slowest thing this queue does and finishes far inside
 * this. It also protects against a second worker: if two are running, neither
 * can kill the other's in-flight work, only genuinely ancient rows.
 */
export const INTERRUPTED_AFTER_MS = 2 * 60 * 60 * 1000;

export interface JobLike {
  id: string;
  status: string;
  startedAt: Date | null;
  createdAt: Date;
}

/**
 * Which of these rows describe work that is no longer happening.
 *
 * A job that never started is judged from when it was queued, so a row that
 * was enqueued and then orphaned before any worker picked it up is caught too
 * rather than sitting as QUEUED forever.
 */
export function selectInterrupted<T extends JobLike>(
  jobs: T[],
  now: Date,
  afterMs: number = INTERRUPTED_AFTER_MS,
): T[] {
  return jobs.filter((job) => {
    if (job.status !== 'RUNNING' && job.status !== 'QUEUED') return false;
    const since = job.startedAt ?? job.createdAt;
    return now.getTime() - since.getTime() >= afterMs;
  });
}

/**
 * Marks abandoned jobs as failed, with a reason that says what happened.
 *
 * Run at worker startup. The reason matters as much as the status: this
 * codebase already contains one FAILED row carrying no error at all, written
 * by a code path that no longer exists, and it is unactionable — you cannot
 * tell what went wrong, or even whether anything did.
 */
export async function reconcileInterruptedJobs(
  db: Pick<PrismaClient, 'syncJob'>,
  now: Date = new Date(),
  afterMs: number = INTERRUPTED_AFTER_MS,
): Promise<{ reconciled: number }> {
  const candidates = await db.syncJob.findMany({
    where: { status: { in: ['RUNNING', 'QUEUED'] } },
    select: { id: true, status: true, startedAt: true, createdAt: true },
  });

  const stale = selectInterrupted(candidates, now, afterMs);
  if (stale.length === 0) return { reconciled: 0 };

  const hours = Math.round(afterMs / 3_600_000);
  await db.syncJob.updateMany({
    where: { id: { in: stale.map((job) => job.id) } },
    data: {
      status: 'FAILED',
      phase: 'interrupted',
      finishedAt: now,
      error:
        `This sync stopped without finishing — the worker was restarted or ` +
        `crashed while it was running, and it made no further progress for over ${hours} hours. ` +
        `Nothing already imported was lost. Run a sync again to continue.`,
      errorKind: 'INTERRUPTED',
    },
  });

  return { reconciled: stale.length };
}

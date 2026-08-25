'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface SyncJob {
  id: string;
  provider: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELLED';
  phase: string | null;
  recordsFetched: number;
  error: string | null;
  finishedAt: string | null;
}

/**
 * Sync All, with live progress (spec 14).
 *
 * Progress is polled rather than pushed. A websocket would be tidier, but a
 * sync is a rare, short-lived, user-initiated action, and polling only while
 * one is in flight avoids holding a socket open for every idle dashboard.
 */
export function SyncButton() {
  const router = useRouter();
  const [jobs, setJobs] = useState<SyncJob[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = jobs?.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING') ?? false;

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/sync/jobs`, { credentials: 'include' });
      if (!response.ok) return;
      const all = (await response.json()) as SyncJob[];
      // Only the newest job per provider is interesting for progress.
      const newest = new Map<string, SyncJob>();
      for (const job of all) if (!newest.has(job.provider)) newest.set(job.provider, job);
      setJobs([...newest.values()]);
    } catch {
      // A transient poll failure is not worth surfacing; the next tick retries.
    }
  }, []);

  useEffect(() => {
    if (!active) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        // Pull the freshly synced data into the server components.
        router.refresh();
      }
      return;
    }

    pollRef.current ??= setInterval(() => void poll(), 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [active, poll, router]);

  async function startSync() {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/sync/all`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? 'Could not start the sync.');
        return;
      }
      await poll();
    } catch {
      setError('Could not reach OMNIPLAY. Check your connection and try again.');
    } finally {
      setStarting(false);
    }
  }

  const failed = jobs?.filter((job) => job.status === 'FAILED') ?? [];

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void startSync()}
        disabled={starting || active}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg
          viewBox="0 0 24 24"
          className={`size-4 ${active ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M21 12a9 9 0 11-3-6.7M21 3v6h-6" />
        </svg>
        {active ? 'Syncing…' : 'Sync all'}
      </button>

      {active && jobs ? (
        <div className="glass w-64 rounded-lg p-3 text-xs" role="status" aria-live="polite">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="capitalize text-ink-300">{job.provider}</span>
              <span className="stat-figure text-ink-500">
                {job.status === 'RUNNING'
                  ? `${job.recordsFetched} processed`
                  : job.status.toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {/* Sync failures explain themselves and reassure about existing data. */}
      {failed.map((job) => (
        <p key={job.id} className="max-w-xs text-right text-xs text-warning">
          {job.provider}: {job.error ?? 'sync failed'} Your existing data is safe.
        </p>
      ))}
    </div>
  );
}

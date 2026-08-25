'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { providerLabel } from '@/lib/format';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/* ------------------------------------------------------------------ *
 * Unresolved queue
 * ------------------------------------------------------------------ */

interface UnresolvedRecord {
  id: string;
  provider: string;
  externalId: string;
  externalName: string;
  hitCount: number;
  candidates: Array<{ gameId: string; name: string; coverImage: string | null; score: number }>;
}

/**
 * The mapping screen (spec 26).
 *
 * Three outcomes, deliberately equal in prominence: map to an existing game,
 * create a new canonical game, or ignore. Making "map" the obvious default
 * would encourage clicking the top suggestion, which is exactly the reflex
 * that produces false merges.
 */
export function UnresolvedQueue({ records }: { records: UnresolvedRecord[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  async function act(id: string, path: string, body?: unknown) {
    setBusy(id);
    setErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      const response = await fetch(`${API_URL}/admin/unresolved/${id}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setErrors((prev) => ({ ...prev, [id]: payload?.message ?? 'That did not work.' }));
        return;
      }

      // Hidden locally rather than refetching the whole page: an admin works
      // through a queue, and a full reload after each decision loses their place.
      setResolved((prev) => new Set(prev).add(id));
      router.refresh();
    } catch {
      setErrors((prev) => ({ ...prev, [id]: 'Could not reach OMNIPLAY.' }));
    } finally {
      setBusy(null);
    }
  }

  const visible = records.filter((record) => !resolved.has(record.id));

  if (visible.length === 0) {
    return <p className="card p-6 text-sm text-ink-500">Queue cleared. Reload for more.</p>;
  }

  return (
    <div className="space-y-4">
      {visible.map((record) => (
        <div key={record.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink-100">{record.externalName}</div>
              <div className="mt-1 text-xs text-ink-500">
                {providerLabel(record.provider)} · id{' '}
                <code className="text-ink-400">{record.externalId}</code>
                {record.hitCount > 1 ? (
                  <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-warning">
                    seen {record.hitCount}×
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy === record.id}
                onClick={() => void act(record.id, 'create')}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition-colors hover:bg-ink-850 disabled:opacity-60"
              >
                Create new game
              </button>
              <button
                type="button"
                disabled={busy === record.id}
                onClick={() => void act(record.id, 'ignore')}
                className="rounded-lg px-3 py-1.5 text-xs text-ink-500 transition-colors hover:text-ink-300 disabled:opacity-60"
              >
                Ignore
              </button>
            </div>
          </div>

          {record.candidates.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs uppercase tracking-wider text-ink-600">
                Possible matches
              </p>
              <div className="space-y-1.5">
                {record.candidates.slice(0, 5).map((candidate) => (
                  <button
                    key={candidate.gameId}
                    type="button"
                    disabled={busy === record.id}
                    onClick={() => void act(record.id, 'map', { gameId: candidate.gameId })}
                    className="flex w-full items-center gap-3 rounded-lg border border-ink-800 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 disabled:opacity-60"
                  >
                    {candidate.coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={candidate.coverImage}
                        alt=""
                        className="h-10 w-7 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="h-10 w-7 shrink-0 rounded bg-ink-850" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-200">
                      {candidate.name}
                    </span>
                    <span
                      className={`stat-figure shrink-0 text-xs ${
                        candidate.score >= 0.9
                          ? 'text-positive'
                          : candidate.score >= 0.7
                            ? 'text-warning'
                            : 'text-ink-600'
                      }`}
                    >
                      {Math.round(candidate.score * 100)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-ink-600">
              No similar game in the catalogue. Create it, or ignore if this is a demo or tool.
            </p>
          )}

          {errors[record.id] ? (
            <p className="mt-3 text-xs text-danger">{errors[record.id]}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Enrichment
 * ------------------------------------------------------------------ */

/** Queues IGDB enrichment, for one game or for the whole provisional backlog. */
export function EnrichButton({ gameId, label }: { gameId?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function enqueue() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/admin/enrich`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(gameId ? { gameIds: [gameId] } : { limit: 100 }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setMessage(body?.message ?? 'Could not queue enrichment.');
        return;
      }

      setMessage('Queued.');
      // The worker runs asynchronously; give it a moment before re-reading.
      setTimeout(() => router.refresh(), 3000);
    } catch {
      setMessage('Could not reach OMNIPLAY.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void enqueue()}
        disabled={busy}
        className={
          gameId
            ? 'rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-850 disabled:opacity-60'
            : 'rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-accent-strong disabled:opacity-60'
        }
      >
        {busy ? 'Queueing…' : (label ?? 'Fetch missing metadata')}
      </button>
      {message ? <span className="text-xs text-ink-500">{message}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Merging
 * ------------------------------------------------------------------ */

interface DuplicateGroup {
  normalizedName: string;
  games: Array<{ id: string; name: string }>;
}

/**
 * Merges duplicate canonical games.
 *
 * The survivor is chosen explicitly rather than defaulted, because the merge
 * moves every user's ownership and playtime and cannot be undone from here.
 */
export function MergeDuplicates({ groups }: { groups: DuplicateGroup[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [winner, setWinner] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function merge(group: DuplicateGroup) {
    const key = group.normalizedName;
    const winnerId = winner[key] ?? group.games[0]?.id;
    if (!winnerId) return;

    const losers = group.games.filter((game) => game.id !== winnerId);
    setBusy(key);
    setErrors((prev) => ({ ...prev, [key]: '' }));

    try {
      for (const loser of losers) {
        const response = await fetch(`${API_URL}/admin/games/merge`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ loserId: loser.id, winnerId }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          setErrors((prev) => ({ ...prev, [key]: body?.message ?? 'Merge failed.' }));
          return;
        }
      }
      router.refresh();
    } catch {
      setErrors((prev) => ({ ...prev, [key]: 'Could not reach OMNIPLAY.' }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const key = group.normalizedName;
        const selected = winner[key] ?? group.games[0]?.id;

        return (
          <div key={key} className="card p-5">
            <p className="mb-3 text-xs text-ink-500">
              Keep which one? The others are merged into it.
            </p>

            <div className="space-y-1.5">
              {group.games.map((game) => (
                <label
                  key={game.id}
                  className="flex items-center gap-3 rounded-lg border border-ink-800 px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name={`winner-${key}`}
                    checked={selected === game.id}
                    onChange={() => setWinner((prev) => ({ ...prev, [key]: game.id }))}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-ink-200">{game.name}</span>
                  <code className="shrink-0 text-[10px] text-ink-600">{game.id.slice(-6)}</code>
                </label>
              ))}
            </div>

            <button
              type="button"
              disabled={busy === key}
              onClick={() => void merge(group)}
              className="mt-3 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-ink-100 disabled:opacity-60"
            >
              {busy === key ? 'Merging…' : `Merge ${group.games.length - 1} into selected`}
            </button>

            {errors[key] ? <p className="mt-2 text-xs text-danger">{errors[key]}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Queue sweep
 * ------------------------------------------------------------------ */

/**
 * Closes queue entries that metadata enrichment has already answered.
 *
 * Shows a preview before acting. Bulk-resolving a review queue without saying
 * what it will touch is how an admin stops trusting the queue.
 */
export function SweepQueueButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ resolved: number; remaining: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function call(dryRun: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/admin/unresolved/sweep?dryRun=${dryRun}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        setMessage('Could not run the sweep.');
        return;
      }

      const result = (await response.json()) as { resolved: number; remaining: number };

      if (dryRun) {
        setPreview(result);
        return;
      }

      setPreview(null);
      setMessage(`Closed ${result.resolved}. ${result.remaining} still need a decision.`);
      router.refresh();
    } catch {
      setMessage('Could not reach OMNIPLAY.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4">
      {preview === null ? (
        <button
          type="button"
          onClick={() => void call(true)}
          disabled={busy}
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-850 disabled:opacity-60"
        >
          {busy ? 'Checking…' : 'Check for already-answered entries'}
        </button>
      ) : (
        <div className="card p-4">
          <p className="text-sm text-ink-200">
            {preview.resolved} entr{preview.resolved === 1 ? 'y is' : 'ies are'} already mapped to a
            game with full metadata.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Closing them leaves {preview.remaining} that genuinely need a decision. Nothing about
            your library changes — these are queue entries, not games.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void call(false)}
              disabled={busy || preview.resolved === 0}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-ink-950 disabled:opacity-60"
            >
              {busy ? 'Closing…' : `Close ${preview.resolved}`}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-ink-400 hover:text-ink-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message ? <p className="mt-2 text-xs text-ink-400">{message}</p> : null}
    </div>
  );
}

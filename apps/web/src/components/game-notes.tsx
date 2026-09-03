'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDate, formatRelative } from '@/lib/format';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * What you thought, and when you thought it.
 *
 * A journal rather than a single text box, because that is what the model
 * describes and what the product is for. Every other fact on this page came
 * from a platform; this is the only one that can only come from you, and the
 * only one that would be lost entirely if OMNIPLAY were switched off.
 *
 * Entries are kept, not overwritten. What you made of a game on release and
 * what you make of it after a replay are two facts, and a single editable
 * field would silently discard the first.
 */

export interface GameNote {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export function GameNotes({ slug, notes }: { slug: string; notes: GameNote[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  async function send(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; errors?: Record<string, string> }
          | null;
        setError(payload?.errors?.body ?? payload?.message ?? 'That did not save.');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('Could not reach OMNIPLAY. Check your connection and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!draft.trim()) return;
    // Cleared only once the server has it. Wiping the box on submit and then
    // failing loses what someone just wrote.
    if (await send(`/library/game/${encodeURIComponent(slug)}/notes`, 'POST', { body: draft })) {
      setDraft('');
    }
  }

  async function saveEdit(id: string) {
    if (await send(`/library/notes/${id}`, 'PATCH', { body: editDraft })) {
      setEditing(null);
    }
  }

  return (
    <section className="card anim-rise p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow flex items-center gap-2 text-ink-400">
          <span className="h-3 w-0.5 rounded-full bg-accent/70" aria-hidden />
          Your notes
        </h2>
        {notes.length > 0 ? (
          <span className="stat-figure text-[11px] text-ink-600">{notes.length}</span>
        ) : null}
      </div>

      <div className="space-y-3">
        <label htmlFor="note" className="sr-only">
          Add a note about this game
        </label>
        <textarea
          id="note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="What did you make of it?"
          className="w-full resize-y rounded-lg border border-ink-800 bg-ink-900 px-3 py-2.5 text-sm leading-relaxed text-ink-100 transition-[border-color,box-shadow] duration-200 placeholder:text-ink-600 focus:border-accent focus:shadow-[0_0_0_3px] focus:shadow-accent/15 focus:outline-none"
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink-600">
            {draft.length > 3500 ? `${4000 - draft.length} characters left` : 'Kept private to you.'}
          </span>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || draft.trim().length === 0}
            className="btn-primary btn-sm disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>

      {error ? <p className="anim-fade mt-3 text-xs text-danger">{error}</p> : null}

      {notes.length > 0 ? (
        <ol className="mt-5 space-y-3">
          {notes.map((note) => {
            // An edited note says so rather than quietly presenting a later
            // thought under its original date.
            const edited = note.updatedAt !== note.createdAt;

            return (
              <li key={note.id} className="rounded-lg border border-ink-850 bg-ink-950/40 p-3">
                {editing === note.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      rows={3}
                      maxLength={4000}
                      aria-label="Edit note"
                      className="w-full resize-y rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm leading-relaxed text-ink-100 focus:border-accent focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={busy}
                        className="text-[11px] text-ink-500 transition-colors hover:text-ink-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEdit(note.id)}
                        disabled={busy || editDraft.trim().length === 0}
                        className="btn-primary btn-sm"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-200">
                      {note.body}
                    </p>

                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span
                        className="text-[11px] text-ink-600"
                        title={formatDate(note.createdAt)}
                      >
                        {formatRelative(note.createdAt)}
                        {edited ? ' · edited' : ''}
                      </span>

                      <span className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(note.id);
                            setEditDraft(note.body);
                            setConfirmingDelete(null);
                          }}
                          className="text-[11px] text-ink-500 transition-colors hover:text-ink-200"
                        >
                          Edit
                        </button>

                        {/* Two steps, because a note is the one thing here
                            that cannot be re-synced from anywhere. */}
                        {confirmingDelete === note.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void send(`/library/notes/${note.id}`, 'DELETE')}
                              disabled={busy}
                              className="text-[11px] text-danger transition-colors hover:underline"
                            >
                              Delete for good
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDelete(null)}
                              className="text-[11px] text-ink-500 transition-colors hover:text-ink-200"
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(note.id)}
                            className="text-[11px] text-ink-500 transition-colors hover:text-danger"
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 text-[11px] leading-snug text-ink-500">
          Nothing yet. Everything else on this page came from a platform — this
          is the part only you can write, and the part no sync will ever
          overwrite.
        </p>
      )}
    </section>
  );
}

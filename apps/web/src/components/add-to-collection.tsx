'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Collection {
  id: string;
  name: string;
  slug: string;
  gameCount: number;
}

/**
 * Adds the current game to a collection, from the game page.
 *
 * Collections are fetched on open rather than with the page: most visits to a
 * game page never touch this, and the list changes independently of the game.
 */
export function AddToCollection({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || collections) return;
    void fetch(`${API_URL}/collections`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Collection[]) => setCollections(data))
      .catch(() => setCollections([]));
  }, [open, collections]);

  async function add(collection: Collection) {
    setPending(collection.slug);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/collections/${collection.slug}/games`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        // A 409 means it is already there, which is information, not an error.
        setMessage(body?.message ?? 'Could not add to that collection.');
        return;
      }

      setMessage(`Added to ${collection.name}.`);
      setCollections(null);
      router.refresh();
    } catch {
      setMessage('Could not reach OMNIPLAY.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full btn-ghost"
      >
        Add to collection
      </button>

      {open ? (
        <div className="card mt-2 p-2">
          {collections === null ? (
            <p className="px-2 py-2 text-xs text-ink-500">Loading…</p>
          ) : collections.length === 0 ? (
            <p className="px-2 py-2 text-xs text-ink-500">
              You have no collections yet. Create one from the Collections page.
            </p>
          ) : (
            <ul>
              {collections.map((collection) => (
                <li key={collection.id}>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void add(collection)}
                    className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm text-ink-300 transition-colors hover:bg-ink-850 hover:text-ink-100 disabled:opacity-60"
                  >
                    <span className="truncate">{collection.name}</span>
                    <span className="stat-figure shrink-0 text-xs text-ink-600">
                      {pending === collection.slug ? '…' : collection.gameCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {message ? <p className="px-2 py-1.5 text-xs text-ink-400">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

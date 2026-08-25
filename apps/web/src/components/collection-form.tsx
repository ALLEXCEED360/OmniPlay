'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const VISIBILITIES = [
  { id: 'PRIVATE', label: 'Private', hint: 'Only you can see it.' },
  { id: 'UNLISTED', label: 'Unlisted', hint: 'Anyone with the link.' },
  { id: 'PUBLIC', label: 'Public', hint: 'Shown on your profile.' },
] as const;

/** Creates a collection, then navigates straight into it to start adding games. */
export function CreateCollectionButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API_URL}/collections`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          description: form.get('description') || undefined,
          visibility: form.get('visibility'),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? 'Could not create that collection.');
        return;
      }

      const created = (await response.json()) as { slug: string };
      setOpen(false);
      router.push(`/collections/${created.slug}`);
      router.refresh();
    } catch {
      setError('Could not reach OMNIPLAY. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-accent-strong"
      >
        New collection
      </button>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="card w-full max-w-md space-y-3 p-5">
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div>
        <label htmlFor="collection-name" className="mb-1.5 block text-sm text-ink-300">
          Name
        </label>
        <input
          id="collection-name"
          name="name"
          required
          maxLength={80}
          autoFocus
          placeholder="All-Time Favourites"
          className="w-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="collection-description" className="mb-1.5 block text-sm text-ink-300">
          Description <span className="text-ink-600">(optional)</span>
        </label>
        <input
          id="collection-description"
          name="description"
          maxLength={500}
          className="w-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-accent focus:outline-none"
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm text-ink-300">Visibility</legend>
        <div className="space-y-1.5">
          {VISIBILITIES.map((option, index) => (
            <label key={option.id} className="flex items-start gap-2.5 text-sm">
              <input
                type="radio"
                name="visibility"
                value={option.id}
                defaultChecked={index === 0}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <span>
                <span className="text-ink-200">{option.label}</span>
                <span className="ml-2 text-xs text-ink-600">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-2 text-sm text-ink-400 hover:text-ink-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Visibility switcher and delete, shown on a collection's own page. */
export function CollectionControls({
  slug,
  visibility,
  username,
}: {
  slug: string;
  visibility: string;
  username: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  async function setVisibility(next: string) {
    setBusy(true);
    try {
      await fetch(`${API_URL}/collections/${slug}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`${API_URL}/collections/${slug}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      router.push('/collections');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={visibility}
        disabled={busy}
        onChange={(event) => void setVisibility(event.target.value)}
        aria-label="Collection visibility"
        className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-accent focus:outline-none"
      >
        {VISIBILITIES.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      {visibility === 'PUBLIC' ? (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(`${window.location.origin}/u/${username}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:bg-ink-850"
        >
          {copied ? 'Link copied' : 'Copy profile link'}
        </button>
      ) : null}

      {confirming ? (
        <>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-ink-100 disabled:opacity-60"
          >
            Delete for good
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg px-3 py-2 text-sm text-ink-400 hover:text-ink-200"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg border border-ink-800 px-3 py-2 text-sm text-ink-400 hover:bg-ink-850 hover:text-ink-200"
        >
          Delete
        </button>
      )}
    </div>
  );
}

/** Removes a game from the collection it is shown in. */
export function RemoveFromCollection({ slug, gameId }: { slug: string; gameId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      aria-label="Remove from collection"
      onClick={async () => {
        setBusy(true);
        try {
          await fetch(`${API_URL}/collections/${slug}/games/${gameId}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-full bg-ink-950/80 text-ink-300 opacity-0 backdrop-blur transition-opacity hover:text-danger group-hover:opacity-100 disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    </button>
  );
}

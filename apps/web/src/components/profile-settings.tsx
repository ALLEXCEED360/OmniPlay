'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Public-profile controls (spec 4.7, 24).
 *
 * A profile is private until the user says otherwise, and the copy states
 * plainly what becomes visible — sharing a gaming history is a real disclosure,
 * not a toggle to bury.
 */
export function ProfileSettings({
  user,
}: {
  user: {
    username: string;
    displayName: string | null;
    bio: string | null;
    profilePublic: boolean;
  };
}) {
  const router = useRouter();
  const [isPublic, setIsPublic] = useState(user.profilePublic);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setSaved(false);
    try {
      const response = await fetch(`${API_URL}/profile`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await save({
      displayName: form.get('displayName'),
      bio: form.get('bio') || null,
    });
  }

  return (
    <div className="card p-5">
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div>
          <label htmlFor="displayName" className="mb-1.5 block text-sm text-ink-300">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            defaultValue={user.displayName ?? user.username}
            maxLength={60}
            className="w-full max-w-sm rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="bio" className="mb-1.5 block text-sm text-ink-300">
            Bio <span className="text-ink-600">(optional)</span>
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={2}
            maxLength={300}
            defaultValue={user.bio ?? ''}
            placeholder="RPGs, long campaigns, and a backlog I will absolutely get to."
            className="w-full max-w-lg rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="btn-primary"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {saved ? <span className="text-xs text-positive">Saved</span> : null}
        </div>
      </form>

      <div className="mt-6 border-t border-ink-850 pt-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isPublic}
            disabled={busy}
            onChange={(event) => {
              setIsPublic(event.target.checked);
              void save({ profilePublic: event.target.checked });
            }}
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />
          <span>
            <span className="text-sm text-ink-200">Make my profile public</span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-500">
              Anyone with the link can see your display name, bio, total games and hours, your
              most-played games, which platforms you use, and any collection marked Public.
              Your email, your platform account names and your individual collections stay private.
            </span>
          </span>
        </label>

        {isPublic ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href={`/u/${user.username}`}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-850"
            >
              View my profile
            </Link>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/u/${user.username}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-ink-850"
            >
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            <code className="text-xs text-ink-600">/u/{user.username}</code>
          </div>
        ) : null}
      </div>
    </div>
  );
}

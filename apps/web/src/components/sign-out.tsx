'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Sign out.
 *
 * The API has cleared sessions properly since the beginning — hashed token
 * deleted server-side, cookie cleared — but nothing in the interface called
 * it. The only way out of a session was to clear the cookie by hand, which is
 * a strange thing to ask of someone who is done for the evening, and a real
 * problem on a shared machine.
 *
 * `router.refresh()` rather than a client-side redirect: the app shell
 * resolves the session on the server for every request, so once the cookie is
 * gone the next render redirects to sign-in on its own. Pushing a route here
 * would race that.
 */
export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      // The cookie may already be gone, or the network may be down. Either
      // way the honest next step is the same: ask the server who we are.
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-200 disabled:opacity-60"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[18px] shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M15 17l5-5-5-5M20 12H9M12 3H6a2 2 0 00-2 2v14a2 2 0 002 2h6" />
      </svg>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Ends the session. Resolves whether or not the API could be reached: the
 * cookie may already be gone, or the network may be down, and either way
 * the honest next step is the same — ask the server who we are.
 */
export async function requestSignOut(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // See above.
  }
}

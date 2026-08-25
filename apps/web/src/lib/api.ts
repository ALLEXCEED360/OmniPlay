import { cookies } from 'next/headers';

/**
 * Server-side API client.
 *
 * Requests run on the Next server and forward the browser's session cookie, so
 * the token never reaches client JavaScript and provider data never transits a
 * public route (spec 23).
 */

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { parse?: boolean } = {},
): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const response = await fetch(new URL(path, API_URL), {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
      cookie: cookieHeader,
    },
    // Library and stats change on every sync, so nothing here is cacheable.
    cache: 'no-store',
  });

  if (!response.ok) {
    let body: unknown;
    let message = `Request failed (${response.status})`;
    try {
      body = await response.json();
      if (body && typeof body === 'object' && 'message' in body) {
        message = String((body as { message: unknown }).message);
      }
    } catch {
      // Non-JSON error body; the status message will do.
    }
    throw new ApiError(response.status, message, body);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Fetches, returning null on 401 instead of throwing - for optional reads. */
export async function apiFetchOptional<T>(path: string): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) return null;
    throw error;
  }
}

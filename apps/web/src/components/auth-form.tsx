'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Sign-in and sign-up.
 *
 * Field-level errors come straight from the API's Zod validation, so the rules
 * are stated once on the server and rendered here rather than duplicated (and
 * eventually contradicted) in the client.
 */
export function AuthForm({
  mode,
  /** Which sign-in methods this instance offers, asked of the API. */
  methods,
  /**
   * A failure carried back in the URL. The Google callback is a browser
   * redirect, so it has nowhere to put an error except the address bar.
   */
  initialError,
}: {
  mode: 'login' | 'register';
  methods: { password: boolean; google: boolean };
  initialError?: string | undefined;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialError ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const response = await fetch(`${API_URL}/auth/${mode}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string; errors?: Record<string, string> }
          | null;
        setMessage(body?.message ?? 'Something went wrong. Please try again.');
        if (body?.errors) setFieldErrors(body.errors);
        return;
      }

      router.push('/dashboard');
      // Ensures the layout re-resolves the new session server-side.
      router.refresh();
    } catch {
      setMessage('Could not reach OMNIPLAY. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {/* Rendered only when the instance has Google credentials. A button
          that leads to a configuration error is worse than no button. */}
      {methods.google ? (
        <>
          <a
            href={`${API_URL}/auth/google`}
            className="btn-ghost w-full justify-center py-2.5"
          >
            <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
              <path
                fill="#4285F4"
                d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.3 14.3a7.1 7.1 0 0 1 0-4.6v-3.1h-4a12 12 0 0 0 0 10.8l4-3.1z"
              />
              <path
                fill="#EA4335"
                d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"
              />
            </svg>
            Continue with Google
          </a>

          <div className="flex items-center gap-3" aria-hidden>
            <span className="rule-soft flex-1" />
            <span className="text-[11px] uppercase tracking-wider text-ink-600">or</span>
            <span className="rule-soft flex-1" />
          </div>
        </>
      ) : null}

      {message ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-ink-200">
          {message}
        </p>
      ) : null}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fieldErrors.email}
      />

      {mode === 'register' ? (
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          required
          hint="This becomes your public profile address."
          error={fieldErrors.username}
        />
      ) : null}

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        required
        {...(mode === 'register' ? { hint: 'At least 10 characters.' } : {})}
        error={fieldErrors.password}
      />

      <button
        type="submit"
        disabled={busy}
        className="btn-primary group relative w-full overflow-hidden py-2.5 disabled:cursor-wait"
      >
        {/* A sweep while the request is in flight. Dimming a button the reader
            just pressed removes the only confirmation they have that it
            registered; movement says "working" without taking anything away. */}
        {busy ? (
          <span className="shimmer absolute inset-0" aria-hidden />
        ) : null}
        <span className="relative">
          {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
        </span>
      </button>

      {mode === 'login' ? (
        <p className="text-center text-sm">
          <Link
            href="/forgot-password"
            className="text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-200"
          >
            Forgot your password?
          </Link>
        </p>
      ) : null}

      <p className="pt-2 text-center text-sm text-ink-500">
        {mode === 'register' ? (
          <>
            Already have an account?{' '}
            <Link href="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to OMNIPLAY?{' '}
            <Link href="/register" className="text-accent hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  error,
  ...props
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm text-ink-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`w-full rounded-lg border bg-ink-900 px-3 py-2.5 text-sm text-ink-100 transition-[border-color,box-shadow] duration-200 placeholder:text-ink-600 focus:outline-none ${
          error
            ? 'border-danger focus:shadow-[0_0_0_3px] focus:shadow-danger/20'
            : 'border-ink-800 focus:border-accent focus:shadow-[0_0_0_3px] focus:shadow-accent/15'
        }`}
        {...props}
      />
      {hint && !error ? (
        <p id={`${name}-hint`} className="mt-1.5 text-xs text-ink-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="anim-fade mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

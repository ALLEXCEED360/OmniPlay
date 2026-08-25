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
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-ink-950 transition-colors hover:bg-accent-strong disabled:opacity-60"
      >
        {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
      </button>

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
        className={`w-full rounded-lg border bg-ink-900 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:outline-none ${
          error ? 'border-danger' : 'border-ink-800 focus:border-accent'
        }`}
        {...props}
      />
      {hint && !error ? (
        <p id={`${name}-hint`} className="mt-1.5 text-xs text-ink-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

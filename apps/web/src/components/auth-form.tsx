'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthField, AuthNotice, GoogleButton, OrRule, SubmitButton } from '@/components/auth-ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Sign-in and sign-up.
 *
 * Google leads, the way it does on every sign-in screen a player already
 * uses; the password form follows under an "or". Field-level errors come
 * straight from the API's Zod validation, so the rules are stated once on
 * the server and rendered here rather than duplicated (and eventually
 * contradicted) in the client.
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

      // Through the title screen, then the menu.
      router.push('/boot');
      // Ensures the layout re-resolves the new session server-side.
      router.refresh();
    } catch {
      setMessage('Could not reach OMNIPLAY. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
      <GoogleButton
        href={`${API_URL}/auth/google`}
        configured={methods.google}
        label={mode === 'register' ? 'Sign up with Google' : 'Continue with Google'}
      />
      <OrRule />

      {message ? <AuthNotice tone="danger">{message}</AuthNotice> : null}

      <AuthField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fieldErrors.email}
      />

      {mode === 'register' ? (
        <AuthField
          label="Username"
          name="username"
          autoComplete="username"
          required
          hint="This becomes your public profile address."
          error={fieldErrors.username}
        />
      ) : null}

      <AuthField
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        required
        {...(mode === 'register' ? { hint: 'At least 10 characters.' } : {})}
        error={fieldErrors.password}
        aside={
          mode === 'login' ? (
            <Link
              href="/forgot-password"
              className="text-[11px] font-semibold normal-case tracking-normal text-accent underline-offset-2 hover:underline"
            >
              Forgot password?
            </Link>
          ) : null
        }
      />

      <SubmitButton busy={busy}>{mode === 'register' ? 'Create account' : 'Sign in'}</SubmitButton>

      <p className="pt-1 text-center text-sm text-ink-500">
        {mode === 'register' ? (
          <>
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-accent hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to OMNIPLAY?{' '}
            <Link href="/register" className="font-semibold text-accent hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

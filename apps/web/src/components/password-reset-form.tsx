'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The two halves of a password reset.
 *
 * `RequestReset` asks for an address and always says the same thing back. It
 * has to: the endpoint deliberately cannot tell the caller whether an account
 * exists, so a screen that reported "no account with that email" would be
 * inventing an answer the server refused to give — and handing anyone a way
 * to test which addresses are registered here.
 *
 * `ChooseNewPassword` consumes the link. The API signs the user straight in
 * on success, because making someone who has just proved control of their
 * inbox type the password they only just chose is ceremony.
 */

function Field({
  label,
  name,
  type,
  hint,
  autoComplete,
  autoFocus,
}: {
  label: string;
  name: string;
  type: string;
  hint?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm text-ink-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        className="w-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 transition-[border-color,box-shadow] duration-200 placeholder:text-ink-600 focus:border-accent focus:shadow-[0_0_0_3px] focus:shadow-accent/15 focus:outline-none"
      />
      {hint ? <p className="mt-1.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export function RequestReset({
  /**
   * Whether this instance can actually send mail. When it cannot, the
   * confirmation must not describe an inbox — see the panel below.
   */
  emailDelivery,
}: {
  emailDelivery: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');

    try {
      const response = await fetch(`${API_URL}/auth/password/forgot`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // 400 means the address was not a valid one, which is worth saying.
      // Anything else, including success, gets the same neutral answer.
      if (response.status === 400) {
        setError('That does not look like an email address.');
        return;
      }
      setSent(true);
    } catch {
      setError('Could not reach OMNIPLAY. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="anim-rise space-y-4">
        {emailDelivery ? (
          <>
            <div className="rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm text-ink-200">
              If that address has an account, a reset link is on its way. It
              works once and expires in an hour.
            </div>
            <p className="text-sm text-ink-500">
              Nothing arrived? Check the spam folder, then{' '}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="text-accent underline underline-offset-2"
              >
                try another address
              </button>
              .
            </p>
          </>
        ) : (
          /* No transport is configured, so no message was sent and saying one
             was "on its way" would leave someone watching an inbox for
             nothing. This describes the instance, not the address — it gives
             away no more about who has an account than the neutral wording
             above does. */
          <>
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink-200">
              <strong className="font-medium">No email was sent.</strong> This
              OMNIPLAY instance has no mail provider configured, so a reset
              link cannot reach an inbox.
            </div>
            <p className="text-sm text-ink-400">
              If the address has an account, the link was written to the API
              server log instead. Look for{' '}
              <code className="rounded bg-ink-850 px-1 py-0.5 text-xs text-ink-200">
                reset-password?token=
              </code>{' '}
              in the terminal running the API. It works once and expires in an
              hour.
            </p>
            {/* Names the actual next step. This used to say "add a provider
                in mailer.ts", which stopped being true the moment Resend was
                wired up — it sent the reader to edit code over a missing
                environment variable. */}
            <p className="text-sm text-ink-500">
              To send real email, set{' '}
              <code className="rounded bg-ink-850 px-1 py-0.5 text-xs text-ink-200">
                RESEND_API_KEY
              </code>{' '}
              in <code className="rounded bg-ink-850 px-1 py-0.5 text-xs text-ink-200">.env</code>{' '}
              and restart the API — it reads that file once, at startup.
            </p>
          </>
        )}
        <Link href="/login" className="btn-ghost w-full">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="anim-fade rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink-200"
        >
          {error}
        </div>
      ) : null}

      <Field label="Email" name="email" type="email" autoComplete="email" autoFocus />

      <button type="submit" disabled={busy} className="btn-primary group relative w-full overflow-hidden py-2.5">
        {busy ? <span className="shimmer absolute inset-0" aria-hidden /> : null}
        <span className="relative">
          {busy ? 'Working…' : emailDelivery ? 'Send reset link' : 'Create reset link'}
        </span>
      </button>

      <p className="pt-2 text-center text-sm text-ink-500">
        Remembered it?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ChooseNewPassword() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get('password') ?? '');

    try {
      const response = await fetch(`${API_URL}/auth/password/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? 'Could not reset your password. Please try again.');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Could not reach OMNIPLAY. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  // A link with no token in it cannot be completed, and the honest thing is
  // to say so immediately rather than after a password has been typed.
  if (!token) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink-200">
          This link is missing its reset code. It may have been cut short by
          your email client.
        </div>
        <Link href="/forgot-password" className="btn-ghost w-full">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="anim-fade rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink-200"
        >
          {error}{' '}
          <Link href="/forgot-password" className="text-accent underline underline-offset-2">
            Request a new link
          </Link>
          .
        </div>
      ) : null}

      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        autoFocus
      />

      <button type="submit" disabled={busy} className="btn-primary group relative w-full overflow-hidden py-2.5">
        {busy ? <span className="shimmer absolute inset-0" aria-hidden /> : null}
        <span className="relative">{busy ? 'Saving…' : 'Set new password'}</span>
      </button>

      <p className="pt-2 text-center text-xs text-ink-500">
        Signing you in afterwards. Every other device is signed out.
      </p>
    </form>
  );
}

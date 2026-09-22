'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthField, AuthNotice, SubmitButton } from '@/components/auth-ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The two halves of a password reset.
 *
 * `RequestReset` asks for an address and reports what the API did with it:
 * a link on its way, no account under that address, asked too recently,
 * or a mail provider that would not take the message. Each is said
 * plainly, because the person most likely to hit any of them is the
 * account's owner, and "check your inbox" over a message that never left
 * is the worst answer of all.
 *
 * `ChooseNewPassword` consumes the link. The API signs the user straight in
 * on success, because making someone who has just proved control of their
 * inbox type the password they only just chose is ceremony.
 */

const RESEND_AFTER_S = 60;

type Sent = { email: string; delivered: boolean };

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
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<{ text: string; noAccount?: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Counts the resend button back to life, a second at a time.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function request(address: string) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/auth/password/forgot`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address }),
      });
      const body = (await response.json().catch(() => null)) as
        | { message?: string; delivered?: boolean; retryInSeconds?: number }
        | null;

      if (response.ok) {
        setSent({ email: address, delivered: body?.delivered ?? false });
        setCooldown(RESEND_AFTER_S);
        return;
      }

      switch (response.status) {
        case 400:
          setError({ text: 'That does not look like an email address.' });
          return;
        case 404:
          setError({
            text: body?.message ?? 'There is no OMNIPLAY account associated with that email address.',
            noAccount: true,
          });
          return;
        case 429:
          setError({ text: body?.message ?? 'Too many requests. Try again in a minute.' });
          if (body?.retryInSeconds) setCooldown(Math.min(body.retryInSeconds, RESEND_AFTER_S));
          return;
        case 503:
          setError({
            text: body?.message ?? 'The reset email could not be sent right now. Try again in a few minutes.',
          });
          return;
        default:
          setError({ text: body?.message ?? 'Something went wrong. Please try again.' });
      }
    } catch {
      setError({ text: 'Could not reach OMNIPLAY. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setEmail(address);
    if (!address) {
      setError({ text: 'Enter the email address on your account.' });
      return;
    }
    await request(address);
  }

  if (sent) {
    return (
      <div className="anim-rise space-y-4">
        {sent.delivered ? (
          <>
            <AuthNotice tone="positive">
              <strong className="font-semibold">Check your inbox.</strong> A reset link is on its
              way to <span className="font-medium text-ink-100">{sent.email}</span>. It works once
              and expires in an hour.
            </AuthNotice>
            <p className="text-sm text-ink-500">
              Nothing arrived? Check the spam folder first.
            </p>
          </>
        ) : (
          /* No transport is configured, so no message was sent and saying
             one was "on its way" would leave someone watching an inbox for
             nothing. */
          <>
            <AuthNotice tone="warning">
              <strong className="font-semibold">No email was sent.</strong> This OMNIPLAY instance
              has no mail provider configured, so the link was written to the API server log
              instead. Look for{' '}
              <code className="rounded bg-ink-850 px-1 py-0.5 text-xs text-ink-200">
                reset-password?token=
              </code>{' '}
              in the terminal running the API. It works once and expires in an hour.
            </AuthNotice>
            <p className="text-sm text-ink-500">
              To send real email, set{' '}
              <code className="rounded bg-ink-850 px-1 py-0.5 text-xs text-ink-200">
                RESEND_API_KEY
              </code>{' '}
              in <code className="rounded bg-ink-850 px-1 py-0.5 text-xs text-ink-200">.env</code>{' '}
              and restart the API.
            </p>
          </>
        )}

        {error ? <AuthNotice tone="danger">{error.text}</AuthNotice> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void request(sent.email)}
            disabled={busy || cooldown > 0}
            className="btn-ghost flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cooldown > 0 ? `Send again in ${cooldown}s` : busy ? 'Sending…' : 'Send again'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSent(null);
              setError(null);
            }}
            className="btn-ghost flex-1 justify-center"
          >
            Use another address
          </button>
        </div>

        <p className="pt-1 text-center text-sm text-ink-500">
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
      {error ? (
        <AuthNotice tone="danger">
          {error.text}
          {error.noAccount ? (
            <>
              {' '}
              <Link href="/register" className="font-semibold text-accent underline underline-offset-2">
                Create one
              </Link>
              , or check the spelling and try again.
            </>
          ) : null}
        </AuthNotice>
      ) : null}

      <AuthField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        autoFocus
        required
        defaultValue={email}
        placeholder="The address you signed up with"
        error={undefined}
      />

      <SubmitButton busy={busy}>{emailDelivery ? 'Send reset link' : 'Create reset link'}</SubmitButton>

      <p className="pt-1 text-center text-sm text-ink-500">
        Remembered it?{' '}
        <Link href="/login" className="font-semibold text-accent hover:underline">
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
  const [fieldError, setFieldError] = useState<{ password?: string; confirm?: string }>({});
  const [expired, setExpired] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError({});

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    // Checked here as well as on the server: the API signs the person in
    // the moment this succeeds, so a typo would lock in a password nobody
    // knows.
    if (password.length < 10) {
      setFieldError({ password: 'Use at least 10 characters.' });
      return;
    }
    if (confirm !== password) {
      setFieldError({ confirm: 'These do not match.' });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/auth/password/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string; errors?: Record<string, string> }
          | null;
        if (body?.errors?.password) {
          setFieldError({ password: body.errors.password });
          return;
        }
        // A bad token is the one failure that cannot be fixed on this
        // screen; the form gives way to the way out.
        if (response.status === 400) setExpired(true);
        setError(body?.message ?? 'Could not reset your password. Please try again.');
        return;
      }
      router.push('/boot');
      router.refresh();
    } catch {
      setError('Could not reach OMNIPLAY. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  // A link with no token in it cannot be completed, and the honest thing is
  // to say so immediately rather than after a password has been typed.
  if (!token || expired) {
    return (
      <div className="space-y-4">
        <AuthNotice tone="danger">
          {!token
            ? 'This link is missing its reset code. It may have been cut short by your email client.'
            : (error ?? 'This reset link is no longer valid.')}
        </AuthNotice>
        <Link href="/forgot-password" className="btn-primary w-full justify-center py-3">
          Request a new link
        </Link>
        <p className="pt-1 text-center text-sm text-ink-500">
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
      {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}

      <AuthField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        error={fieldError.password}
        autoFocus
        required
      />
      <AuthField
        label="Confirm password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        error={fieldError.confirm}
        required
      />

      <SubmitButton busy={busy}>Set new password</SubmitButton>

      <p className="pt-1 text-center text-xs text-ink-500">
        You&rsquo;ll be signed in straight away. Every other device is signed out.
      </p>
    </form>
  );
}

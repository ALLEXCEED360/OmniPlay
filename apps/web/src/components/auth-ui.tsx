import type { InputHTMLAttributes, ReactNode } from 'react';

/**
 * The parts the signed-out forms are built from, so sign-in, sign-up and
 * the two halves of a password reset read as one screen in four moods.
 */

/** A labelled input with a hint and an inline error, on paper. */
export function AuthField({
  label,
  name,
  hint,
  error,
  /** Something for the label's right end — the "Forgot password?" link. */
  aside,
  ...props
}: {
  label: string;
  name: string;
  hint?: string | undefined;
  error?: string | undefined;
  aside?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={name} className="eyebrow block text-ink-400">
          {label}
        </label>
        {aside}
      </div>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`w-full cut-sm bg-ink-900 px-3.5 py-2.5 text-[15px] text-ink-100 transition-shadow duration-200 placeholder:text-ink-600 focus:outline-none ${
          error
            ? 'shadow-[inset_0_0_0_1.5px_var(--color-danger)]'
            : 'shadow-[inset_0_0_0_1px_var(--color-ink-800)] focus:shadow-[inset_0_0_0_2px_var(--color-accent)]'
        }`}
        {...props}
      />
      {hint && !error ? (
        <p id={`${name}-hint`} className="mt-1.5 text-xs text-ink-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="anim-fade mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A message with an edge in the colour of its mood. */
export function AuthNotice({
  tone,
  children,
}: {
  tone: 'danger' | 'positive' | 'warning';
  children: ReactNode;
}) {
  const edge = {
    danger: 'border-danger bg-danger/10',
    positive: 'border-positive bg-positive/10',
    warning: 'border-warning bg-warning/10',
  }[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`anim-fade cut-sm border-l-4 px-4 py-3 text-sm leading-relaxed text-ink-200 ${edge}`}
    >
      {children}
    </div>
  );
}

/**
 * The primary action. A sweep while the request is in flight: dimming a
 * button the reader just pressed removes the only confirmation they have
 * that it registered; movement says "working" without taking anything away.
 */
export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="btn-primary group relative w-full overflow-hidden py-3 text-base disabled:cursor-wait"
    >
      {busy ? <span className="shimmer absolute inset-0" aria-hidden /> : null}
      <span className="relative">{busy ? 'Please wait…' : children}</span>
    </button>
  );
}

/** The "or" between Google and the password form. */
export function OrRule() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-ink-800" />
      <span className="eyebrow text-ink-600">or</span>
      <span className="h-px flex-1 bg-ink-800" />
    </div>
  );
}

/**
 * Continue with Google.
 *
 * Ink on paper with Google's mark in a white tile, the first thing on the
 * card. When the instance has no Google credentials the button stays, but
 * greyed and explained: a hidden button makes the operator hunt for why
 * the feature is missing, and a live one would fail after a round trip to
 * Google.
 */
export function GoogleButton({
  href,
  configured,
  label,
}: {
  href: string;
  configured: boolean;
  label: string;
}) {
  const shape =
    'flex w-full items-center justify-center gap-3 py-3 font-display text-base font-bold uppercase italic tracking-wider [clip-path:polygon(10px_0,100%_0,calc(100%_-_10px)_100%,0_100%)]';

  if (!configured) {
    return (
      <div>
        <div
          className={`${shape} cursor-not-allowed bg-ink-850 text-ink-600`}
          aria-disabled
          title="Google sign-in is not configured on this instance."
        >
          <GoogleMark muted />
          {label}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-ink-600">
          Google sign-in isn&rsquo;t set up on this instance yet.
        </p>
      </div>
    );
  }

  return (
    <a
      href={href}
      className={`${shape} bg-ink text-paper transition-[background-color,transform] duration-150 hover:bg-accent hover:text-ink-950 active:scale-[0.99]`}
    >
      <GoogleMark />
      {label}
    </a>
  );
}

function GoogleMark({ muted = false }: { muted?: boolean }) {
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-sm ${muted ? 'bg-ink-800' : 'bg-white'}`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className={`size-4 ${muted ? 'opacity-40 grayscale' : ''}`}>
        <path
          fill="#4285F4"
          d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24z"
        />
        <path fill="#FBBC05" d="M5.3 14.3a7.1 7.1 0 0 1 0-4.6v-3.1h-4a12 12 0 0 0 0 10.8l4-3.1z" />
        <path
          fill="#EA4335"
          d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"
        />
      </svg>
    </span>
  );
}

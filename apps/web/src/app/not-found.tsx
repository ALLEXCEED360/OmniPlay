import Link from 'next/link';

/**
 * Root not-found boundary.
 *
 * Reached by `notFound()` from a game page, a collection, or a profile that is
 * private or does not exist. The copy stays vague on purpose: a public profile
 * that is switched off must be indistinguishable from one that never existed,
 * or this page becomes a way to enumerate usernames.
 */
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-md text-center">
        <Link href="/" className="inline-flex items-baseline gap-0.5">
          <span className="text-lg font-bold tracking-tight text-ink-100">OMNI</span>
          <span className="bg-gradient-to-r from-accent to-violet bg-clip-text text-lg font-bold tracking-tight text-transparent">
            PLAY
          </span>
        </Link>

        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-ink-100">
          Nothing here
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-400">
          This page does not exist, or it is not public.
        </p>

        <Link
          href="/dashboard"
          className="mt-8 btn-primary"
        >
          Back to your library
        </Link>
      </div>
    </div>
  );
}

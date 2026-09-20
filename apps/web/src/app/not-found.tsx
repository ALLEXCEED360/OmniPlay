import Link from 'next/link';
import { Wordmark } from '@/components/wordmark';
import { Backdrop } from '@/components/backdrop';

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
      <Backdrop />
      <div className="max-w-md text-center">
        <Wordmark large href="/" />

        <p className="display mt-10 text-[7rem] leading-none text-accent" aria-hidden>
          404
        </p>
        <h1 className="display mt-2 text-4xl text-ink-100">Nothing here</h1>
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

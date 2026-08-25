import type { ReactNode } from 'react';

/**
 * Framing for the signed-out screens.
 *
 * Split layout: the product promise on the left, the form on the right. On
 * mobile the pitch collapses to a wordmark so the form is immediately at hand.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="hidden flex-col justify-between p-12 lg:flex">
        <div className="inline-flex items-baseline gap-0.5">
          <span className="text-xl font-bold tracking-tight text-ink-100">OMNI</span>
          <span className="bg-gradient-to-r from-accent to-violet bg-clip-text text-xl font-bold tracking-tight text-transparent">
            PLAY
          </span>
        </div>

        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight text-ink-100">
            Your gaming history should belong to you — not to Steam, Xbox or PlayStation.
          </p>
          <p className="mt-6 text-sm leading-relaxed text-ink-400">
            OMNIPLAY brings together everything you own, have owned, played and finished across
            every platform, and turns it into one record you actually control.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 border-t border-ink-850 pt-8">
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-600">Unified</dt>
            <dd className="mt-1 text-sm text-ink-300">One library</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-600">Traceable</dt>
            <dd className="mt-1 text-sm text-ink-300">Every source</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-600">Yours</dt>
            <dd className="mt-1 text-sm text-ink-300">Export anytime</dd>
          </div>
        </dl>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="text-xl font-bold tracking-tight text-ink-100">OMNI</span>
            <span className="bg-gradient-to-r from-accent to-violet bg-clip-text text-xl font-bold tracking-tight text-transparent">
              PLAY
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
          <p className="mb-8 mt-2 text-sm text-ink-400">{subtitle}</p>

          {children}
        </div>
      </section>
    </div>
  );
}

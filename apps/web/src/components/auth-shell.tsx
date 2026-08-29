import type { CSSProperties, ReactNode } from 'react';
import { Wordmark } from '@/components/wordmark';

/**
 * Framing for the signed-out screens.
 *
 * Split layout: the product promise on the left, the form on the right. On
 * mobile the pitch collapses to a wordmark so the form is immediately at hand.
 *
 * The three proof points are coloured to match the three platforms, which is
 * the same legend the whole app runs on — so the first screen a person sees
 * already teaches the colour system they will read every chart with.
 */

const PROOF = [
  { term: 'Unified', detail: 'One library', dot: 'bg-accent' },
  { term: 'Traceable', detail: 'Every source', dot: 'bg-violet' },
  { term: 'Yours', detail: 'Export anytime', dot: 'bg-positive' },
] as const;

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
    <div className="relative grid min-h-dvh lg:grid-cols-2">
      {/* Two soft blooms behind everything. A sign-in page is one form on a
          flat field; this gives the field somewhere to be. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-32 -top-32 size-[28rem] rounded-full bg-accent opacity-[0.07] blur-[100px]" />
        <div className="absolute -bottom-40 left-1/3 size-[32rem] rounded-full bg-violet opacity-[0.06] blur-[110px]" />
      </div>

      <section className="relative hidden flex-col justify-between p-12 lg:flex">
        <div className="anim-fade">
          <Wordmark large />
        </div>

        <div className="max-w-md">
          <p
            className="anim-rise stagger text-3xl font-semibold leading-tight tracking-tight text-ink-100"
            style={{ '--i': 1 } as CSSProperties}
          >
            Your gaming history should belong to you — not to Steam, Xbox or PlayStation.
          </p>
          <p
            className="anim-rise stagger mt-6 text-sm leading-relaxed text-ink-400"
            style={{ '--i': 2 } as CSSProperties}
          >
            OMNIPLAY brings together everything you own, have owned, played and finished across
            every platform, and turns it into one record you actually control.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 border-t border-ink-850 pt-8">
          {PROOF.map((item, index) => (
            <div
              key={item.term}
              className="anim-rise stagger"
              style={{ '--i': index + 3, '--stagger-step': '90ms' } as CSSProperties}
            >
              <dt className="eyebrow flex items-center gap-1.5 text-ink-600">
                <span className={`size-1.5 rounded-full ${item.dot}`} aria-hidden />
                {item.term}
              </dt>
              <dd className="mt-1 text-sm text-ink-300">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="relative flex items-center justify-center p-6 sm:p-12">
        <div className="anim-rise w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark large asLink={false} />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
          <p className="mb-8 mt-2 text-sm text-ink-400">{subtitle}</p>

          {children}
        </div>
      </section>
    </div>
  );
}

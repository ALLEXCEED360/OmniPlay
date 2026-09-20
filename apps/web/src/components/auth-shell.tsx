import type { CSSProperties, ReactNode } from 'react';
import { Wordmark } from '@/components/wordmark';
import { Backdrop } from '@/components/backdrop';
import { Headline } from '@/components/motion';

/**
 * Framing for the signed-out screens.
 *
 * A title screen, in the sense a game has one: footage behind, the name in
 * the largest type the product uses, and the form on an off-white cut-out
 * to the right. On mobile the pitch collapses to a wordmark so the form is
 * immediately at hand.
 *
 * The three proof points are coloured to match the three platforms, which is
 * the same legend the whole app runs on — so the first screen a person sees
 * already teaches the colour system they will read every chart with.
 */

const PROOF = [
  { term: 'Unified', detail: 'One library', bar: 'bg-psn' },
  { term: 'Traceable', detail: 'Every source', bar: 'bg-steam' },
  { term: 'Yours', detail: 'Export anytime', bar: 'bg-xbox' },
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
    <div className="relative grid min-h-dvh lg:grid-cols-[1.2fr_1fr]">
      <Backdrop strength={0.9} />

      <section className="relative hidden flex-col justify-between p-12 lg:flex">
        <div className="anim-fade">
          <Wordmark large asLink={false} />
        </div>

        <div className="max-w-xl">
          <div className="eyebrow anim-rise mb-4 flex items-center gap-2.5 text-accent">
            <span className="slash" aria-hidden />
            Your universal gaming identity
          </div>
          <p className="display text-[4.5rem] leading-[0.9] text-ink-100">
            <Headline text="Your history should belong to you." delayMs={100} />
          </p>
          <p
            className="anim-rise stagger mt-6 max-w-md text-[15px] leading-relaxed text-ink-400"
            style={{ '--i': 5 } as CSSProperties}
          >
            Not to Steam, Xbox or PlayStation. OMNIPLAY brings together everything you own, have
            owned, played and finished across every platform, and turns it into one record you
            actually control.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6">
          {PROOF.map((item, index) => (
            <div
              key={item.term}
              className="anim-rise stagger"
              style={{ '--i': index + 6, '--stagger-step': '90ms' } as CSSProperties}
            >
              <span className={`mb-3 block h-1 w-10 -skew-x-[20deg] ${item.bar}`} aria-hidden />
              <dt className="display text-xl text-ink-100">{item.term}</dt>
              <dd className="mt-1 text-sm text-ink-400">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="relative flex items-center justify-center p-6 sm:p-12">
        <div className="hard-shadow anim-rise w-full max-w-md">
          <div className="paper cut p-7 sm:p-9">
            <div className="mb-8 lg:hidden">
              <Wordmark large asLink={false} />
            </div>

            <h1 className="display text-[2.5rem] leading-[0.9] text-ink-950">{title}</h1>
            <p className="mb-8 mt-3 text-sm text-ink-700">{subtitle}</p>

            {/* The form was written for a dark surface; on paper its inputs
                and links pick up the inverted tokens set here. */}
            <div className="auth-paper">{children}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

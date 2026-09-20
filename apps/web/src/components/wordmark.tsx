import Link from 'next/link';

/**
 * The mark, in one place.
 *
 * Three slanted bars of decreasing length in the three platform colours —
 * the shape a cross-platform library makes when split by platform, largest
 * share first — beside the name in the display cut with the second half in
 * red. The bars teach the platform legend before the reader reaches a
 * chart; the red teaches which colour the interface speaks in.
 */
export function Wordmark({
  /** Larger treatment for the rail and the signed-out screens. */
  large,
  href = '/dashboard',
  /** Rendered as plain content rather than a link. */
  asLink = true,
}: {
  large?: boolean;
  href?: string;
  asLink?: boolean;
}) {
  const mark = (
    <>
      <span className={`flex flex-col ${large ? 'gap-[4px]' : 'gap-[3px]'}`} aria-hidden>
        <span className={`-skew-x-[20deg] bg-psn ${large ? 'h-1.5 w-8' : 'h-1 w-5'}`} />
        <span className={`-skew-x-[20deg] bg-steam ${large ? 'h-1.5 w-6' : 'h-1 w-3.5'}`} />
        <span className={`-skew-x-[20deg] bg-xbox ${large ? 'h-1.5 w-4' : 'h-1 w-2'}`} />
      </span>
      <span
        className={`display text-ink-100 ${large ? 'text-[1.75rem]' : 'text-[1.2rem]'}`}
      >
        Omni<span className="text-accent">play</span>
      </span>
    </>
  );

  if (!asLink) {
    return <span className="inline-flex items-center gap-2.5">{mark}</span>;
  }

  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2.5"
      aria-label="OMNIPLAY, go to overview"
    >
      {mark}
    </Link>
  );
}

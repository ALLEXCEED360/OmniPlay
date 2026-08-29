import Link from 'next/link';

/**
 * The mark, in one place.
 *
 * Three stacked bars of decreasing length: the shape a cross-platform library
 * actually makes when it is split by platform, in the three platform colours,
 * largest share first. It is the mark this product has earned rather than a
 * generic glyph — and because it is built from the same colours the rest of
 * the app assigns to PlayStation, Steam and Xbox, it teaches the legend before
 * the reader ever reaches a chart.
 *
 * Previously the sidebar drew the bars and the sign-in screen drew a gradient
 * "OMNI|PLAY" instead, so the product introduced itself as one thing and then
 * appeared as another the moment you logged in.
 */
export function Wordmark({
  /** Larger treatment for the signed-out screens. */
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
      <span
        className={`flex flex-col ${large ? 'gap-[4px]' : 'gap-[3px]'}`}
        aria-hidden
      >
        <span
          className={`rounded-full bg-accent ${large ? 'h-1 w-7' : 'h-[3px] w-5'}`}
        />
        <span
          className={`rounded-full bg-violet ${large ? 'h-1 w-5' : 'h-[3px] w-3.5'}`}
        />
        <span
          className={`rounded-full bg-positive ${large ? 'h-1 w-3' : 'h-[3px] w-2'}`}
        />
      </span>
      <span
        className={`font-bold uppercase text-ink-100 ${
          large ? 'text-xl tracking-[0.16em]' : 'text-[15px] tracking-[0.14em]'
        }`}
      >
        Omniplay
      </span>
    </>
  );

  if (!asLink) {
    return <span className="inline-flex items-center gap-2">{mark}</span>;
  }

  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2"
      aria-label="OMNIPLAY, go to overview"
    >
      {mark}
    </Link>
  );
}

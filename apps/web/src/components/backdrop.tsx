/**
 * The ambient layer behind every signed-in screen.
 *
 * A game menu sits over footage, not over a flat colour, and that is most of
 * what makes it feel like a place rather than a document. This is that
 * layer: fixed to the viewport, behind everything, dimmed hard enough that
 * the panels in front stay legible, and washed at the edges so the cut
 * corners of those panels read against it.
 *
 * `src` is a still for now — a rendered night city by Nat (@nattgw on
 * Unsplash, under the Unsplash licence) at /backdrop/city.jpg, chosen for
 * being dark enough to sit type on and lit in the colours the platform
 * legend already uses. Pass a `.mp4` or `.webm` and the same component
 * renders a muted, looping, autoplaying video instead — nothing else in the
 * app needs to change when the footage arrives.
 *
 * A page can render its own Backdrop to replace the ambient one for its
 * duration: the game page does this with the game's own hero artwork. Fixed
 * positioning means the later one in the document simply paints on top.
 */
export function Backdrop({
  src = '/backdrop/city.jpg',
  /** 0-1: how much of the footage survives. Lower for busier images. */
  strength = 0.85,
  /**
   * Whether to lay the app shell's dimming over it. The title and menu
   * screens draw their own, because they want the art to be seen — the
   * shell dims for panels of text, which those screens do not have.
   */
  veil = true,
  /**
   * Whether to grade the footage to one intensity. Art chosen per game
   * arrives at every saturation and brightness there is — a neon key art
   * and a night scene cannot both sit behind the same panels untouched.
   * Grading pulls colour and light down to a band the panels were
   * designed against, so every game's page reads as the same room.
   */
  grade = false,
}: {
  src?: string;
  strength?: number;
  veil?: boolean;
  grade?: boolean;
}) {
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(src);
  const style = {
    opacity: strength,
    filter: grade ? 'saturate(0.55) brightness(0.72) contrast(0.95)' : undefined,
  };

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {isVideo ? (
        <video
          src={src}
          autoPlay
          muted
          loop
          playsInline
          className="size-full object-cover"
          style={style}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          style={style}
        />
      )}

      {/* Dim from the left, where the navigation sits, so the menu never
          has to fight the footage for the eye. */}
      {veil ? (
        <>
          <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/55 to-ink-950/25" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-transparent to-ink-950/40" />
          <div className="absolute inset-0 halftone opacity-50" />
        </>
      ) : null}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { STATUS_LABELS } from '@/lib/format';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The user's own verdict on a game: where they are with it, and what they
 * thought of it.
 *
 * This is the only control in the product that writes a status, and it is the
 * half of the model that was missing. Every status on every screen was
 * inferred — from playtime, from a full achievement list — and the inference
 * deliberately never guesses at abandonment, because giving up on a game is
 * not something a sync can observe. The result was a library filter for
 * "Abandoned" that could never match anything, and a `declared` branch in
 * resolveGameStatus that nothing could ever reach.
 *
 * The panel says which of the two it is currently showing. A derived status is
 * an inference the reader is entitled to overrule, and it should not be
 * presented as though they had already agreed with it.
 */

const STATUSES = ['PLAYING', 'COMPLETED', 'PAUSED', 'ABANDONED', 'REPLAYING', 'NOT_STARTED'];

/** Half-steps, matching the column's documented 0-10 range. */
const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Your score bands the same way a critic score does, so the two read alike. */
function scoreTone(value: number): string {
  if (value >= 8) return 'bg-positive text-ink-950';
  if (value >= 5) return 'bg-warning text-ink-950';
  return 'bg-danger text-ink-950';
}

export function GameVerdict({
  slug,
  status,
  /** False when the user set this themselves rather than it being inferred. */
  derived,
  rating,
  /** The critic aggregate, so your score can be shown against it. */
  criticRating,
}: {
  slug: string;
  status: string;
  derived: boolean;
  rating: number | null;
  criticRating: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preview on hover, so the bar answers before you commit to a number.
  const [preview, setPreview] = useState<number | null>(null);

  // Held locally so the buttons answer immediately; the server's copy arrives
  // with the refresh. A control that waits for a round trip before showing
  // the press feels broken on a slow connection.
  const [declared, setDeclared] = useState(derived ? null : status);
  const [score, setScore] = useState(rating);

  async function save(next: { status?: string | null; rating?: number | null }) {
    const previous = { status: declared, rating: score };
    if (next.status !== undefined) setDeclared(next.status);
    if (next.rating !== undefined) setScore(next.rating);

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_URL}/library/game/${encodeURIComponent(slug)}/verdict`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: next.status !== undefined ? next.status : declared,
            rating: next.rating !== undefined ? next.rating : score,
          }),
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      // Everything else on the page reads the status too — the header pill,
      // and the library behind it.
      router.refresh();
    } catch {
      // Put the control back where it was. Leaving it showing a state the
      // server never accepted is worse than the failure itself.
      setDeclared(previous.status);
      setScore(previous.rating);
      setError('Could not save that. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const shown = declared ?? status;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow flex items-center gap-2 text-ink-400">
          <span className="h-3 w-0.5 rounded-full bg-accent/70" aria-hidden />
          Your verdict
        </h2>
        {declared ? (
          <button
            type="button"
            onClick={() => void save({ status: null })}
            disabled={busy}
            className="text-[11px] text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-200 disabled:opacity-60"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((option) => {
          const active = shown === option;
          // An inferred match is shown as a suggestion, not a selection: the
          // reader has not actually said this yet.
          const inferred = active && !declared;
          return (
            <button
              key={option}
              type="button"
              disabled={busy}
              aria-pressed={declared === option}
              onClick={() => void save({ status: declared === option ? null : option })}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200 disabled:opacity-60 ${
                declared === option
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : inferred
                    ? 'border-dashed border-ink-600 text-ink-300'
                    : 'border-ink-800 text-ink-400 hover:-translate-y-px hover:border-ink-700 hover:text-ink-200 active:scale-[0.96]'
              }`}
            >
              {STATUS_LABELS[option] ?? option}
            </button>
          );
        })}
      </div>

      <p className="mt-2.5 text-[11px] leading-snug text-ink-500">
        {declared
          ? 'You set this, so nothing a sync finds will change it.'
          : `Worked out from your playtime and achievements — ${
              STATUS_LABELS[shown] ?? shown
            }. Pick one to say so yourself.`}
      </p>

      <div className="rule-soft my-4" aria-hidden />

      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow text-ink-500">Your score</span>
        {score !== null ? (
          <button
            type="button"
            onClick={() => void save({ rating: null })}
            disabled={busy}
            className="text-[11px] text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-200 disabled:opacity-60"
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Ten buttons rather than a slider: a slider invents precision it does
          not have, and is hard to hit exactly on a phone. The fill follows the
          pointer before the click so the scale is legible without committing. */}
      <div className="mt-2 flex gap-1" onMouseLeave={() => setPreview(null)}>
        {SCORES.map((value) => {
          // Named `pending` rather than `shown`: the outer `shown` is a status
          // string, and having a number by the same name two scopes in is how
          // a later edit reaches for the wrong one.
          const pending = preview ?? score;
          const filled = pending !== null && value <= pending;
          const uncommitted = preview !== null && preview !== score;

          return (
            <button
              key={value}
              type="button"
              disabled={busy}
              aria-pressed={score === value}
              aria-label={`${value} out of 10`}
              onMouseEnter={() => setPreview(value)}
              onFocus={() => setPreview(value)}
              onBlur={() => setPreview(null)}
              onClick={() => void save({ rating: score === value ? null : value })}
              className={`stat-figure h-8 flex-1 rounded text-[11px] transition-all duration-150 disabled:opacity-60 ${
                filled
                  ? `${scoreTone(pending)} ${uncommitted ? 'opacity-70' : ''}`
                  : 'bg-ink-850 text-ink-500 hover:bg-ink-800'
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>

      {/* Your score beside theirs, never averaged into it. Two people can
          disagree about a game and both be right, which is the reason for
          keeping a personal score at all. */}
      <p className="mt-2 text-[11px] leading-snug text-ink-500">
        {score === null ? (
          'Yours alone — never mixed into the critic score.'
        ) : criticRating === null ? (
          `You rated this ${score} out of 10.`
        ) : (
          <>
            You rated this <span className="stat-figure text-ink-300">{score}/10</span>. Critics
            said <span className="stat-figure text-ink-300">{Math.round(criticRating / 10)}/10</span>
            {Math.abs(score - criticRating / 10) >= 2
              ? ' — you disagree with them.'
              : ' — close to your call.'}
          </>
        )}
      </p>

      {error ? <p className="anim-fade mt-3 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

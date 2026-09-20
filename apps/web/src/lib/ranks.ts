/**
 * The player card's five stats, the way a Persona status screen ranks a
 * character's social stats: a rank from 0 to 5, each with a title.
 *
 * The ranks are a reading of the figures, not a replacement for them —
 * every one is shown with the number it was read from, and the thresholds
 * live here in the open so the reading can be argued with. They are fixed
 * steps rather than percentiles: there is no population to rank against,
 * and a rank that moved when other people played would not be yours.
 */

export interface Rank {
  id: string;
  /** What is being ranked. */
  label: string;
  /** 0–5. */
  rank: number;
  /** The rank's title, in the register of a game's own status screen. */
  title: string;
  /** The figure the rank was read from, already formatted. */
  figure: string;
  /** What that figure is. */
  basis: string;
}

const STEPS = {
  hours: [50, 200, 500, 1000, 2500],
  games: [10, 30, 75, 150, 300],
  finished: [3, 10, 25, 50, 100],
  unlocks: [100, 500, 1500, 4000, 10000],
  genres: [2, 4, 6, 9, 12],
} as const;

const TITLES = {
  hours: ['Newcomer', 'Casual', 'Regular', 'Devoted', 'Veteran', 'Lifer'],
  games: ['Newcomer', 'Sampler', 'Explorer', 'Collector', 'Curator', 'Encyclopaedic'],
  finished: ['Unfinished', 'Dabbler', 'Closer', 'Finisher', 'Completionist', 'Relentless'],
  unlocks: ['Unproven', 'Novice', 'Hunter', 'Tracker', 'Hoarder', 'Legend'],
  genres: ['Undecided', 'Specialist', 'Focused', 'Balanced', 'Eclectic', 'Omnivore'],
} as const;

function rankOf(value: number, steps: readonly number[]): number {
  return steps.filter((step) => value >= step).length;
}

export function playerRanks(input: {
  hours: number;
  gamesPlayed: number;
  completed: number;
  unlocks: number;
  /** Genres holding a meaningful share of the hours — 2% or more. */
  genresInPlay: number;
}): Rank[] {
  const build = (
    id: keyof typeof STEPS,
    label: string,
    value: number,
    figure: string,
    basis: string,
  ): Rank => {
    const rank = rankOf(value, STEPS[id]);
    return { id, label, rank, title: TITLES[id][rank] ?? TITLES[id][0], figure, basis };
  };

  return [
    build('hours', 'Dedication', input.hours, `${Math.round(input.hours).toLocaleString()}h`, 'hours on record'),
    build('games', 'Breadth', input.gamesPlayed, input.gamesPlayed.toLocaleString(), 'games played'),
    build('finished', 'Resolve', input.completed, input.completed.toLocaleString(), 'games finished'),
    build('unlocks', 'Hunger', input.unlocks, input.unlocks.toLocaleString(), 'achievements unlocked'),
    build('genres', 'Range', input.genresInPlay, String(input.genresInPlay), 'genres with 2%+ of your hours'),
  ];
}

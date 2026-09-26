/**
 * End-of-level rating: turns the level stats into a score out of 100 and a
 * seal rank. Pure and deterministic; the constants live in player/tuning.ts.
 */
import { rating } from './player/tuning';
import type { Stats } from './state';

export type RankId = (typeof rating.ranks)[number]['id'];

export interface LevelRating {
  /** 0–100, rounded to an integer. */
  score: number;
  rank: RankId;
  /** Index into rating.ranks (0 = lowest). */
  rankIndex: number;
  /** Unrounded points per category. */
  parts: { time: number; secrets: number; notes: number; deaths: number };
}

const share = (found: number, total: number): number => (total > 0 ? Math.min(1, found / total) : 1);

export function rateLevel(
  stats: Stats,
  totals: { secrets: number; notes: number },
  par: number = rating.defaultPar,
): LevelRating {
  const zero = par * rating.timeZeroAt;
  const late = Math.min(1, Math.max(0, (stats.time - par) / (zero - par)));
  const parts = {
    time: rating.timePoints * (1 - late),
    secrets: rating.secretPoints * share(stats.secrets, totals.secrets),
    notes: rating.notePoints * share(stats.notes.length, totals.notes),
    deaths: Math.max(0, rating.deathPoints - stats.deaths * rating.deathPenalty),
  };
  const score = Math.round(parts.time + parts.secrets + parts.notes + parts.deaths);
  let rankIndex = 0;
  rating.ranks.forEach((r, i) => {
    if (score >= r.min) rankIndex = i;
  });
  return { score, rank: rating.ranks[rankIndex]?.id ?? 'sand', rankIndex, parts };
}

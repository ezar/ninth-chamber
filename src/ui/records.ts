/**
 * Best time and best seal per level, kept in localStorage. Storage can be
 * missing or blocked (private windows, previews), so every access is guarded
 * and the game works the same without it.
 */

export interface BestRecord {
  /** Best completion time (s). */
  time: number;
  /** Best seal (index into rating.ranks) and its score. */
  rankIndex: number;
  score: number;
}

export interface RecordUpdate {
  best: BestRecord;
  /** No previous record. */
  first: boolean;
  newTime: boolean;
  newRank: boolean;
}

const key = (levelId: string): string => `ninth-chamber.best.${levelId}`;

const isRecord = (v: unknown): v is BestRecord => {
  const r = v as Partial<BestRecord> | null;
  return (
    !!r &&
    typeof r.time === 'number' &&
    Number.isFinite(r.time) &&
    typeof r.rankIndex === 'number' &&
    typeof r.score === 'number'
  );
};

export function loadBest(levelId: string): BestRecord | null {
  try {
    const raw = window.localStorage.getItem(key(levelId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Merges a finished run into the stored best and saves it (if storage is available). */
export function recordRun(levelId: string, run: BestRecord): RecordUpdate {
  const prev = loadBest(levelId);
  const newTime = !prev || run.time < prev.time;
  const newRank = !prev || run.score > prev.score;
  const best: BestRecord = {
    time: newTime ? run.time : (prev?.time ?? run.time),
    rankIndex: newRank ? run.rankIndex : (prev?.rankIndex ?? run.rankIndex),
    score: newRank ? run.score : (prev?.score ?? run.score),
  };
  try {
    window.localStorage.setItem(key(levelId), JSON.stringify(best));
  } catch {
    // Storage unavailable: the record lasts for this page only.
  }
  return { best, first: !prev, newTime: newTime && !!prev, newRank: newRank && !!prev };
}

/**
 * Campaign progress: which chambers the player has reached, kept in
 * localStorage. Storage can be missing, blocked or full (private windows,
 * previews), so every access is guarded and the game works without it: the
 * first chamber is always open.
 */
import { CHAMBERS, type Chamber } from './campaign';

/** The subset of Storage the progress needs (tests pass a Map-backed one). */
export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'ninth-chamber.campaign';

/** The first chamber's level: reached from the start. */
export const FIRST_LEVEL = CHAMBERS.find((c) => c.level)?.level ?? 'antechamber';

/** The page's localStorage, or null when it cannot be used. */
export function browserProgressStorage(): ProgressStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Level ids reached so far (always including the first chamber's). */
export function loadReached(storage: ProgressStorage | null): Set<string> {
  const reached = new Set([FIRST_LEVEL]);
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const list = (parsed as { reached?: unknown } | null)?.reached;
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') reached.add(id);
  } catch {
    // Corrupt or blocked: the first chamber only.
  }
  return reached;
}

/** Marks a level reached and saves; returns the updated set. */
export function markReached(storage: ProgressStorage | null, levelId: string): Set<string> {
  const reached = loadReached(storage);
  if (reached.has(levelId)) return reached;
  reached.add(levelId);
  try {
    storage?.setItem(KEY, JSON.stringify({ reached: [...reached] }));
  } catch {
    // Full or blocked: progress lasts for this page only.
  }
  return reached;
}

/**
 * How the chamber map shows a chamber:
 * - `open`: reached and playable in this build;
 * - `locked`: playable in this build but not reached yet;
 * - `soon`: a known chamber whose level is not in this build yet;
 * - `sealed`: the sealed chambers (IV–VIII);
 * - `unknown`: the ninth, which nobody has found.
 */
export type ChamberState = 'open' | 'locked' | 'soon' | 'sealed' | 'unknown';

export function chamberState(
  c: Chamber,
  reached: ReadonlySet<string>,
  playable: ReadonlySet<string>,
): ChamberState {
  if (c.status) return c.status;
  if (!c.level || !playable.has(c.level)) return 'soon';
  return reached.has(c.level) ? 'open' : 'locked';
}

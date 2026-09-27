/**
 * The playable levels by id (levels/<id>.level.json), each loaded on demand
 * as its own chunk. `?level=<id>` in the page URL picks one; anything else
 * starts at the first chamber. Moving to another chamber loads the page
 * again with its id (`levelUrl`), so the browser releases every GPU
 * resource of the chamber left behind.
 */
import { Level } from './sim/grid/level';

const LEVELS: Record<string, () => Promise<unknown>> = {
  antechamber: () => import('../levels/antechamber.level.json').then((m) => m.default),
  cisterns: () => import('../levels/cisterns.level.json').then((m) => m.default),
  sun_temple: () => import('../levels/sun_temple.level.json').then((m) => m.default),
};

export const DEFAULT_LEVEL = 'antechamber';

export const levelIds = (): string[] => Object.keys(LEVELS);

/** The level id asked for in a URL query string, or the default one. */
export function levelFromQuery(search: string): string {
  const id = new URLSearchParams(search).get('level');
  return id !== null && id in LEVELS ? id : DEFAULT_LEVEL;
}

/** The raw level file (validate it with Level.parse). */
export function loadLevelFile(id: string): Promise<unknown> {
  const load = LEVELS[id] ?? LEVELS[DEFAULT_LEVEL];
  if (!load) throw new Error(`No level '${id}'`);
  return load();
}

/**
 * The level to play: the one asked for, or the first chamber when it is
 * unknown, missing or fails to load or validate.
 */
export async function loadPlayableLevel(id: string): Promise<Level> {
  if (id !== DEFAULT_LEVEL) {
    try {
      return Level.parse(await loadLevelFile(id));
    } catch (err) {
      console.warn(`Level '${id}' could not be loaded; starting at the first chamber.`, err);
    }
  }
  return Level.parse(await loadLevelFile(DEFAULT_LEVEL));
}

/** The page URL that plays a level (the first chamber has the bare URL). */
export function levelUrl(href: string, id: string): string {
  const url = new URL(href);
  if (id === DEFAULT_LEVEL) url.searchParams.delete('level');
  else url.searchParams.set('level', id);
  url.hash = '';
  return url.toString();
}

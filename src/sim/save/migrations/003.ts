/**
 * Save schema 3 → 4 (0.4.6): the guardian's kind (stone or bronze) and its
 * bronze immunity. Guardians saved before are stone, with no immunity.
 */
import type { Migration } from './index';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function upgradeState(state: unknown): void {
  if (!isObj(state) || !Array.isArray(state.guardians)) return;
  for (const g of state.guardians) {
    if (!isObj(g)) continue;
    g.kind ??= 'stone';
    g.immune ??= 0;
  }
}

export const migrate003: Migration = (save) => {
  const game = save.game;
  if (isObj(game)) {
    upgradeState(game.checkpoint);
    upgradeState(game.resume);
  }
  return save;
};

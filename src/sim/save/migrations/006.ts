/**
 * Save schema 6 → 7 (0.7.6): the Root Halls' tangles of roots. States saved
 * before them get an empty list.
 */
import type { Migration } from './index';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function upgradeState(state: unknown): void {
  if (!isObj(state)) return;
  const m = state.mechanisms;
  if (isObj(m)) m.tangles ??= [];
}

export const migrate006: Migration = (save) => {
  const game = save.game;
  if (isObj(game)) {
    upgradeState(game.checkpoint);
    upgradeState(game.resume);
  }
  return save;
};

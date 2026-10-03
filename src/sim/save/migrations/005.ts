/**
 * Save schema 5 → 6 (0.6.5): the Observatory's rings and oculus. States
 * saved before them get empty lists.
 */
import type { Migration } from './index';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function upgradeState(state: unknown): void {
  if (!isObj(state)) return;
  const m = state.mechanisms;
  if (isObj(m)) {
    m.rings ??= [];
    m.oculi ??= [];
  }
}

export const migrate005: Migration = (save) => {
  const game = save.game;
  if (isObj(game)) {
    upgradeState(game.checkpoint);
    upgradeState(game.resume);
  }
  return save;
};

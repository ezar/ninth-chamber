/**
 * Save schema 4 → 5 (0.5.5): the Wind Stair's wind zones. States saved
 * before them get an empty wind list.
 */
import type { Migration } from './index';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function upgradeState(state: unknown): void {
  if (!isObj(state)) return;
  const m = state.mechanisms;
  if (isObj(m)) m.winds ??= [];
}

export const migrate004: Migration = (save) => {
  const game = save.game;
  if (isObj(game)) {
    upgradeState(game.checkpoint);
    upgradeState(game.resume);
  }
  return save;
};

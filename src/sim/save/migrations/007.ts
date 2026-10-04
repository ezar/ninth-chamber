/**
 * Save schema 7 → 8 (0.8.5): the Ninth Chamber's conjunction timer. States
 * saved before it get none running.
 */
import type { Migration } from './index';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function upgradeState(state: unknown): void {
  if (isObj(state)) state.timer ??= null;
}

export const migrate007: Migration = (save) => {
  const game = save.game;
  if (isObj(game)) {
    upgradeState(game.checkpoint);
    upgradeState(game.resume);
  }
  return save;
};

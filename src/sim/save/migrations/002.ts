/**
 * Save schema 2 → 3 (0.4.5): the Bronze Forge's pours and heat zones.
 * States saved before them get empty pour and heat lists, out of the heat.
 */
import type { Migration } from './index';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function upgradeState(state: unknown): void {
  if (!isObj(state)) return;
  const m = state.mechanisms;
  if (isObj(m)) {
    m.pours ??= [];
    m.heat ??= [];
    m.scorched ??= false;
  }
}

export const migrate002: Migration = (save) => {
  const game = save.game;
  if (isObj(game)) {
    upgradeState(game.checkpoint);
    upgradeState(game.resume);
  }
  return save;
};

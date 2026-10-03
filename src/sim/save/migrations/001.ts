/**
 * Save schema 1 → 2 (0.3.0): the Clay Archive's mechanisms and dart poison.
 * States saved before them get empty glyph lock and dart lists and no poison.
 */
import type { Migration } from './index';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function upgradeState(state: unknown): void {
  if (!isObj(state)) return;
  const m = state.mechanisms;
  if (isObj(m)) {
    m.glyphs ??= [];
    m.darts ??= [];
  }
  const p = state.player;
  if (isObj(p)) p.poison ??= 0;
}

export const migrate001: Migration = (save) => {
  const game = save.game;
  if (isObj(game)) {
    upgradeState(game.checkpoint);
    upgradeState(game.resume);
  }
  return save;
};

/**
 * Nora's controller: an explicit state machine (spec §5). Animation follows
 * the mode, never the other way round.
 */
import type { InputFrame } from '../../core/input-frame';
import type { PlayerMode } from '../state';
import type { World } from '../world';
import { makeCtx, type Ctx } from './context';
import { air } from './modes/air';
import { ground } from './modes/ground';
import { climb, hang } from './modes/hang';
import { block, dead, lever, moveBlock, pickup } from './modes/interact';
import { stepMedkit, stepWeapons } from './weapons';

const MODES: Record<PlayerMode, (c: Ctx) => void> = {
  ground,
  air,
  hang,
  climb,
  block,
  push: moveBlock,
  pull: moveBlock,
  lever,
  pickup,
  dead,
};

export function stepPlayer(world: World, input: InputFrame, dt: number): void {
  const c = makeCtx(world, input, dt);
  const p = c.p;
  p.sinceJumpPressed = c.pressed('jump') ? 0 : p.sinceJumpPressed + dt;
  p.sinceRelease += dt;
  p.sinceGround = p.mode === 'ground' ? 0 : p.sinceGround + dt;
  p.modeTime += dt;
  const before = p.mode;
  MODES[p.mode](c);
  if (p.mode !== before)
    world.events.emit({ type: 'player.mode', tick: world.tick, from: before, to: p.mode });
  // A respawn replaces the whole state: this tick's context is stale.
  if (world.state.player !== p) return;
  stepWeapons(c);
  stepMedkit(c);
}

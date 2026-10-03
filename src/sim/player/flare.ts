/**
 * The flare button (spec §7 "Bengalas", §13: G, d-pad left, the touch flare
 * button): lights a flare from the inventory; pressed again it throws the
 * flare ahead, or drops it at her feet with Walk held. Nora lets go of a
 * burning flare when she needs both hands (hanging from a ledge, moving a
 * block) or draws her pistols; she keeps it climbing out of the water,
 * pulling a lever or crouching to pick something up.
 */
import { capFlares, flareHand, heldFlare } from '../actors/flares';
import { yawVec } from '../grid/units';
import type { FlareState, PlayerMode } from '../state';
import { emit, type Ctx } from './context';
import { flares } from './tuning';

const HANDS_BUSY: ReadonlySet<PlayerMode> = new Set(['hang', 'rope', 'block', 'push', 'pull', 'dead']);

function letGo(c: Ctx, f: FlareState, how: 'throw' | 'drop'): void {
  const { p } = c;
  const fwd = yawVec(p.yaw);
  f.held = false;
  if (how === 'throw') {
    const k = p.mode === 'dive' ? 0.4 : 1;
    f.vx = p.vel.x * 0.5 + fwd.x * flares.throwSpeed * k;
    f.vz = p.vel.z * 0.5 + fwd.z * flares.throwSpeed * k;
    f.vy = flares.throwLift * k;
  } else {
    f.vx = fwd.x * flares.dropSpeed;
    f.vz = fwd.z * flares.dropSpeed;
    f.vy = 0;
  }
  emit(c, how === 'throw' ? 'flare.thrown' : 'flare.dropped', { id: f.id });
}

export function stepFlare(c: Ctx): void {
  const { p, world } = c;
  const held = heldFlare(world);
  const busy = HANDS_BUSY.has(p.mode) || p.weapon.drawn;
  if (held && busy) {
    letGo(c, held, 'drop');
    return;
  }
  if (!c.pressed('flare')) return;
  if (held) {
    letGo(c, held, c.held('walk') ? 'drop' : 'throw');
    return;
  }
  if (busy) return;
  const n = world.state.inventory.flare ?? 0;
  if (n <= 0) {
    emit(c, 'flare.none');
    return;
  }
  world.state.inventory.flare = n - 1;
  capFlares(world);
  const at = flareHand(p);
  world.state.flares.push({ id: world.tick, ...at, vx: 0, vy: 0, vz: 0, age: 0, held: true });
  emit(c, 'flare.lit', { id: world.tick, left: n - 1 });
}

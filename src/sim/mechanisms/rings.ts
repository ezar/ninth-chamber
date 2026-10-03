/**
 * The Observatory's dome (spec §19, chamber VIII): three rings that turn,
 * one position per pull of a lever on the rim (rules: `<id>.turn`,
 * `<id>.back`), until each carries its mark to the ninth place; and the
 * oculus, whose light rules let fall on the floor once the rings are
 * aligned. A ring emits `<id>.set` when aligned and `<id>.at<N>` for its
 * position; the oculus emits `<id>.on`.
 */
import { BLOCK } from '../grid/units';
import { setSignal } from '../logic/rules';
import type { World } from '../world';
import { defsOf, inRect, type OculusDef, type RingDef } from './defs';
import type { OculusState, RingState } from './types';

export function createRing(d: RingDef): RingState {
  return { id: d.id, pos: d.start };
}

export function createOculus(d: OculusDef): OculusState {
  return { id: d.id, on: d.on };
}

export function updateRings(world: World): void {
  const d = defsOf(world.level);
  for (const r of world.state.mechanisms.rings) {
    const def = d.rings.get(r.id);
    if (!def) continue;
    setSignal(world, `${r.id}.set`, r.pos === def.target);
    for (let i = 0; i < def.positions; i++) setSignal(world, `${r.id}.at${i}`, r.pos === i);
  }
  for (const o of world.state.mechanisms.oculi) setSignal(world, `${o.id}.on`, o.on);
}

export function ringAction(world: World, def: RingDef, st: RingState, op: string): boolean {
  if (op !== 'turn' && op !== 'back') return false;
  st.pos = (st.pos + (op === 'turn' ? 1 : def.positions - 1)) % def.positions;
  world.events.emit({
    type: 'ring.turned',
    tick: world.tick,
    id: st.id,
    kind: def.kind,
    pos: st.pos,
    aligned: st.pos === def.target,
    x: def.cx * BLOCK + BLOCK / 2,
    y: world.level.floorAt(def.cx * BLOCK + BLOCK / 2, def.cz * BLOCK + BLOCK / 2) + 6,
    z: def.cz * BLOCK + BLOCK / 2,
  });
  return true;
}

export function oculusAction(world: World, def: OculusDef, st: OculusState, op: string): boolean {
  if (op !== 'on' && op !== 'off' && op !== 'toggle') return false;
  const on = op === 'on' ? true : op === 'off' ? false : !st.on;
  if (on !== st.on)
    world.events.emit({
      type: on ? 'oculus.open' : 'oculus.close',
      tick: world.tick,
      id: st.id,
      x: ((def.minX + def.maxX) / 2) * BLOCK,
      y: world.level.floorAt(((def.minX + def.maxX) / 2) * BLOCK, ((def.minZ + def.maxZ) / 2) * BLOCK) + 1,
      z: ((def.minZ + def.maxZ) / 2) * BLOCK,
    });
  st.on = on;
  return true;
}

/** Whether a cell lies in the light of an open oculus. */
export function inOculusLight(world: World, cx: number, cz: number): boolean {
  const oculi = world.state.mechanisms.oculi;
  if (oculi.length === 0) return false;
  const d = defsOf(world.level).oculi;
  return oculi.some((o) => {
    const def = d.get(o.id);
    return o.on && def !== undefined && inRect(def, cx, cz);
  });
}

/**
 * The Wind Stair's gusts (spec §19, chamber VII): zones of cells where the
 * wind blows one way on a fixed cycle (or steadily), with the flutes' warning
 * before each gust. A horizontal gust carries Nora along in the air and
 * pushes her gently on the ground; an updraught takes part of gravity away; a
 * tearing gust pulls her off a ledge if it blows on her long enough. Rules
 * turn zones on and off (the flute levers).
 */
import { BLOCK, DIR_VEC } from '../grid/units';
import { setSignal } from '../logic/rules';
import { wind as tuning } from '../player/tuning';
import type { World } from '../world';
import { defsOf, inRect, type WindDef } from './defs';
import type { WindPhase, WindState } from './types';

/** Seconds into the gust (null while calm); a steady wind has blown forever. */
function gustTime(def: WindDef, time: number): number | null {
  if (def.period === null) return Infinity;
  const u = (((time + def.offset) % def.period) + def.period) % def.period;
  return u < def.blow ? u : null;
}

export function windPhase(def: WindDef, st: Pick<WindState, 'on' | 'time'>): WindPhase {
  if (!st.on) return 'idle';
  if (gustTime(def, st.time) !== null) return 'gust';
  if (def.period === null) return 'idle';
  const u = (((st.time + def.offset) % def.period) + def.period) % def.period;
  return u >= def.period - tuning.warning ? 'warn' : 'idle';
}

/** How hard it blows now, 0 … 1: it builds up and dies down over the ramp time. */
export function windFactor(def: WindDef, st: Pick<WindState, 'on' | 'time'>): number {
  if (!st.on) return 0;
  const g = gustTime(def, st.time);
  if (g === null) return 0;
  if (def.period === null) return 1;
  const t = Math.min(1, g / tuning.ramp, (def.blow - g) / tuning.ramp);
  return t * t * (3 - 2 * t);
}

/**
 * A cyclic zone starts in its phase without a sound (a level full of them
 * would all blow at once on the first tick); a steady one starts calm, so the
 * first update announces it and its sound plays.
 */
export function createWind(def: WindDef): WindState {
  const st: WindState = { id: def.id, on: def.on, time: 0, phase: 'idle' };
  if (def.period !== null) st.phase = windPhase(def, st);
  return st;
}

export function updateWind(world: World, def: WindDef, st: WindState, dt: number): void {
  if (st.on) st.time += dt;
  const phase = windPhase(def, st);
  if (phase !== st.phase) {
    const type = phase === 'warn' ? 'wind.warn' : phase === 'gust' ? 'wind.gust' : 'wind.calm';
    world.events.emit({
      type,
      tick: world.tick,
      id: st.id,
      dir: def.dir,
      // How long the gust blows (a steady wind: a few seconds of sound, then it settles).
      blow: def.period === null ? 3 : def.blow,
      x: ((def.minX + def.maxX) / 2) * BLOCK,
      y: world.level.floorAt(((def.minX + def.maxX) / 2) * BLOCK, ((def.minZ + def.maxZ) / 2) * BLOCK) + 2,
      z: ((def.minZ + def.maxZ) / 2) * BLOCK,
    });
    st.phase = phase;
  }
  setSignal(world, `${st.id}.gust`, phase === 'gust');
}

export interface WindHere {
  /** Horizontal velocity it carries a body at (m/s). */
  x: number;
  z: number;
  /** Fraction of gravity taken away (0 … <1). */
  lift: number;
}

const CALM: WindHere = { x: 0, z: 0, lift: 0 };

/** The wind at a point (the cell it is in): every zone blowing there, added up. */
export function windAt(world: World, x: number, z: number): WindHere {
  const winds = world.state.mechanisms.winds;
  if (winds.length === 0) return CALM;
  const d = defsOf(world.level).winds;
  const cx = Math.floor(x / BLOCK);
  const cz = Math.floor(z / BLOCK);
  let out: WindHere | null = null;
  for (const st of winds) {
    const def = d.get(st.id);
    if (!def || !inRect(def, cx, cz)) continue;
    const f = windFactor(def, st);
    if (f <= 0) continue;
    out ??= { x: 0, z: 0, lift: 0 };
    if (def.dir === 'up') out.lift = Math.min(0.9, Math.max(out.lift, def.strength * f));
    else {
      const v = DIR_VEC[def.dir];
      out.x += v.x * def.strength * f;
      out.z += v.z * def.strength * f;
    }
  }
  return out ?? CALM;
}

/**
 * A tearing gust that has blown at a point for the grip time: the direction it
 * throws her (unit), or null.
 */
export function tearingGust(world: World, x: number, z: number): { x: number; z: number } | null {
  const winds = world.state.mechanisms.winds;
  if (winds.length === 0) return null;
  const d = defsOf(world.level).winds;
  const cx = Math.floor(x / BLOCK);
  const cz = Math.floor(z / BLOCK);
  for (const st of winds) {
    const def = d.get(st.id);
    if (!def?.tear || !st.on || !inRect(def, cx, cz)) continue;
    const g = gustTime(def, st.time);
    if (g === null || g < tuning.grip) continue;
    return def.dir === 'up' ? { x: 0, z: 0 } : DIR_VEC[def.dir];
  }
  return null;
}

/** Rule actions: `<id>.on`, `<id>.off`, `<id>.toggle`. */
export function windAction(st: WindState, op: string): boolean {
  if (op !== 'on' && op !== 'off' && op !== 'toggle') return false;
  st.on = op === 'on' ? true : op === 'off' ? false : !st.on;
  return true;
}

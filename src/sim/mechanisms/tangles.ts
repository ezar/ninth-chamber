/**
 * Tangles of roots (spec §19, chamber V): a block of cells that is solid and
 * climbable on every side while grown. A lit torch in Nora's hand close by
 * makes it shrink back, which opens the way and takes its handholds away.
 * With the torch out or away it grows back slowly, never onto Nora or a
 * living enemy. Rules seal one (it grows whatever the torch) or part it (it
 * stays open), and free it again.
 *
 * Events: `tangle.shrink` (a torch reached it), `tangle.open`, `tangle.closed`.
 * Signal: `<id>.open`.
 */
import { sectorTop } from '../grid/level';
import { BLOCK } from '../grid/units';
import { setSignal } from '../logic/rules';
import { torchLight } from '../player/torch';
import { tangle as T, tuning } from '../player/tuning';
import type { World } from '../world';
import { defsOf, inRect, type TangleDef } from './defs';
import type { TangleState } from './types';

/** It counts as grown (solid, climbable) from halfway. */
export const tangleClosed = (st: TangleState): boolean => st.grown >= 0.5;

export function createTangle(d: TangleDef): TangleState {
  return { id: d.id, grown: d.grown ? 1 : 0, idle: T.regrowDelay, hold: d.hold };
}

/** The grown tangle covering a cell, if any. */
export function tangleAt(world: World, cx: number, cz: number): TangleDef | null {
  const tangles = world.state.mechanisms.tangles;
  if (tangles.length === 0) return null;
  const d = defsOf(world.level).tangles;
  for (const st of tangles) {
    if (!tangleClosed(st)) continue;
    const def = d.get(st.id);
    if (def && inRect(def, cx, cz)) return def;
  }
  return null;
}

/** Lowest floor under a tangle: the bottom of its box. */
function bottomOf(world: World, def: TangleDef): number {
  let low = Infinity;
  for (let x = def.minX; x < def.maxX; x++)
    for (let z = def.minZ; z < def.maxZ; z++) {
      const s = world.level.sector(x, z);
      if (s && !s.wall) low = Math.min(low, s.pit ? s.pitFloor : sectorTop(s));
    }
  return Number.isFinite(low) ? low : def.top;
}

/** Distance from a point to the tangle's box. */
function distanceTo(world: World, def: TangleDef, x: number, y: number, z: number): number {
  const dx = Math.max(def.minX * BLOCK - x, 0, x - def.maxX * BLOCK);
  const dz = Math.max(def.minZ * BLOCK - z, 0, z - def.maxZ * BLOCK);
  const dy = Math.max(bottomOf(world, def) - y, 0, y - def.top);
  return Math.hypot(dx, dy, dz);
}

/** Whether a body standing at (x, y, z) with this radius and height is inside the tangle's box. */
function bodyInside(
  def: TangleDef,
  bottom: number,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
): boolean {
  return (
    x + r > def.minX * BLOCK &&
    x - r < def.maxX * BLOCK &&
    z + r > def.minZ * BLOCK &&
    z - r < def.maxZ * BLOCK &&
    y < def.top &&
    y + h > bottom
  );
}

function blocked(world: World, def: TangleDef): boolean {
  const bottom = bottomOf(world, def);
  const p = world.state.player;
  if (p.mode !== 'dead' && bodyInside(def, bottom, p.pos.x, p.pos.y, p.pos.z, tuning.radius, tuning.height))
    return true;
  return world.state.enemies.some(
    (e) => e.mode !== 'dead' && bodyInside(def, bottom, e.pos.x, e.pos.y, e.pos.z, 0.4, 0.8),
  );
}

export function updateTangle(world: World, def: TangleDef, st: TangleState, dt: number): void {
  const p = world.state.player;
  const lit = torchLight(p) && distanceTo(world, def, p.pos.x, p.pos.y + T.handHeight, p.pos.z) <= T.reach;
  const wasClosed = tangleClosed(st);
  const shrink = st.hold === 'parted' || (st.hold === 'free' && lit);
  if (shrink) {
    if (st.idle > 0 && st.grown > 0 && st.hold === 'free') emit(world, def, 'tangle.shrink');
    st.idle = 0;
    st.grown = Math.max(0, st.grown - dt / T.shrinkTime);
  } else {
    st.idle += dt;
    const ready = st.hold === 'sealed' || st.idle >= T.regrowDelay;
    if (ready && st.grown < 1 && !blocked(world, def)) st.grown = Math.min(1, st.grown + dt / T.regrowTime);
  }
  const closed = tangleClosed(st);
  if (closed !== wasClosed) emit(world, def, closed ? 'tangle.closed' : 'tangle.open');
  setSignal(world, `${st.id}.open`, !closed);
}

function emit(world: World, def: TangleDef, type: string): void {
  world.events.emit({
    type,
    tick: world.tick,
    id: def.id,
    x: ((def.minX + def.maxX) / 2) * BLOCK,
    y: def.top - 1,
    z: ((def.minZ + def.maxZ) / 2) * BLOCK,
  });
}

/** Rule actions: `<id>.seal`, `<id>.part`, `<id>.free`. */
export function tangleAction(st: TangleState, op: string): boolean {
  if (op === 'seal') st.hold = 'sealed';
  else if (op === 'part') st.hold = 'parted';
  else if (op === 'free') st.hold = 'free';
  else return false;
  return true;
}

/**
 * The Bronze Forge's mechanisms (spec §19, chamber VI).
 *
 * - A pour runs molten bronze from a crucible along a trench, one cell after
 *   another. While it glows it kills whatever stands in it; a few seconds
 *   after the trench is full it cools into solid bronze at the trench's lip,
 *   a new bridge. Which trench gets the bronze is decided by rules (gates are
 *   levers): `<id>.pour` runs it, `<id>.stop` ends a repeating one.
 * - A repeating pour runs again every `period` seconds, rumbling first, and
 *   covers its own bridge with fresh, deadly bronze: cross while it is dark.
 * - Heat zones drain health away from the shade of their walls (sectors
 *   flagged `shade`), slowly, and can kill.
 */
import { BLOCK } from '../grid/units';
import { setSignal } from '../logic/rules';
import { killPlayer } from '../player/context';
import { forge } from '../player/tuning';
import type { World } from '../world';
import type { HeatDef, PourDef } from './defs';
import { inRect } from './defs';
import type { PourState } from './types';

export function createPour(d: PourDef): PourState {
  return { id: d.id, phase: 'idle', time: 0, front: 0, cast: false, running: d.running, cycle: 0 };
}

/** Whether cell `i` of a pour is covered by bronze (hot or cast). */
export const pourCovers = (st: PourState, i: number): boolean =>
  st.cast || st.phase === 'hot' || st.phase === 'solid' || (st.phase === 'flowing' && st.front > i);

/** Whether cell `i` of a pour holds hot bronze. */
export const pourBurns = (st: PourState, i: number): boolean =>
  st.phase === 'hot' || (st.phase === 'flowing' && st.front > i);

/** How hot the bronze glows (1 just poured … 0 cold), for the render. */
export function pourGlow(d: PourDef, st: PourState): number {
  if (st.phase === 'flowing') return 1;
  if (st.phase === 'hot') return Math.max(0, 1 - st.time / d.cool);
  return 0;
}

function startPour(world: World, d: PourDef, st: PourState): void {
  st.phase = 'flowing';
  st.front = 0;
  st.time = 0;
  const first = d.cells[0];
  world.events.emit({
    type: 'bronze.pour',
    tick: world.tick,
    id: d.id,
    ...(first ? { x: first.cx * BLOCK + BLOCK / 2, y: d.y, z: first.cz * BLOCK + BLOCK / 2 } : {}),
  });
}

export function updatePour(world: World, d: PourDef, st: PourState, dt: number): void {
  st.time += dt;
  if (st.running && d.period !== null) {
    st.cycle += dt;
    const resting = st.phase === 'idle' || st.phase === 'solid';
    if (resting && st.cycle >= d.period - forge.pour.warning) {
      st.phase = 'warn';
      st.time = 0;
      const first = d.cells[0];
      world.events.emit({
        type: 'bronze.warn',
        tick: world.tick,
        id: d.id,
        ...(first ? { cx: first.cx, cz: first.cz } : {}),
      });
    }
    if (st.phase === 'warn' && st.cycle >= d.period) {
      st.cycle = 0;
      startPour(world, d, st);
    }
  }
  if (st.phase === 'flowing') {
    st.front = Math.min(d.cells.length, st.front + d.speed * dt);
    if (st.front >= d.cells.length) {
      st.phase = 'hot';
      st.time = 0;
    }
  } else if (st.phase === 'hot' && st.time >= d.cool) {
    st.phase = 'solid';
    st.time = 0;
    st.cast = true;
    world.events.emit({ type: 'bronze.cooled', tick: world.tick, id: d.id });
  }
  setSignal(world, `${d.id}.molten`, st.phase === 'flowing' || st.phase === 'hot');
  setSignal(world, `${d.id}.solid`, st.phase === 'solid');
  setSignal(world, `${d.id}.cast`, st.cast);

  // Hot bronze kills whoever stands in it or falls into it.
  const p = world.state.player;
  if (p.mode === 'dead') return;
  const pcx = Math.floor(p.pos.x / BLOCK);
  const pcz = Math.floor(p.pos.z / BLOCK);
  const i = d.cells.findIndex((c) => c.cx === pcx && c.cz === pcz);
  if (i >= 0 && pourBurns(st, i) && p.pos.y - d.y < forge.pour.reach) {
    world.events.emit({ type: 'player.burned', tick: world.tick, x: p.pos.x, y: d.y, z: p.pos.z });
    killPlayer(world, 'bronze');
  }
}

/** Rule actions on a pour: `pour` runs it (covering its bridge again), `stop` ends its repeats. */
export function pourAction(world: World, d: PourDef, st: PourState, op: string): boolean {
  if (op === 'pour') {
    if (st.phase === 'flowing' || st.phase === 'hot') return true;
    startPour(world, d, st);
    return true;
  }
  if (op === 'stop' || op === 'start') {
    st.running = op === 'start';
    st.cycle = 0;
    if (!st.running && st.phase === 'warn') st.phase = st.cast ? 'solid' : 'idle';
    return true;
  }
  return false;
}

/**
 * Heat drains health while Nora is in an active heat zone, outside the shade
 * of its walls and out of the water. `scorched` says whether she was last
 * tick, so the HUD and audio hear when she steps in and out.
 */
export function updateHeat(world: World, zones: ReadonlyMap<string, HeatDef>, dt: number): void {
  const m = world.state.mechanisms;
  const p = world.state.player;
  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);
  const shade = world.level.sector(cx, cz)?.flags.has('shade') === true;
  const wet = p.mode === 'swim' || p.mode === 'dive';
  const inZone = m.heat.some((h) => {
    const d = zones.get(h.id);
    return h.on && d !== undefined && inRect(d, cx, cz);
  });
  const now = p.mode !== 'dead' && inZone && !shade && !wet;
  if (now !== m.scorched) {
    m.scorched = now;
    world.events.emit({ type: now ? 'heat.enter' : 'heat.leave', tick: world.tick });
  }
  if (!now) return;
  p.health = Math.max(0, p.health - forge.heat.rate * dt);
  if (p.health === 0) killPlayer(world, 'heat');
}

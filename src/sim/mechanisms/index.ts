/**
 * The Temple of the Sun's mechanisms and traps (spec §8): creation from the
 * level, the per-tick update, the respawn reset, their share of the grid's
 * floor heights and their rule actions. World calls into this module; the
 * pieces live in platforms.ts, beam.ts, traps.ts and use.ts.
 */
import type { Level } from '../grid/level';
import { setSignal } from '../logic/rules';
import { devices } from '../player/tuning';
import type { World } from '../world';
import { traceBeam } from './beam';
import { cellKey, defsOf, inRect } from './defs';
import { createPlatform, platformAction, platformOverCell, platformUnder, updatePlatform } from './platforms';
import {
  boulderAction,
  createBoulder,
  firePhase,
  resetTraps,
  updateBlade,
  updateBoulder,
  updateFire,
} from './traps';
import type { MechanismState } from './types';
import { turnMirror, updateUse } from './use';
import { createDarts, createGlyphLock, turnGlyph, updateDarts, updateGlyphs, updatePoison } from './archive';
import { createPour, pourAction, pourCovers, updateHeat, updatePour } from './bronze';
import { createWind, updateWind, windAction } from './wind';
import { createOculus, createRing, oculusAction, ringAction, updateRings } from './rings';
import { createTangle, tangleAction, tangleAt, updateTangle } from './tangles';

export { mechanismPrompt, useMechanism } from './use';

export function createMechanisms(level: Level): MechanismState {
  const d = defsOf(level);
  return {
    platforms: [...d.platforms.values()].map(createPlatform),
    trapdoors: [...d.trapdoors.values()].map((t) => ({
      id: t.id,
      open: t.open ? 1 : 0,
      target: t.open ? 1 : 0,
      closeIn: null,
    })),
    mirrors: [...d.mirrors.values()].map((m) => ({
      id: m.id,
      cx: m.cx,
      cz: m.cz,
      facing: m.facing,
      fixed: m.fixed,
    })),
    receivers: [...d.receivers.values()].map((r) => ({ id: r.id, cx: r.cx, cz: r.cz, lit: false })),
    beams: [...d.sunbeams.values()].map((s) => ({ id: s.id, on: s.on, points: [], hits: [] })),
    items: [...d.items.values()].map((i) => ({ id: i.id, cx: i.cx, cz: i.cz, item: i.item, taken: false })),
    slots: [...d.slots.values()].map((s) => ({ id: s.id, cx: s.cx, cz: s.cz, filled: false })),
    boulders: [...d.boulders.values()].map((b) => createBoulder(b, level)),
    blades: [...d.blades.values()].map((b) => ({ id: b.id, on: true, time: 0, cooldown: 0 })),
    fires: [...d.fires.values()].map((f) => ({
      id: f.id,
      on: f.on,
      time: 0,
      phase: f.on ? firePhase(f, 0) : 'idle',
    })),
    glyphs: [...d.glyphs.values()].map(createGlyphLock),
    darts: [...d.darts.values()].map(createDarts),
    pours: [...d.pours.values()].map(createPour),
    heat: [...d.heat.values()].map((h) => ({ id: h.id, on: h.on })),
    winds: [...d.winds.values()].map(createWind),
    rings: [...d.rings.values()].map(createRing),
    oculi: [...d.oculi.values()].map(createOculus),
    tangles: [...d.tangles.values()].map(createTangle),
    scorched: false,
    use: null,
  };
}

/**
 * The mechanisms' share of a cell's floor (see World.floorWith): mirror drums
 * and receiver pedestals are solid, closed trapdoors are floor, and a platform
 * is floor over every cell it covers, or, given a point, only right under it.
 */
export function mechanismFloor(
  world: World,
  cx: number,
  cz: number,
  h: number,
  px?: number,
  pz?: number,
): number {
  const m = world.state.mechanisms;
  const d = defsOf(world.level);
  if (d.solid.has(cellKey(cx, cz))) return Infinity;
  for (const t of m.trapdoors) {
    if (t.open >= devices.trapdoorGives) continue;
    const def = d.trapdoors.get(t.id);
    if (def && inRect(def, cx, cz)) h = Math.max(h, def.y);
  }
  for (const c of d.pourCells.get(cellKey(cx, cz)) ?? []) {
    const st = m.pours.find((s) => s.id === c.id);
    const def = d.pours.get(c.id);
    if (st && def && pourCovers(st, c.i)) h = Math.max(h, def.y);
  }
  const roots = tangleAt(world, cx, cz);
  if (roots) h = Math.max(h, roots.top);
  for (const p of m.platforms) {
    const on =
      px !== undefined && pz !== undefined ? platformUnder(p.pos, px, pz) : platformOverCell(p.pos, cx, cz);
    if (on) h = Math.max(h, p.pos.y);
  }
  return h;
}

/** Whether a cell is covered by a trapdoor (open or not). */
export function isTrapdoorCell(world: World, cx: number, cz: number): boolean {
  return defsOf(world.level).trapdoorCells.has(cellKey(cx, cz));
}

export function updateMechanisms(world: World, dt: number): void {
  const m = world.state.mechanisms;
  const d = defsOf(world.level);
  updateUse(world);
  for (const st of m.platforms) {
    const def = d.platforms.get(st.id);
    if (def) updatePlatform(world, def, st, dt);
  }
  for (const t of m.trapdoors) updateTrapdoor(world, t, dt);
  for (const b of m.boulders) {
    const def = d.boulders.get(b.id);
    if (def) updateBoulder(world, def, b, dt);
  }
  for (const b of m.blades) {
    const def = d.blades.get(b.id);
    if (def) updateBlade(world, def, b, dt);
  }
  for (const f of m.fires) {
    const def = d.fires.get(f.id);
    if (def) updateFire(world, def, f, dt);
  }
  for (const s of m.darts) {
    const def = d.darts.get(s.id);
    if (def) updateDarts(world, def, s, dt);
  }
  for (const s of m.pours) {
    const def = d.pours.get(s.id);
    if (def) updatePour(world, def, s, dt);
  }
  for (const s of m.winds) {
    const def = d.winds.get(s.id);
    if (def) updateWind(world, def, s, dt);
  }
  for (const s of m.tangles) {
    const def = d.tangles.get(s.id);
    if (def) updateTangle(world, def, s, dt);
  }
  updateGlyphs(world, d.glyphs);
  updateRings(world);
  updatePoison(world, dt);
  updateHeat(world, d.heat, dt);

  // Sunlight last, once everything that can stand in its way has moved.
  const lit = new Set<string>();
  for (const b of m.beams) {
    const def = d.sunbeams.get(b.id);
    if (!def || !b.on) {
      b.points = [];
      b.hits = [];
    } else {
      const t = traceBeam(world, d, def);
      b.points = t.points;
      b.hits = t.hits;
      for (const h of t.hits) lit.add(h);
    }
    setSignal(world, `${b.id}.on`, b.on);
  }
  for (const r of m.receivers) {
    const now = lit.has(r.id);
    if (now !== r.lit) {
      r.lit = now;
      world.events.emit({
        type: now ? 'receiver.lit' : 'receiver.dark',
        tick: world.tick,
        id: r.id,
        x: r.cx * 2 + 1,
        y: world.state.player.pos.y + 1.5,
        z: r.cz * 2 + 1,
      });
    }
    setSignal(world, `${r.id}.lit`, now);
  }
}

function updateTrapdoor(world: World, t: MechanismState['trapdoors'][number], dt: number): void {
  if (t.closeIn !== null && t.open >= 1) {
    t.closeIn -= dt;
    if (t.closeIn <= 0) {
      t.closeIn = null;
      t.target = 0;
      world.events.emit({ type: 'trapdoor.closing', tick: world.tick, id: t.id });
    }
  }
  if (t.open !== t.target) {
    const step = devices.trapdoorSpeed * dt;
    t.open = t.target === 1 ? Math.min(1, t.open + step) : Math.max(0, t.open - step);
  }
  setSignal(world, `${t.id}.open`, t.open >= devices.trapdoorGives);
}

/** On respawn: traps start over and nothing is half-operated. */
export function resetMechanisms(world: World): void {
  world.state.mechanisms.use = null;
  resetTraps(world);
}

/** Rule actions on mechanisms (`<id>.<op> [args]`); false when `id` is not a mechanism. */
export function mechanismAction(world: World, id: string, op: string, args: string[]): boolean {
  const m = world.state.mechanisms;
  const d = defsOf(world.level);
  const platform = m.platforms.find((p) => p.id === id);
  const pdef = d.platforms.get(id);
  if (platform && pdef) return platformAction(pdef, platform, op, args);

  const trapdoor = m.trapdoors.find((t) => t.id === id);
  if (trapdoor) {
    const target =
      op === 'open' ? 1 : op === 'close' ? 0 : op === 'toggle' ? (trapdoor.target === 1 ? 0 : 1) : null;
    if (target === null) return false;
    if (target !== trapdoor.target)
      world.events.emit({
        type: target === 1 ? 'trapdoor.opening' : 'trapdoor.closing',
        tick: world.tick,
        id,
      });
    trapdoor.target = target;
    const secs = /^(\d+(?:\.\d+)?)s$/.exec(args[0] ?? '');
    trapdoor.closeIn = target === 1 && secs ? Number(secs[1]) : null;
    return true;
  }

  const beam = m.beams.find((b) => b.id === id);
  if (beam) {
    if (op === 'on' || op === 'off' || op === 'toggle') {
      beam.on = op === 'on' ? true : op === 'off' ? false : !beam.on;
      return true;
    }
    return false;
  }

  if (op === 'turn' && m.mirrors.some((mi) => mi.id === id)) return turnMirror(world, id);
  if (op === 'turn' && m.glyphs.some((g) => g.id === id)) return turnGlyph(world, id);

  const boulder = m.boulders.find((b) => b.id === id);
  const bdef = d.boulders.get(id);
  if (boulder && bdef) return boulderAction(world, bdef, boulder, op);

  const blade = m.blades.find((b) => b.id === id);
  if (blade && (op === 'start' || op === 'stop')) {
    blade.on = op === 'start';
    return true;
  }

  const pour = m.pours.find((s) => s.id === id);
  const podef = d.pours.get(id);
  if (pour && podef) return pourAction(world, podef, pour, op);

  const heat = m.heat.find((h) => h.id === id);
  if (heat && (op === 'on' || op === 'off')) {
    heat.on = op === 'on';
    return true;
  }

  const wind = m.winds.find((w) => w.id === id);
  if (wind) return windAction(wind, op);

  const ring = m.rings.find((r) => r.id === id);
  const rdef = d.rings.get(id);
  if (ring && rdef) return ringAction(world, rdef, ring, op);

  const tangle = m.tangles.find((t) => t.id === id);
  if (tangle) return tangleAction(tangle, op);

  const oculus = m.oculi.find((o) => o.id === id);
  const odef = d.oculi.get(id);
  if (oculus && odef) return oculusAction(world, odef, oculus, op);

  const fire = m.fires.find((f) => f.id === id);
  if (fire && (op === 'on' || op === 'off')) {
    fire.on = op === 'on';
    return true;
  }
  return false;
}

/**
 * Traps (spec §8 "Trampas"): each one announces itself before it acts and
 * starts over when Nora respawns at a checkpoint (see resetTraps).
 *
 * - Rolling boulder: a zone rule releases it; it rumbles, then rolls down its
 *   corridor gathering speed and crushes whatever is in its way. A side
 *   alcove is the escape.
 * - Pendulum blades: a fixed 2.4 s swing across the corridor; a hit costs 40
 *   health and knocks Nora aside.
 * - Fire floor: sectors that burst into flame on a rhythm, with embers and a
 *   hiss (the warning phase) before each burst. Standing in them while they
 *   burn is deadly; leaping over them is not.
 */
import type { Level } from '../grid/level';
import { BLOCK, cellCenter } from '../grid/units';
import { setSignal } from '../logic/rules';
import { damagePlayer, killPlayer, setMode } from '../player/context';
import { traps, tuning } from '../player/tuning';
import type { PlayerMode } from '../state';
import type { World } from '../world';
import { defsOf, inRect, type BladeDef, type BoulderDef, type FireDef } from './defs';
import type { BladeState, BoulderState, FirePhase, FireState } from './types';

const GROUNDED: ReadonlySet<PlayerMode> = new Set(['ground', 'block', 'push', 'pull', 'lever', 'pickup']);

/** Throws Nora off her feet: airborne with a velocity, no fall damage counted from above. */
export function knockback(world: World, vx: number, vz: number, vy: number): void {
  const p = world.state.player;
  if (p.mode === 'dead') return;
  p.vel = { x: vx, y: vy, z: vz };
  p.airSpeedCap = Math.max(Math.hypot(vx, vz), tuning.airControlMinCap);
  p.jumped = false;
  p.fallFrom = p.pos.y;
  p.ledge = null;
  p.move = null;
  p.target = null;
  p.dir = null;
  setMode(p, 'air');
}

// ─────────────────────────────── Rolling boulder ───────────────────────────────

export function createBoulder(def: BoulderDef, level: Level): BoulderState {
  const st: BoulderState = {
    id: def.id,
    mode: 'idle',
    time: 0,
    dist: 0,
    speed: 0,
    pos: { x: 0, y: 0, z: 0 },
  };
  placeBoulder(level, def, st);
  return st;
}

function placeBoulder(level: Level, def: BoulderDef, st: BoulderState): void {
  let i = 1;
  while (i < def.path.length - 1 && (def.at[i] ?? 0) < st.dist) i++;
  const a = def.path[i - 1] ?? { x: 0, z: 0 };
  const b = def.path[i] ?? a;
  const a0 = def.at[i - 1] ?? 0;
  const len = (def.at[i] ?? a0) - a0;
  const f = len > 0 ? Math.min(1, (st.dist - a0) / len) : 0;
  const x = a.x + (b.x - a.x) * f;
  const z = a.z + (b.z - a.z) * f;
  const floor = level.floorAt(x, z);
  st.pos = { x, y: (Number.isFinite(floor) ? floor : 0) + traps.boulder.radius, z };
}

export function boulderAction(world: World, def: BoulderDef, st: BoulderState, op: string): boolean {
  if (op === 'release') {
    if (st.mode === 'idle') {
      st.mode = 'warning';
      st.time = 0;
      world.events.emit({ type: 'boulder.warning', tick: world.tick, id: st.id, ...st.pos });
    }
    return true;
  }
  if (op === 'reset') {
    resetBoulder(world, def, st);
    return true;
  }
  return false;
}

function resetBoulder(world: World, def: BoulderDef, st: BoulderState): void {
  st.mode = 'idle';
  st.time = 0;
  st.dist = 0;
  st.speed = 0;
  placeBoulder(world.level, def, st);
}

export function updateBoulder(world: World, def: BoulderDef, st: BoulderState, dt: number): void {
  const B = traps.boulder;
  st.time += dt;
  if (st.mode === 'warning' && st.time >= B.warning) {
    st.mode = 'rolling';
    st.time = 0;
    // Time to the end: accelerating to top speed, then steady.
    const tMax = B.maxSpeed / B.accel;
    const dMax = 0.5 * B.accel * tMax * tMax;
    const duration =
      def.length <= dMax ? Math.sqrt((2 * def.length) / B.accel) : tMax + (def.length - dMax) / B.maxSpeed;
    world.events.emit({ type: 'boulder.rolling', tick: world.tick, id: st.id, duration, ...st.pos });
  }
  if (st.mode === 'rolling') {
    st.speed = Math.min(B.maxSpeed, st.speed + B.accel * dt);
    st.dist = Math.min(def.length, st.dist + st.speed * dt);
    placeBoulder(world.level, def, st);
    crush(world, st);
    if (st.dist >= def.length) {
      st.mode = 'done';
      st.speed = 0;
      world.events.emit({ type: 'boulder.crashed', tick: world.tick, id: st.id, ...st.pos });
    }
  }
  setSignal(world, `${st.id}.rolling`, st.mode === 'rolling');
  setSignal(world, `${st.id}.done`, st.mode === 'done');
}

function crush(world: World, st: BoulderState): void {
  const p = world.state.player;
  if (p.mode === 'dead') return;
  const R = traps.boulder.radius;
  const d = Math.hypot(p.pos.x - st.pos.x, p.pos.z - st.pos.z);
  if (d >= R + tuning.radius - 0.05) return;
  if (p.pos.y >= st.pos.y + R - 0.1 || p.pos.y + tuning.height <= st.pos.y - R) return;
  killPlayer(world, 'boulder');
}

// ────────────────────────────── Pendulum blades ──────────────────────────────

export interface BladePose {
  /** Swing angle (rad) from the vertical, positive towards +axis. */
  angle: number;
  /** Lateral offset of the blade from the corridor's centre line (m). */
  lateral: number;
  /** Height of the blade's lowest point (m). */
  bottom: number;
  /** Swing speed sign along the axis. */
  sign: number;
  /** Pivot and arm length (m), for the renderer. */
  pivot: number;
  reach: number;
}

function reachOf(def: BladeDef): number {
  return def.pivot - (def.floor + traps.blade.clearance);
}

/** Swing angle (rad) of a blade now, without allocating (the renderer calls it every frame). */
export function bladeAngle(def: BladeDef, st: BladeState): number {
  return traps.blade.amplitude * Math.sin(2 * Math.PI * (st.time / traps.blade.period + def.phase));
}

/** Angular speed (rad/s) of a blade now: its sign is the swing direction. */
export function bladeAngularSpeed(def: BladeDef, st: BladeState): number {
  const T = traps.blade.period;
  return ((traps.blade.amplitude * 2 * Math.PI) / T) * Math.cos(2 * Math.PI * (st.time / T + def.phase));
}

function pose(def: BladeDef, st: BladeState): BladePose {
  const T = traps.blade.period;
  const w = 2 * Math.PI * (st.time / T + def.phase);
  const angle = bladeAngle(def, st);
  const reach = reachOf(def);
  return {
    angle,
    lateral: reach * Math.sin(angle),
    bottom: def.pivot - reach * Math.cos(angle),
    sign: Math.cos(w) >= 0 ? 1 : -1,
    pivot: def.pivot,
    reach,
  };
}

/** Where a blade is now (for tests and the renderer). */
export function bladePose(world: World, id: string): BladePose {
  const def = defsOf(world.level).blades.get(id);
  const st = world.state.mechanisms.blades.find((b) => b.id === id);
  if (!def || !st) throw new Error(`no blade ${id}`);
  return pose(def, st);
}

export function updateBlade(world: World, def: BladeDef, st: BladeState, dt: number): void {
  const before = pose(def, st).angle;
  if (st.on) st.time += dt;
  st.cooldown = Math.max(0, st.cooldown - dt);
  const now = pose(def, st);
  // A whoosh each time it sweeps through the bottom of its arc.
  if (st.on && Math.sign(before) !== Math.sign(now.angle) && now.angle !== 0) {
    world.events.emit({
      type: 'blade.swish',
      tick: world.tick,
      id: st.id,
      x: cellCenter(def.cx),
      y: def.floor + 1,
      z: cellCenter(def.cz),
    });
  }
  const p = world.state.player;
  if (st.cooldown > 0 || p.mode === 'dead') return;
  const B = traps.blade;
  const cx = cellCenter(def.cx);
  const cz = cellCenter(def.cz);
  const lat = def.axis === 'x' ? p.pos.x - cx : p.pos.z - cz;
  const lon = def.axis === 'x' ? p.pos.z - cz : p.pos.x - cx;
  if (Math.abs(lon) >= tuning.radius + B.thickness / 2) return;
  if (Math.abs(lat - now.lateral) >= tuning.radius + B.halfWidth) return;
  if (p.pos.y >= now.bottom + B.height || p.pos.y + tuning.height <= now.bottom) return;
  st.cooldown = B.cooldown;
  world.events.emit({
    type: 'blade.hit',
    tick: world.tick,
    id: st.id,
    x: p.pos.x,
    y: p.pos.y + 1,
    z: p.pos.z,
  });
  damagePlayer(world, B.damage, 'blade');
  const push = B.push * now.sign;
  knockback(world, def.axis === 'x' ? push : 0, def.axis === 'z' ? push : 0, B.lift);
}

// ──────────────────────────────── Fire floor ────────────────────────────────

export function firePhase(def: FireDef, time: number): FirePhase {
  const u = (((time + def.offset) % def.period) + def.period) % def.period;
  if (u < def.burn) return 'burn';
  if (u >= def.period - traps.fire.warning) return 'warn';
  return 'idle';
}

export function updateFire(world: World, def: FireDef, st: FireState, dt: number): void {
  if (st.on) st.time += dt;
  const phase: FirePhase = st.on ? firePhase(def, st.time) : 'idle';
  if (phase !== st.phase) {
    const type = phase === 'warn' ? 'fire.warn' : phase === 'burn' ? 'fire.burst' : 'fire.out';
    world.events.emit({
      type,
      tick: world.tick,
      id: st.id,
      x: ((def.minX + def.maxX) / 2) * BLOCK,
      y: world.level.floorAt(cellCenter(def.minX), cellCenter(def.minZ)) + 0.5,
      z: ((def.minZ + def.maxZ) / 2) * BLOCK,
    });
    st.phase = phase;
  }
  setSignal(world, `${st.id}.burning`, phase === 'burn');
  if (phase !== 'burn') return;
  const p = world.state.player;
  if (!GROUNDED.has(p.mode)) return;
  const pcx = Math.floor(p.pos.x / BLOCK);
  const pcz = Math.floor(p.pos.z / BLOCK);
  if (!inRect(def, pcx, pcz)) return;
  if (p.pos.y - world.grid.floorAt(p.pos.x, p.pos.z) > 0.1) return;
  killPlayer(world, 'fire');
}

// ─────────────────────────────────── Reset ───────────────────────────────────

/** Traps start over when Nora respawns: blades and fires from the top of their cycle, boulders back home unless they already ran. */
export function resetTraps(world: World): void {
  const defs = defsOf(world.level);
  const m = world.state.mechanisms;
  for (const b of m.blades) {
    b.time = 0;
    b.cooldown = 0;
  }
  for (const f of m.fires) {
    f.time = 0;
    const def = defs.fires.get(f.id);
    f.phase = def && f.on ? firePhase(def, 0) : 'idle';
  }
  for (const b of m.boulders) {
    const def = defs.boulders.get(b.id);
    if (def && (b.mode === 'warning' || b.mode === 'rolling')) resetBoulder(world, def, b);
  }
}

/**
 * Moving platforms (spec §8 "Plataforma móvil"): a block-sized stone slab
 * that follows a path of waypoints at a steady speed, resting at each one.
 * It is floor wherever it is (spec §4 "Objetos dinámicos en la rejilla"),
 * and it carries whatever stands on it: Nora on her feet, hanging from its
 * edge or climbing onto it, and blocks.
 */
import { sweep } from '../grid/collision';
import { BLOCK, DIR_VEC } from '../grid/units';
import { setSignal } from '../logic/rules';
import { setMode } from '../player/context';
import { tuning } from '../player/tuning';
import type { BlockActor, PlayerMode } from '../state';
import type { World } from '../world';
import type { PlatformDef } from './defs';
import type { PlatformState, Point } from './types';

const HALF = BLOCK / 2;
/** Nora can stand this far past the slab's edge and still be held by it (collision's support margin). */
const STAND_MARGIN = 0.06;

/** Modes in which Nora stands on the floor under her feet. */
const STANDING: ReadonlySet<PlayerMode> = new Set(['ground', 'block', 'push', 'pull', 'lever', 'pickup']);

export function createPlatform(def: PlatformDef): PlatformState {
  const start = def.path[0] ?? { x: 0, y: 0, z: 0 };
  return {
    id: def.id,
    pos: { ...start },
    from: 0,
    to: 0,
    s: 0,
    wait: 0,
    running: def.running,
    stopAt: null,
    dir: 1,
    cargo: [],
  };
}

/** Whether the slab covers more than a sliver of cell (cx, cz): it is floor there for collision. */
export function platformOverCell(pos: Point, cx: number, cz: number): boolean {
  const ox = Math.min(pos.x + HALF, (cx + 1) * BLOCK) - Math.max(pos.x - HALF, cx * BLOCK);
  const oz = Math.min(pos.z + HALF, (cz + 1) * BLOCK) - Math.max(pos.z - HALF, cz * BLOCK);
  return ox > 0.05 && oz > 0.05;
}

/** Whether the point (x, z) is on the slab. */
export function platformUnder(pos: Point, x: number, z: number): boolean {
  return Math.abs(x - pos.x) <= HALF && Math.abs(z - pos.z) <= HALF;
}

const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** The waypoint after `from` along the path (flips a ping-pong at its ends); null at the end of a one-way path. */
function nextWaypoint(def: PlatformDef, st: PlatformState, commit: boolean): number | null {
  const n = def.path.length;
  if (def.loop === 'cycle') return (st.from + 1) % n;
  if (def.loop === 'once') return st.from + 1 < n ? st.from + 1 : null;
  let dir = st.dir;
  if (st.from + dir < 0 || st.from + dir >= n) dir = -dir as 1 | -1;
  if (commit) st.dir = dir;
  return st.from + dir;
}

/** One waypoint towards `target` (the short way along a one-way or ping-pong path). */
function towards(def: PlatformDef, st: PlatformState, target: number): number {
  if (def.loop === 'cycle') return (st.from + 1) % def.path.length;
  const dir = target > st.from ? 1 : -1;
  st.dir = dir;
  return st.from + dir;
}

// ─────────────────────────────── Rule actions ───────────────────────────────

export function platformAction(def: PlatformDef, st: PlatformState, op: string, args: string[]): boolean {
  switch (op) {
    case 'start':
      st.running = true;
      st.stopAt = null;
      return true;
    case 'stop':
      st.running = false;
      st.stopAt = null;
      return true;
    case 'toggle':
      st.running = !st.running;
      st.stopAt = null;
      return true;
    case 'next': {
      st.running = false;
      if (st.from !== st.to) st.stopAt = st.to;
      else st.stopAt = nextWaypoint(def, st, true);
      return true;
    }
    case 'goto': {
      const n = Number(args[0]);
      if (!Number.isInteger(n) || n < 0 || n >= def.path.length) return false;
      st.running = false;
      st.stopAt = n;
      return true;
    }
    default:
      return false;
  }
}

// ─────────────────────────────────── Update ───────────────────────────────────

export function updatePlatform(world: World, def: PlatformDef, st: PlatformState, dt: number): void {
  const before = { ...st.pos };
  if (st.from === st.to) {
    st.wait = Math.max(0, st.wait - dt);
    if (st.stopAt === st.from) st.stopAt = null;
    const going = st.running || st.stopAt !== null;
    if (going && st.wait <= 0) {
      const next = st.stopAt !== null ? towards(def, st, st.stopAt) : nextWaypoint(def, st, true);
      if (next === null) {
        st.running = false;
      } else {
        st.to = next;
        st.s = 0;
        loadCargo(world, st);
        const a = def.path[st.from] as Point;
        const b = def.path[st.to] as Point;
        world.events.emit({
          type: 'platform.started',
          tick: world.tick,
          id: st.id,
          from: st.from,
          to: st.to,
          duration: dist(a, b) / def.speed,
          x: st.pos.x,
          y: st.pos.y,
          z: st.pos.z,
        });
      }
    }
  }
  if (st.from !== st.to) {
    const a = def.path[st.from] as Point;
    const b = def.path[st.to] as Point;
    const len = dist(a, b);
    st.s = Math.min(len, st.s + def.speed * dt);
    const f = len > 0 ? st.s / len : 1;
    st.pos = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    if (st.s >= len) {
      st.pos = { ...b };
      st.from = st.to;
      st.s = 0;
      st.wait = def.pause;
      world.events.emit({
        type: 'platform.arrived',
        tick: world.tick,
        id: st.id,
        at: st.from,
        x: st.pos.x,
        y: st.pos.y,
        z: st.pos.z,
      });
    }
  }
  carry(world, st, before);
  const resting = st.from === st.to;
  setSignal(world, `${st.id}.moving`, !resting);
  def.path.forEach((_, i) => setSignal(world, `${st.id}.at${i}`, resting && st.from === i));
}

/** Blocks resting on the slab when it sets off ride it for the leg. */
function loadCargo(world: World, st: PlatformState): void {
  const cx = Math.floor(st.pos.x / BLOCK);
  const cz = Math.floor(st.pos.z / BLOCK);
  st.cargo = world.state.actors
    .filter(
      (a): a is BlockActor =>
        a.kind === 'block' &&
        a.from === null &&
        a.fallTo === null &&
        a.cx === cx &&
        a.cz === cz &&
        Math.abs(a.y - st.pos.y) < 0.05,
    )
    .map((b) => b.id);
}

/** Moves riders by the slab's motion this tick. */
function carry(world: World, st: PlatformState, before: Point): void {
  const d = { x: st.pos.x - before.x, y: st.pos.y - before.y, z: st.pos.z - before.z };
  const moved = d.x !== 0 || d.y !== 0 || d.z !== 0;
  if (moved) {
    const p = world.state.player;
    const over = (x: number, z: number, margin: number): boolean =>
      Math.abs(x - before.x) <= HALF + margin && Math.abs(z - before.z) <= HALF + margin;
    if (STANDING.has(p.mode) && over(p.pos.x, p.pos.z, STAND_MARGIN) && Math.abs(p.pos.y - before.y) < 0.05) {
      carryStanding(world, d);
    } else if (
      p.mode === 'hang' &&
      p.ledge &&
      p.ledge.y === before.y &&
      platformOverCell(before, p.ledge.cx, p.ledge.cz)
    ) {
      carryHanging(world, st, d);
    } else if (
      p.mode === 'climb' &&
      p.move &&
      over(p.move.to.x, p.move.to.z, 0.05) &&
      Math.abs(p.move.to.y - before.y) < 0.05
    ) {
      for (const v of [p.move.from, p.move.to, p.pos]) {
        v.x += d.x;
        v.y += d.y;
        v.z += d.z;
      }
    }
  }
  moveCargo(world, st, d);
}

function carryStanding(world: World, d: Point): void {
  const p = world.state.player;
  p.pos.y += d.y;
  const x0 = p.pos.x;
  const z0 = p.pos.z;
  if (d.x !== 0 || d.z !== 0) {
    const res = sweep(
      world.grid,
      { x: p.pos.x, z: p.pos.z, y: p.pos.y, radius: tuning.radius, height: tuning.height },
      d.x,
      d.z,
      tuning.stepUp,
    );
    p.pos.x = res.x;
    p.pos.z = res.z;
  }
  if (p.move) {
    const mx = p.pos.x - x0;
    const mz = p.pos.z - z0;
    for (const v of [p.move.from, p.move.to]) {
      v.x += mx;
      v.y += d.y;
      v.z += mz;
    }
  }
}

/**
 * Nora hanging from the slab's edge goes where it goes. The body hangs under
 * the slab, so only the static walls can scrape her off (the grid would see
 * the slab's own column as a wall).
 */
function carryHanging(world: World, st: PlatformState, d: Point): void {
  const p = world.state.player;
  const ledge = p.ledge;
  if (!ledge) return;
  const x = p.pos.x + d.x;
  const z = p.pos.z + d.z;
  const r = tuning.radius;
  const level = world.level;
  for (const [ox, oz] of [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ] as const) {
    const s = level.sector(Math.floor((x + ox) / BLOCK), Math.floor((z + oz) / BLOCK));
    if (!s || s.wall) {
      dropFromLedge(world);
      return;
    }
  }
  p.pos.x = x;
  p.pos.y += d.y;
  p.pos.z = z;
  const v = DIR_VEC[ledge.dir];
  ledge.y = st.pos.y;
  ledge.cx = Math.floor((x + v.x * (r + 0.1)) / BLOCK);
  ledge.cz = Math.floor((z + v.z * (r + 0.1)) / BLOCK);
  if (world.grid.cellFloor(ledge.cx, ledge.cz) !== ledge.y) dropFromLedge(world);
}

/** Loses the grip (like letting go): she falls from where she hangs. */
function dropFromLedge(world: World): void {
  const p = world.state.player;
  p.vel = { x: 0, y: 0, z: 0 };
  p.airSpeedCap = tuning.airControlMinCap;
  p.fallFrom = p.pos.y;
  p.sinceRelease = 0;
  p.jumped = false;
  p.ledge = null;
  setMode(p, 'air');
  world.events.emit({ type: 'player.letGo', tick: world.tick });
}

/** Riding blocks follow the slab, cell to cell (their `from`/`t` pair interpolates like a push). */
function moveCargo(world: World, st: PlatformState, d: Point): void {
  if (st.cargo.length === 0) return;
  const fx = (st.pos.x - HALF) / BLOCK;
  const fz = (st.pos.z - HALF) / BLOCK;
  const whole = (f: number): boolean => Math.abs(f - Math.round(f)) < 1e-6;
  /** Along a moving axis: the cell it last left, the one it heads into, and the progress between. */
  const along = (f: number, sign: number): [number, number, number] =>
    sign > 0
      ? [Math.floor(f), Math.floor(f) + 1, f - Math.floor(f)]
      : [Math.ceil(f), Math.ceil(f) - 1, Math.ceil(f) - f];
  for (const id of st.cargo) {
    const b = world.state.actors.find((a): a is BlockActor => a.kind === 'block' && a.id === id);
    if (!b) continue;
    b.y = st.pos.y;
    if (whole(fx) && whole(fz)) {
      b.cx = Math.round(fx);
      b.cz = Math.round(fz);
      b.from = null;
      b.t = 0;
    } else if (!whole(fx)) {
      const [from, to, t] = along(fx, Math.sign(d.x) || 1);
      b.from = { cx: from, cz: Math.round(fz) };
      b.cx = to;
      b.cz = Math.round(fz);
      b.t = t;
    } else {
      const [from, to, t] = along(fz, Math.sign(d.z) || 1);
      b.from = { cx: Math.round(fx), cz: from };
      b.cx = Math.round(fx);
      b.cz = to;
      b.t = t;
    }
  }
  if (st.from === st.to) st.cargo = [];
}

/**
 * The stone guardian (spec §7 "Guardián de piedra"): a mini-boss that is
 * "a puzzle shaped like an enemy". It is immune to everything, pistols
 * included (it is not one of world.state.enemies), except two things:
 *
 * - being lured onto a trapdoor or crumbling floor over a pit and falling in;
 * - having its core broken by Nora dropping onto its back from at least 2 m
 *   above it while its fists are buried after a slam (the hit window).
 *
 * Each blow costs it a phase: the first cracks its shell (phase 2: faster,
 * and it keeps off trapdoors), the second defeats it.
 *
 * It is slow and heavy: it walks the grid with A* (./pathfind), one click up
 * or down per step and never a jump, turning before it walks. When Nora is in
 * reach it winds up (readable: 1.1 s, 0.85 s in phase 2) and slams the
 * floor, hurting everything close and low; a jump at the right moment lets
 * the shockwave pass. When she is out of reach (a ledge above it) it goes to
 * the spot below her and pounds the wall in frustration, which opens the
 * window for the blow from above.
 *
 * It wakes when Nora enters its hall, never leaves the hall, and at a
 * checkpoint respawn goes back to its pedestal and sleeps (spec §7).
 */
import { sweep, type GridQuery } from '../grid/collision';
import { sectorTop, type Level } from '../grid/level';
import { BLOCK, DIR_YAW, cellCenter, wrapAngle } from '../grid/units';
import { setSignal } from '../logic/rules';
import { isTrapdoorCell } from '../mechanisms';
import { knockback } from '../mechanisms/traps';
import { bronzeBurnsAt } from '../mechanisms/bronze';
import { inOculusLight, underOculus } from '../mechanisms/rings';
import { damagePlayer } from '../player/context';
import { giantFloor, giantTuning, guardianTuning as G, tuning } from '../player/tuning';
import type { PlayerMode } from '../state';
import { tileState, type World } from '../world';
import type { GuardianMode, GuardianState } from './guardian-types';
import { findPath, walkable, type NavGrid, type Walker } from './pathfind';

const EPS = 1e-6;
/** Modes in which Nora can be shoved aside by its body. */
const SOLID_FOR: ReadonlySet<PlayerMode> = new Set(['ground', 'air', 'block', 'lever', 'pickup']);

/** The tuning for a guardian's kind: Anzur, the giant, has its own (bigger, slower, three phases). */
const tun = (g: Pick<GuardianState, 'kind'>): typeof G => (g.kind === 'giant' ? giantTuning : G);
const walkerOf = (g: GuardianState): Walker => {
  const t = tun(g);
  return { climb: t.climb, maxDrop: t.maxDrop, height: t.height, radius: t.radius };
};

const cellOf = (v: { x: number; z: number }): [number, number] => [
  Math.floor(v.x / BLOCK),
  Math.floor(v.z / BLOCK),
];

// ───────────────────────────── Creation and reset ─────────────────────────────

export function createGuardians(level: Level): GuardianState[] {
  const out: GuardianState[] = [];
  for (const e of level.entities) {
    if (e.type !== 'guardian') continue;
    const room = level.rooms.find((r) => r.id === e.room);
    const ox = room?.minX ?? 0;
    const oz = room?.minZ ?? 0;
    const [ax, az, aw, ah] = e.arena;
    const x = cellCenter(e.at[0]);
    const z = cellCenter(e.at[1]);
    const home = { x, y: level.floorAt(x, z), z };
    out.push({
      id: e.id,
      kind: e.kind,
      immune: 0,
      mode: 'dormant',
      modeTime: 0,
      phase: 1,
      pos: { ...home },
      vel: { x: 0, z: 0 },
      vy: 0,
      yaw: DIR_YAW[e.face],
      home,
      homeYaw: DIR_YAW[e.face],
      arena: { minX: ox + ax, minZ: oz + az, maxX: ox + ax + aw, maxZ: oz + az + ah },
      path: [],
      repathIn: 0,
      reachable: false,
      cooldown: 0,
      stride: 0,
      ground: [e.at[0], e.at[1]],
      climb: null,
      pound: false,
    });
  }
  return out;
}

/** At a checkpoint respawn it goes back to its pedestal and sleeps; the phase it reached stays. */
export function resetGuardians(world: World): void {
  for (const g of world.state.guardians) {
    if (g.mode === 'defeated') continue;
    g.pos = { ...g.home };
    g.vel = { x: 0, z: 0 };
    g.vy = 0;
    g.yaw = g.homeYaw;
    setMode(g, 'dormant');
    g.path = [];
    g.repathIn = 0;
    g.reachable = false;
    g.cooldown = 0;
    g.stride = 0;
    g.ground = cellOf(g.home);
    g.climb = null;
    g.pound = false;
    setSignal(world, `${g.id}.awake`, false);
  }
}

/** Rule actions: `<id>.wake`, and `<id>.advance` for the giant's next phase. */
export function guardianAction(world: World, id: string, op: string): boolean {
  const g = world.state.guardians.find((x) => x.id === id);
  if (!g) return false;
  if (op === 'wake') {
    if (g.mode === 'dormant') wake(world, g);
    return true;
  }
  if (op === 'advance') {
    if (g.mode === 'defeated' || g.phase === 3) return true;
    g.phase = g.phase === 1 ? 2 : 3;
    g.path = [];
    g.repathIn = 0;
    setSignal(world, `${g.id}.phase${g.phase}`, true);
    emit(world, 'guardian.phase', g, { phase: g.phase });
    // It reels at the change, then comes on harder.
    if (g.mode !== 'dormant') setMode(g, 'stunned');
    return true;
  }
  return false;
}

// ─────────────────────────────────── Update ───────────────────────────────────

export function updateGuardians(world: World, dt: number): void {
  for (const g of world.state.guardians) updateGuardian(world, g, dt);
}

function setMode(g: GuardianState, mode: GuardianMode): void {
  g.mode = mode;
  g.modeTime = 0;
}

function emit(world: World, type: string, g: GuardianState, data: Record<string, unknown> = {}): void {
  world.events.emit({ type, tick: world.tick, id: g.id, x: g.pos.x, y: g.pos.y, z: g.pos.z, ...data });
}

const inArena = (g: GuardianState, cx: number, cz: number): boolean =>
  cx >= g.arena.minX && cx < g.arena.maxX && cz >= g.arena.minZ && cz < g.arena.maxZ;

function noraInArena(world: World, g: GuardianState): boolean {
  const p = world.state.player;
  if (p.mode === 'dead') return false;
  const [cx, cz] = cellOf(p.pos);
  return inArena(g, cx, cz);
}

/**
 * The floor as a guardian walks it: Anzur strides over the holes its slams
 * open (it never falls), so for it a fallen tile keeps its old height.
 */
function gridFor(world: World, g: GuardianState): GridQuery {
  if (g.kind !== 'giant') return world.grid;
  const q = world.grid;
  const level = world.level;
  const whole = (cx: number, cz: number, h: number): number => {
    const s = level.sector(cx, cz);
    return s && !s.wall && world.state.tiles[`${cx},${cz}`]?.fallen ? Math.max(h, sectorTop(s)) : h;
  };
  return {
    ...q,
    cellFloor: (cx, cz) => whole(cx, cz, q.cellFloor(cx, cz)),
    floorAt: (x, z) => whole(Math.floor(x / BLOCK), Math.floor(z / BLOCK), q.floorAt(x, z)),
  };
}

function navOf(world: World, g: GuardianState): NavGrid {
  return {
    q: gridFor(world, g),
    forbidden: (cx, cz) =>
      !inArena(g, cx, cz) ||
      world.level.sector(cx, cz)?.flags.has('death') === true ||
      // Once it has fallen through the floor it keeps off trapdoors and cracked stone.
      (g.phase === 2 &&
        (isTrapdoorCell(world, cx, cz) || world.level.sector(cx, cz)?.flags.has('crumble') === true)),
  };
}

function wake(world: World, g: GuardianState): void {
  setMode(g, 'chase');
  g.repathIn = 0;
  setSignal(world, `${g.id}.awake`, true);
  emit(world, 'guardian.woke', g);
}

function updateGuardian(world: World, g: GuardianState, dt: number): void {
  if (g.mode === 'defeated') return;
  g.modeTime += dt;
  g.cooldown = Math.max(0, g.cooldown - dt);
  g.repathIn = Math.max(0, g.repathIn - dt);
  const ph = g.phase - 1;
  const p = world.state.player;

  // Bazûr (the bronze guardian): molten bronze poured over it cools its plates, a blow. The
  // same pour counts once: it must stand clear of hot bronze for a moment before the next.
  const burning = g.kind === 'bronze' && bronzeBurnsAt(world, ...cellOf(g.pos), g.pos.y);
  if (!burning) g.immune = Math.max(0, g.immune - dt);
  const awake = g.mode !== 'dormant' && g.mode !== 'falling' && g.mode !== 'fallen' && g.mode !== 'climbing';
  if (burning && awake && g.immune <= 0) {
    g.immune = tun(g).bronzeImmune;
    setSignal(world, `${g.id}.burned`, true);
    emit(world, 'guardian.burned', g, { phase: g.phase });
    if (g.phase === 2) {
      defeat(world, g);
      return;
    }
    toPhase2(world, g);
    setMode(g, 'stunned');
  }

  // Anzur in phase 3: the oculus light falling on it is what stops it.
  if (g.kind === 'giant' && g.phase === 3 && g.mode !== 'dormant' && inOculusLight(world, ...cellOf(g.pos))) {
    emit(world, 'guardian.lit', g);
    defeat(world, g);
    return;
  }

  // Anzur stands across any hole it opens: it never falls.
  if (g.kind !== 'giant' && g.mode !== 'falling' && g.mode !== 'fallen' && g.mode !== 'climbing') {
    // The floor gave way (a trapdoor opened, a tile fell): it drops.
    const floor = world.grid.floorAt(g.pos.x, g.pos.z);
    if (floor < g.pos.y - 0.6) {
      setMode(g, 'falling');
      g.vy = 0;
      g.vel = { x: 0, z: 0 };
      emit(world, 'guardian.falling', g);
    } else {
      crackUnder(world, g);
    }
  }

  switch (g.mode) {
    case 'dormant':
      brake(g, dt, 6);
      if (noraInArena(world, g)) wake(world, g);
      break;
    case 'chase':
      chase(world, g, dt);
      break;
    case 'windup': {
      brake(g, dt, 6);
      turnTo(g, yawTowards(g.pos, p.pos), (tun(g).turnSpeed[ph] ?? 2) * 0.6, dt);
      if (g.modeTime >= (tun(g).windup[ph] ?? 1)) slam(world, g);
      break;
    }
    case 'slam':
    case 'recover':
      brake(g, dt, 6);
      if (g.modeTime >= (tun(g).recover[ph] ?? 1.5)) {
        setMode(g, 'chase');
        g.cooldown = tun(g).cooldown;
        g.repathIn = 0;
      }
      break;
    case 'stunned':
      brake(g, dt, 6);
      if (g.modeTime >= tun(g).stunTime) {
        setMode(g, 'chase');
        g.cooldown = tun(g).cooldown;
        g.repathIn = 0;
      }
      break;
    case 'falling': {
      g.vy -= tun(g).gravity * dt;
      g.pos.y += g.vy * dt;
      const floor = world.grid.floorAt(g.pos.x, g.pos.z);
      if (g.pos.y <= floor) {
        g.pos.y = Number.isFinite(floor) ? floor : g.pos.y;
        g.vy = 0;
        setSignal(world, `${g.id}.fell`, true);
        emit(world, 'guardian.fell', g, { phase: g.phase });
        if (g.phase === 2) defeat(world, g);
        else {
          toPhase2(world, g);
          setMode(g, 'fallen');
        }
      }
      break;
    }
    case 'fallen':
      if (g.modeTime >= tun(g).fallenTime) {
        const [gx, gz] = g.ground;
        const x = cellCenter(gx);
        const z = cellCenter(gz);
        g.climb = { from: { ...g.pos }, to: { x, y: world.grid.floorAt(x, z), z } };
        g.yaw = yawTowards(g.pos, g.climb.to);
        setMode(g, 'climbing');
        emit(world, 'guardian.climbing', g);
      }
      break;
    case 'climbing': {
      const c = g.climb;
      const t = Math.min(1, g.modeTime / tun(g).climbOutTime);
      if (c) {
        // Up the pit wall first, then over the lip.
        const up = Math.min(1, t / 0.75);
        const over = Math.max(0, (t - 0.55) / 0.45);
        const ease = (u: number): number => u * u * (3 - 2 * u);
        g.pos.y = c.from.y + (c.to.y - c.from.y) * ease(up);
        g.pos.x = c.from.x + (c.to.x - c.from.x) * ease(over);
        g.pos.z = c.from.z + (c.to.z - c.from.z) * ease(over);
      }
      if (t >= 1) {
        if (c) g.pos = { ...c.to };
        g.climb = null;
        setMode(g, 'chase');
        g.repathIn = 0;
        g.cooldown = tun(g).cooldown;
        emit(world, 'guardian.climbed', g);
      }
      break;
    }
    default:
      break;
  }

  if (
    g.mode === 'chase' ||
    g.mode === 'dormant' ||
    g.mode === 'windup' ||
    g.mode === 'recover' ||
    g.mode === 'stunned'
  )
    move(world, g, dt);
  touchNora(world, g);
}

function toPhase2(world: World, g: GuardianState): void {
  g.phase = 2;
  g.path = [];
  g.repathIn = 0;
  setSignal(world, `${g.id}.phase2`, true);
}

function defeat(world: World, g: GuardianState): void {
  setMode(g, 'defeated');
  g.vel = { x: 0, z: 0 };
  g.path = [];
  setSignal(world, `${g.id}.defeated`, true);
  emit(world, 'guardian.defeated', g);
}

/** Its weight cracks crumbling floor under it, like Nora's steps do. */
function crackUnder(world: World, g: GuardianState): void {
  const [cx, cz] = cellOf(g.pos);
  if (!world.level.sector(cx, cz)?.flags.has('crumble')) return;
  const t = tileState(world, cx, cz);
  if (t.cracked === null && !t.fallen) {
    t.cracked = 0;
    world.events.emit({ type: 'tile.cracked', tick: world.tick, cx, cz });
  }
}

function chase(world: World, g: GuardianState, dt: number): void {
  const p = world.state.player;
  const ph = g.phase - 1;
  const speed = tun(g).speed[ph] ?? 1.5;
  const turn = tun(g).turnSpeed[ph] ?? 2;
  if (!noraInArena(world, g)) {
    // Nora left (or fell): back to the pedestal, then sleep.
    const d = Math.hypot(g.home.x - g.pos.x, g.home.z - g.pos.z);
    if (d < 0.2) {
      brake(g, dt, 6);
      turnTo(g, g.homeYaw, turn, dt);
      if (Math.abs(wrapAngle(g.homeYaw - g.yaw)) < 0.05) setMode(g, 'dormant');
      return;
    }
    if (g.repathIn <= 0) {
      g.repathIn = tun(g).repathTime;
      g.path = findPath(navOf(world, g), walkerOf(g), cellOf(g.pos), cellOf(g.home), tun(g).searchLimit).path;
    }
    steer(g, followPath(world, g, g.home), speed, turn, 0.05, dt);
    return;
  }
  if (g.repathIn <= 0) {
    g.repathIn = tun(g).repathTime;
    const res = findPath(navOf(world, g), walkerOf(g), cellOf(g.pos), cellOf(p.pos), tun(g).searchLimit);
    g.path = res.path;
    g.reachable = res.reached && p.mode !== 'hang' && p.mode !== 'climb';
  }
  const d = Math.hypot(p.pos.x - g.pos.x, p.pos.z - g.pos.z);
  const low = p.pos.y - g.pos.y <= tun(g).slamReach + 0.6;
  if (g.cooldown <= 0) {
    if (g.reachable && low && d <= tun(g).slamRange) {
      windup(world, g, false);
      return;
    }
    if (!g.reachable && g.path.length === 0 && d <= tun(g).poundRange) {
      windup(world, g, true);
      return;
    }
  }
  if (g.reachable) {
    const straight = walkable(navOf(world, g), walkerOf(g), g.pos.x, g.pos.z, g.pos.y, p.pos.x, p.pos.z);
    // Straight at her it stops short (the slam reaches); along a detour it walks each waypoint.
    if (straight) steer(g, p.pos, speed, turn, tun(g).slamRange * 0.8, dt);
    else steer(g, followPath(world, g, p.pos), speed, turn, 0.05, dt);
  } else if (g.path.length > 0) {
    steer(g, followPath(world, g, null), speed, turn, 0.05, dt);
  } else {
    // Below her refuge: turn to face her and wait for the chance to pound.
    brake(g, dt, 4);
    turnTo(g, yawTowards(g.pos, p.pos), turn, dt);
  }
}

function windup(world: World, g: GuardianState, pound: boolean): void {
  g.pound = pound;
  g.path = [];
  setMode(g, 'windup');
  emit(world, 'guardian.windup', g, { pound, phase: g.phase });
}

/** The blow: heavy damage around it, close and low; a jump clears the shockwave. */
function slam(world: World, g: GuardianState): void {
  const p = world.state.player;
  const dx = p.pos.x - g.pos.x;
  const dz = p.pos.z - g.pos.z;
  const d = Math.hypot(dx, dz);
  const dy = p.pos.y - g.pos.y;
  const hit = p.mode !== 'dead' && d <= tun(g).slamRadius && dy <= tun(g).slamReach && dy >= -1;
  setMode(g, 'recover');
  emit(world, 'guardian.slam', g, { hit, pound: g.pound, phase: g.phase });
  if (g.kind === 'giant' && g.phase === 2) breakFloor(world, g);
  if (!hit) return;
  damagePlayer(world, tun(g).slamDamage, 'guardian');
  if (world.state.player.mode === 'dead') return;
  const nx = d > EPS ? dx / d : -Math.sin(g.yaw);
  const nz = d > EPS ? dz / d : -Math.cos(g.yaw);
  knockback(world, nx * tun(g).slamPush, nz * tun(g).slamPush, tun(g).slamLift);
}

/**
 * Anzur's phase-2 slams break the floor a stride ahead of it: those cells crack
 * and fall after the usual warning, leaving pits. Only floor at its own
 * level (ledges above it hold); never under itself, never under the oculus,
 * lit or not yet (the way to stop it stays), never outside its hall.
 */
function breakFloor(world: World, g: GuardianState): void {
  const ix = g.pos.x - Math.sin(g.yaw) * giantFloor.ahead;
  const iz = g.pos.z - Math.cos(g.yaw) * giantFloor.ahead;
  const [icx, icz] = cellOf({ x: ix, z: iz });
  const [gcx, gcz] = cellOf(g.pos);
  const r = giantFloor.radius;
  for (let cx = icx - r; cx <= icx + r; cx++)
    for (let cz = icz - r; cz <= icz + r; cz++) {
      if (!inArena(g, cx, cz) || (cx === gcx && cz === gcz) || underOculus(world, cx, cz)) continue;
      const s = world.level.sector(cx, cz);
      // Only the floor it stands on: ledges above it (where Nora takes refuge) hold.
      if (!s || s.wall || s.pit || Math.abs(sectorTop(s) - g.pos.y) > 0.6) continue;
      const t = tileState(world, cx, cz);
      if (t.cracked !== null || t.fallen) continue;
      t.cracked = 0;
      world.events.emit({ type: 'tile.cracked', tick: world.tick, cx, cz });
    }
}

/**
 * Nora and its body: landing on its back from high enough while it recovers
 * breaks the core; any other landing is shrugged off; walking into it pushes
 * her back.
 */
function touchNora(world: World, g: GuardianState): void {
  const p = world.state.player;
  if (p.mode === 'dead' || g.mode === 'falling' || g.mode === 'fallen' || g.mode === 'climbing') return;
  const dx = p.pos.x - g.pos.x;
  const dz = p.pos.z - g.pos.z;
  const d = Math.hypot(dx, dz);
  const reach = tun(g).bodyRadius + tuning.radius;
  if (d >= reach) return;
  const nx = d > EPS ? dx / d : -Math.sin(g.yaw);
  const nz = d > EPS ? dz / d : -Math.cos(g.yaw);
  const exposed = g.mode === 'recover';
  const top = g.pos.y + (exposed ? tun(g).coreTop : tun(g).height);

  if (p.mode === 'air' && p.vel.y < 0 && p.pos.y <= top + 0.25 && p.pos.y >= top - 1) {
    if (g.kind !== 'giant' && exposed && p.fallFrom - (g.pos.y + tun(g).coreTop) >= tun(g).strikeDrop) {
      strike(world, g, nx, nz);
    } else {
      shove(world, g, nx, nz, reach - d);
      knockback(world, nx * tun(g).shrugPush, nz * tun(g).shrugPush, tun(g).shrugLift);
      emit(world, 'guardian.shrug', g);
    }
    return;
  }
  if (!SOLID_FOR.has(p.mode)) return;
  // Beside its body (not coming down on it from above, which the landing handles): pushed back.
  if (p.pos.y >= top - 1 || p.pos.y + tuning.height <= g.pos.y) return;
  shove(world, g, nx, nz, reach - d);
}

/** Pushes Nora out of its body along (nx, nz), against the grid. */
function shove(world: World, _g: GuardianState, nx: number, nz: number, by: number): void {
  const p = world.state.player;
  const res = sweep(
    world.grid,
    { x: p.pos.x, z: p.pos.z, y: p.pos.y, radius: tuning.radius, height: tuning.height },
    nx * by,
    nz * by,
    tuning.stepUp,
  );
  p.pos.x = res.x;
  p.pos.z = res.z;
}

/** The core breaks: Nora bounces off its back; it reels, cracked, or falls apart. */
function strike(world: World, g: GuardianState, nx: number, nz: number): void {
  knockback(world, nx * tun(g).bounceOut, nz * tun(g).bounceOut, tun(g).bounceUp);
  if (g.phase === 2) {
    emit(world, 'guardian.stunned', g, { phase: 2, core: true });
    defeat(world, g);
    return;
  }
  toPhase2(world, g);
  setMode(g, 'stunned');
  emit(world, 'guardian.stunned', g, { phase: 2, core: true });
}

// ─────────────────────────────────── Steering ───────────────────────────────────

const yawTowards = (from: { x: number; z: number }, to: { x: number; z: number }): number =>
  Math.atan2(-(to.x - from.x), -(to.z - from.z));

function turnTo(g: GuardianState, yaw: number, rate: number, dt: number): void {
  const d = wrapAngle(yaw - g.yaw);
  const m = rate * dt;
  g.yaw = wrapAngle(g.yaw + Math.max(-m, Math.min(m, d)));
}

function brake(g: GuardianState, dt: number, k: number): void {
  const f = Math.min(1, tun(g).accel * k * dt);
  g.vel.x -= g.vel.x * f;
  g.vel.z -= g.vel.z * f;
}

/** Heavy steering: it turns towards where it goes and only walks once it faces that way. */
function steer(
  g: GuardianState,
  target: { x: number; z: number },
  speed: number,
  turn: number,
  stop: number,
  dt: number,
): void {
  const dx = target.x - g.pos.x;
  const dz = target.z - g.pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= stop + EPS) {
    brake(g, dt, 4);
    return;
  }
  const want = Math.atan2(-dx, -dz);
  turnTo(g, want, turn, dt);
  const facing = Math.max(0, Math.cos(wrapAngle(want - g.yaw)));
  const v = speed * Math.min(1, (d - stop) / 0.6 + 0.2) * facing * facing;
  const k = Math.min(1, tun(g).accel * dt);
  g.vel.x += ((dx / d) * v - g.vel.x) * k;
  g.vel.z += ((dz / d) * v - g.vel.z) * k;
}

/** Next point along the path, looking ahead as far as it can walk straight. */
function followPath(
  world: World,
  g: GuardianState,
  fallback: { x: number; z: number } | null,
): { x: number; z: number } {
  const [cx, cz] = cellOf(g.pos);
  const reached = g.path.findIndex(([x, z]) => x === cx && z === cz);
  if (reached >= 0) g.path.splice(0, reached + 1);
  if (g.path.length === 0) return fallback ?? g.pos;
  const nav = navOf(world, g);
  for (let k = Math.min(g.path.length - 1, 4); k > 0; k--) {
    const c = g.path[k];
    if (!c) continue;
    const at = { x: cellCenter(c[0]), z: cellCenter(c[1]) };
    if (walkable(nav, walkerOf(g), g.pos.x, g.pos.z, g.pos.y, at.x, at.z)) return at;
  }
  const next = g.path[0] as [number, number];
  return { x: cellCenter(next[0]), z: cellCenter(next[1]) };
}

/** Moves the body with grid collision, inside its hall, one click up or down. */
function move(world: World, g: GuardianState, dt: number): void {
  const q = gridFor(world, g);
  const feet = g.pos.y;
  const nav = navOf(world, g);
  const before = { x: g.pos.x, z: g.pos.z };
  if (Math.abs(g.vel.x) + Math.abs(g.vel.z) > EPS) {
    const res = sweep(
      q,
      { x: g.pos.x, z: g.pos.z, y: feet, radius: tun(g).radius, height: tun(g).height },
      g.vel.x * dt,
      g.vel.z * dt,
      tun(g).climb + 0.05,
      (cx, cz) => q.cellFloor(cx, cz) >= feet - tun(g).maxDrop - 1e-3 && !nav.forbidden(cx, cz),
    );
    if (res.hitX) g.vel.x = 0;
    if (res.hitZ) g.vel.z = 0;
    g.pos.x = res.x;
    g.pos.z = res.z;
  }
  const floor = q.floorAt(g.pos.x, g.pos.z);
  if (Number.isFinite(floor) && floor >= feet - tun(g).maxDrop - 1e-3) g.pos.y = floor;
  const [cx, cz] = cellOf(g.pos);
  const s = world.level.sector(cx, cz);
  if (s && !s.pit && !s.flags.has('crumble') && !isTrapdoorCell(world, cx, cz)) g.ground = [cx, cz];

  const walked = Math.hypot(g.pos.x - before.x, g.pos.z - before.z);
  g.stride += walked;
  if (g.stride >= tun(g).stride) {
    g.stride = 0;
    emit(world, 'guardian.step', g, { phase: g.phase });
  }
}

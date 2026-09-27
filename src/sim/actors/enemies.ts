/**
 * Enemies (spec §7 "Enemigos" and "Comportamiento"). Stats are data
 * (enemyTypes in player/tuning.ts) and the behaviour comes from a closed
 * list. Perception is by distance, height and line of sight, and by noise;
 * navigation is A* on the sector grid (./pathfind); bodies collide with the
 * grid like the player and lightly with each other.
 *
 * States: idle → alert → chase ⇄ attack, hurt (stagger), flee (giving up
 * and heading home) and dead. A high place is a valid refuge: an enemy that
 * cannot reach Nora prowls below and leaves after `refugeTime`.
 */
import { raycast, supportHeight, sweep } from '../grid/collision';
import type { Level } from '../grid/level';
import { BLOCK, DIR_YAW, cellCenter, wrapAngle } from '../grid/units';
import { setSignal } from '../logic/rules';
import { damagePlayer } from '../player/context';
import { enemyTypes, noise, tuning, weapons, type EnemyStats } from '../player/tuning';
import type { EnemyMode, EnemyState, Vec3 } from '../state';
import type { World } from '../world';
import { findPath, walkable, type NavGrid, type Walker } from './pathfind';
import { waterDepth } from './water';

const EPS = 1e-6;

export const statsOf = (e: EnemyState): EnemyStats => enemyTypes[e.type];

const walkerOf = (s: EnemyStats): Walker => ({
  climb: s.climb,
  maxDrop: s.maxDrop,
  height: s.height,
  radius: s.radius,
});

function navOf(world: World): NavGrid {
  return {
    q: world.grid,
    // Jackals do not swim: water over their backs is as good as a wall.
    forbidden: (cx, cz) =>
      world.level.sector(cx, cz)?.flags.has('death') === true || waterDepth(world, cx, cz) > 0.5,
  };
}

function emit(world: World, type: string, e: EnemyState, data: Record<string, unknown> = {}): void {
  world.events.emit({ type, tick: world.tick, id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z, ...data });
}

function setMode(e: EnemyState, mode: EnemyMode): void {
  e.mode = mode;
  e.modeTime = 0;
}

// ───────────────────────────── Creation and reset ─────────────────────────────

export function createEnemies(level: Level): EnemyState[] {
  const out: EnemyState[] = [];
  const slots = new Map<string, number>();
  for (const ent of level.entities) {
    if (ent.type !== 'enemy') continue;
    const x = cellCenter(ent.at[0]);
    const z = cellCenter(ent.at[1]);
    const home = { x, y: level.floorAt(x, z), z };
    const slot = ent.pack ? (slots.get(ent.pack) ?? 0) : 0;
    if (ent.pack) slots.set(ent.pack, slot + 1);
    const e: EnemyState = {
      id: ent.id,
      type: ent.enemy,
      pack: ent.pack ?? null,
      slot,
      home,
      homeYaw: DIR_YAW[ent.face],
      pos: { ...home },
      vel: { x: 0, z: 0 },
      yaw: 0,
      health: 0,
      mode: 'idle',
      modeTime: 0,
      resume: 'idle',
      sinceStagger: 0,
      aware: false,
      path: [],
      repathIn: 0,
      reachable: false,
      outOfReach: 0,
      calm: 0,
      biteIn: 0,
    };
    resetEnemy(e);
    out.push(e);
  }
  return out;
}

/** Back to the start position, full health, unaware of Nora. */
export function resetEnemy(e: EnemyState): void {
  e.pos = { ...e.home };
  e.vel = { x: 0, z: 0 };
  e.yaw = e.homeYaw;
  e.health = statsOf(e).health;
  setMode(e, 'idle');
  e.resume = 'idle';
  e.sinceStagger = statsOf(e).staggerCooldown;
  e.aware = false;
  e.path = [];
  e.repathIn = 0;
  e.reachable = false;
  e.outOfReach = 0;
  e.calm = 0;
  e.biteIn = 0;
}

/** On respawn at a checkpoint, living enemies return to their start and forget Nora (spec §7). */
export function resetEnemies(world: World): void {
  for (const e of world.state.enemies) if (e.mode !== 'dead') resetEnemy(e);
}

export function findEnemy(world: World, id: string): EnemyState | undefined {
  return world.state.enemies.find((e) => e.id === id);
}

// ───────────────────────────────── Perception ─────────────────────────────────

/** True when nothing solid lies on the segment. */
export function clearLine(world: World, a: Vec3, b: Vec3): boolean {
  return raycast(world.grid, a, b, 0.1) >= 1;
}

/** Centre of an enemy's body (what Nora aims at). */
export function enemyCenter(e: EnemyState): Vec3 {
  return { x: e.pos.x, y: e.pos.y + statsOf(e).height * 0.5, z: e.pos.z };
}

/** Sight: within range, within the height band and with a clear line of sight. */
export function seesNora(world: World, e: EnemyState): boolean {
  const p = world.state.player;
  if (p.mode === 'dead' || e.mode === 'dead') return false;
  const s = statsOf(e);
  if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) > s.sightRange) return false;
  if (Math.abs(p.pos.y - e.pos.y) > s.sightHeight) return false;
  return clearLine(
    world,
    { x: e.pos.x, y: e.pos.y + s.eyeHeight, z: e.pos.z },
    { x: p.pos.x, y: p.pos.y + weapons.chestHeight, z: p.pos.z },
  );
}

/** Makes an enemy hunt Nora; its pack mates join in. */
export function alertEnemy(world: World, e: EnemyState, cause: 'sight' | 'noise' | 'pack' | 'hit'): void {
  if (e.mode === 'dead' || e.aware) return;
  e.aware = true;
  e.calm = 0;
  e.outOfReach = 0;
  e.repathIn = 0;
  if (e.mode !== 'hurt') setMode(e, 'alert');
  emit(world, 'enemy.alerted', e, { cause });
  if (!e.pack) return;
  for (const o of world.state.enemies) if (o !== e && o.pack === e.pack) alertEnemy(world, o, 'pack');
}

/** A noise at `at` alerts every enemy within `radius` metres (running 6, shots 14, tiles 10). */
export function makeNoise(world: World, at: { x: number; z: number }, radius: number): void {
  for (const e of world.state.enemies) {
    if (e.mode === 'dead' || e.aware) continue;
    if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) <= radius) alertEnemy(world, e, 'noise');
  }
}

// ─────────────────────────────────── Damage ───────────────────────────────────

export function damageEnemy(world: World, e: EnemyState, amount: number): void {
  if (e.mode === 'dead' || amount <= 0) return;
  e.health = Math.max(0, e.health - amount);
  emit(world, 'enemy.hit', e, { health: e.health, amount });
  if (e.health === 0) {
    kill(world, e);
    return;
  }
  if (!e.aware) alertEnemy(world, e, 'hit');
  const s = statsOf(e);
  if (e.mode === 'hurt' || e.sinceStagger < s.staggerCooldown) return;
  e.resume = e.mode === 'attack' ? 'attack' : 'chase';
  e.sinceStagger = 0;
  setMode(e, 'hurt');
}

function kill(world: World, e: EnemyState): void {
  setMode(e, 'dead');
  e.aware = false;
  e.path = [];
  world.stats.kills++;
  setSignal(world, `${e.id}.dead`, true);
  emit(world, 'enemy.died', e);
}

// ─────────────────────────────────── Update ───────────────────────────────────

export function updateEnemies(world: World, dt: number): void {
  const enemies = world.state.enemies;
  if (enemies.length === 0) return;
  const p = world.state.player;
  if (p.mode === 'ground' && Math.hypot(p.vel.x, p.vel.z) > noise.runSpeed)
    makeNoise(world, p.pos, noise.run);
  for (const e of enemies) updateEnemy(world, e, dt);
  separate(world);
}

function updateEnemy(world: World, e: EnemyState, dt: number): void {
  const s = statsOf(e);
  e.modeTime += dt;
  e.sinceStagger += dt;
  e.repathIn = Math.max(0, e.repathIn - dt);
  e.calm = Math.max(0, e.calm - dt);
  const p = world.state.player;

  if (e.mode === 'dead') {
    brake(e, s, dt, 6);
    move(world, e, s, dt);
    return;
  }
  if (p.mode === 'dead' && e.aware) {
    // Nora is down: the hunt is over until she respawns.
    e.aware = false;
    e.path = [];
    setMode(e, 'idle');
  }

  switch (e.mode) {
    case 'idle':
    case 'flee':
      calmBehaviour(world, e, s, dt);
      break;
    case 'alert':
      brake(e, s, dt, 1);
      turnTo(e, yawTowards(e.pos, p.pos), s.turnSpeed * 0.7, dt);
      if (e.modeTime >= s.alertTime) setMode(e, 'chase');
      break;
    case 'hurt':
      brake(e, s, dt, 3);
      if (e.modeTime >= s.hurtTime) setMode(e, e.resume);
      break;
    case 'chase':
      chase(world, e, s, dt);
      break;
    case 'attack':
      attack(world, e, s, dt);
      break;
  }
  move(world, e, s, dt);
}

/** Idle at home, or walking back home after giving up. Sight may alert it. */
function calmBehaviour(world: World, e: EnemyState, s: EnemyStats, dt: number): void {
  if (seesNora(world, e)) {
    // Right after giving up, only a Nora it can reach brings it back.
    if (e.calm <= 0) {
      alertEnemy(world, e, 'sight');
      return;
    }
    if (e.repathIn <= 0) {
      e.repathIn = s.repathTime;
      e.reachable = searchNora(world, e, s).reached;
    }
    if (e.reachable) {
      alertEnemy(world, e, 'sight');
      return;
    }
  }
  if (e.mode === 'idle') {
    brake(e, s, dt, 1);
    turnTo(e, e.homeYaw, s.turnSpeed * 0.3, dt);
    return;
  }
  // Leaving: head home, then rest.
  const d = Math.hypot(e.home.x - e.pos.x, e.home.z - e.pos.z);
  if (d < 0.3) {
    setMode(e, 'idle');
    return;
  }
  if (e.path.length === 0 && e.repathIn <= 0) {
    e.repathIn = s.repathTime;
    e.path = findPath(navOf(world), walkerOf(s), cellOfPos(e.pos), cellOfPos(e.home), s.searchLimit).path;
  }
  const target = followPath(world, e, s, e.home);
  steer(e, s, target, s.trotSpeed, 0.05, dt);
}

function searchNora(
  world: World,
  e: EnemyState,
  s: EnemyStats,
): { reached: boolean; path: [number, number][] } {
  const p = world.state.player;
  const res = findPath(navOf(world), walkerOf(s), cellOfPos(e.pos), cellOfPos(p.pos), s.searchLimit);
  // Hanging from a wall is out of reach even when the cell below is not.
  return { reached: res.reached && p.mode !== 'hang', path: res.path };
}

function chase(world: World, e: EnemyState, s: EnemyStats, dt: number): void {
  const p = world.state.player;
  if (e.repathIn <= 0) {
    e.repathIn = s.repathTime;
    const res = searchNora(world, e, s);
    e.path = res.path;
    e.reachable = res.reached;
  }
  if (e.reachable) {
    e.outOfReach = 0;
  } else {
    e.outOfReach += dt;
    if (e.outOfReach >= s.refugeTime) {
      giveUp(world, e, s);
      return;
    }
  }
  if (inBiteRange(e, s, p.pos)) {
    setMode(e, 'attack');
    e.biteIn = s.bite.windup;
    brake(e, s, dt, 2);
    return;
  }
  if (e.reachable) {
    const target = approachPoint(world, e, s);
    steer(e, s, target, s.runSpeed, s.bite.range * 0.7, dt);
  } else {
    // Prowl below the refuge: pace at the closest reachable spot, watching her.
    const end = e.path.length > 0 ? followPath(world, e, s, null) : pacePoint(e, s, p.pos);
    steer(e, s, end, s.trotSpeed, 0.1, dt);
    if (Math.hypot(e.vel.x, e.vel.z) < 0.6) turnTo(e, yawTowards(e.pos, p.pos), s.turnSpeed * 0.5, dt);
  }
}

function attack(world: World, e: EnemyState, s: EnemyStats, dt: number): void {
  const p = world.state.player;
  const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
  if (!heightOk(e, s, p.pos) || d > s.bite.range + 0.35) {
    setMode(e, 'chase');
    e.repathIn = 0;
    return;
  }
  // Keep pressing in, facing her.
  if (d > s.bite.range * 0.75) steer(e, s, p.pos, s.runSpeed, s.bite.range * 0.6, dt);
  else brake(e, s, dt, 2);
  turnTo(e, yawTowards(e.pos, p.pos), s.turnSpeed, dt);
  e.biteIn -= dt;
  if (e.biteIn <= EPS) {
    const hit = inBiteRange(e, s, p.pos);
    emit(world, 'enemy.bite', e, { hit });
    if (hit) damagePlayer(world, s.bite.damage, e.type);
    e.biteIn += s.bite.interval;
  }
}

function giveUp(world: World, e: EnemyState, s: EnemyStats): void {
  e.aware = false;
  e.calm = s.calmTime;
  e.outOfReach = 0;
  e.path = [];
  e.repathIn = 0;
  setMode(e, 'flee');
  emit(world, 'enemy.gaveUp', e);
}

function heightOk(e: EnemyState, s: EnemyStats, at: Vec3): boolean {
  const dy = at.y - e.pos.y;
  return dy <= s.bite.reachUp + EPS && dy >= -s.maxDrop - 0.2;
}

function inBiteRange(e: EnemyState, s: EnemyStats, at: Vec3): boolean {
  return heightOk(e, s, at) && Math.hypot(at.x - e.pos.x, at.z - e.pos.z) <= s.bite.range + EPS;
}

// ─────────────────────────────────── Steering ───────────────────────────────────

const cellOfPos = (v: { x: number; z: number }): [number, number] => [
  Math.floor(v.x / BLOCK),
  Math.floor(v.z / BLOCK),
];

const yawTowards = (from: { x: number; z: number }, to: { x: number; z: number }): number =>
  Math.atan2(-(to.x - from.x), -(to.z - from.z));

function turnTo(e: EnemyState, yaw: number, rate: number, dt: number): void {
  const d = wrapAngle(yaw - e.yaw);
  const m = rate * dt;
  e.yaw = wrapAngle(e.yaw + Math.max(-m, Math.min(m, d)));
}

function brake(e: EnemyState, s: EnemyStats, dt: number, k: number): void {
  const f = Math.min(1, s.accel * k * dt);
  e.vel.x -= e.vel.x * f;
  e.vel.z -= e.vel.z * f;
}

/** Accelerates towards `target`, arriving at `stop` metres from it, facing where it goes. */
function steer(
  e: EnemyState,
  s: EnemyStats,
  target: { x: number; z: number },
  speed: number,
  stop: number,
  dt: number,
): void {
  const dx = target.x - e.pos.x;
  const dz = target.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  const want = d > stop ? speed * Math.min(1, (d - stop) / 0.5 + 0.15) : 0;
  const vx = d > EPS ? (dx / d) * want : 0;
  const vz = d > EPS ? (dz / d) * want : 0;
  const k = Math.min(1, s.accel * dt);
  e.vel.x += (vx - e.vel.x) * k;
  e.vel.z += (vz - e.vel.z) * k;
  if (Math.hypot(e.vel.x, e.vel.z) > 0.3) turnTo(e, Math.atan2(-e.vel.x, -e.vel.z), s.turnSpeed, dt);
}

/**
 * Where to run while Nora is reachable: straight at her when the way is
 * clear, otherwise along the path. Pack mates spread to her sides while
 * still far, so a pair closes in from two directions.
 */
function approachPoint(world: World, e: EnemyState, s: EnemyStats): { x: number; z: number } {
  const p = world.state.player.pos;
  const nav = navOf(world);
  const w = walkerOf(s);
  if (!walkable(nav, w, e.pos.x, e.pos.z, e.pos.y, p.x, p.z)) return followPath(world, e, s, p);
  const dx = e.pos.x - p.x;
  const dz = e.pos.z - p.z;
  const d = Math.hypot(dx, dz);
  const mates = e.pack
    ? world.state.enemies.filter((o) => o.pack === e.pack && o.mode !== 'dead' && o.aware).length
    : 0;
  if (mates < 2 || d < s.flankUntil) return p;
  const side = e.slot % 2 === 0 ? 1 : -1;
  const k = s.flankDistance * Math.min(1, (d - s.flankUntil) / 3);
  const flank = { x: p.x + (-dz / d) * side * k, z: p.z + (dx / d) * side * k };
  return walkable(nav, w, e.pos.x, e.pos.z, e.pos.y, flank.x, flank.z) ? flank : p;
}

/**
 * Next point along the path: drops cells already reached and looks ahead to
 * the furthest cell it can walk to in a straight line. With no path left it
 * heads for `fallback` (or stays put).
 */
function followPath(
  world: World,
  e: EnemyState,
  s: EnemyStats,
  fallback: { x: number; z: number } | null,
): { x: number; z: number } {
  const [cx, cz] = cellOfPos(e.pos);
  const reachedIdx = e.path.findIndex(([x, z]) => x === cx && z === cz);
  if (reachedIdx >= 0) e.path.splice(0, reachedIdx + 1);
  if (e.path.length === 0) return fallback ?? e.pos;
  const nav = navOf(world);
  const w = walkerOf(s);
  for (let k = Math.min(e.path.length - 1, 5); k > 0; k--) {
    const c = e.path[k];
    if (!c) continue;
    const at = { x: cellCenter(c[0]), z: cellCenter(c[1]) };
    if (walkable(nav, w, e.pos.x, e.pos.z, e.pos.y, at.x, at.z)) return at;
  }
  const next = e.path[0] as [number, number];
  return { x: cellCenter(next[0]), z: cellCenter(next[1]) };
}

/** Pacing to and fro right below Nora: the point of its cell nearest to her, swinging across. */
function pacePoint(e: EnemyState, s: EnemyStats, nora: Vec3): { x: number; z: number } {
  const [cx, cz] = cellOfPos(e.pos);
  const r = s.radius + 0.02;
  const clampTo = (v: number, c: number): number => Math.min(Math.max(v, c * BLOCK + r), (c + 1) * BLOCK - r);
  const x = clampTo(nora.x, cx);
  const z = clampTo(nora.z, cz);
  const dx = nora.x - cellCenter(cx);
  const dz = nora.z - cellCenter(cz);
  const d = Math.hypot(dx, dz) || 1;
  const swing = Math.sin(e.modeTime * s.prowlRate + e.slot * 2) * s.prowlSwing;
  return { x: clampTo(x + (-dz / d) * swing, cx), z: clampTo(z + (dx / d) * swing, cz) };
}

/** Moves the body with grid collision; it steps up one click at most and never drops more than maxDrop. */
function move(world: World, e: EnemyState, s: EnemyStats, dt: number): void {
  const q = world.grid;
  const feet = e.pos.y;
  if (Math.abs(e.vel.x) + Math.abs(e.vel.z) > EPS) {
    const res = sweep(
      q,
      { x: e.pos.x, z: e.pos.z, y: feet, radius: s.radius, height: s.height },
      e.vel.x * dt,
      e.vel.z * dt,
      s.climb + 0.05,
      (cx, cz) =>
        q.cellFloor(cx, cz) >= feet - s.maxDrop - 1e-3 && !world.level.sector(cx, cz)?.flags.has('death'),
    );
    if (res.hitX) e.vel.x = 0;
    if (res.hitZ) e.vel.z = 0;
    e.pos.x = res.x;
    e.pos.z = res.z;
  }
  const support = Math.max(q.floorAt(e.pos.x, e.pos.z), supportHeight(q, e.pos.x, e.pos.z, 0.05));
  if (!Number.isFinite(support)) return;
  e.pos.y = support >= feet ? support : Math.max(support, feet - s.dropSpeed * dt);
}

/** Light body collision: enemies push each other apart and never overlap Nora. */
function separate(world: World): void {
  const list = world.state.enemies.filter((e) => e.mode !== 'dead');
  const q = world.grid;
  const shove = (e: EnemyState, dx: number, dz: number): void => {
    const s = statsOf(e);
    const res = sweep(
      q,
      { x: e.pos.x, z: e.pos.z, y: e.pos.y, radius: s.radius, height: s.height },
      dx,
      dz,
      s.climb + 0.05,
      (cx, cz) =>
        q.cellFloor(cx, cz) >= e.pos.y - s.maxDrop - 1e-3 && !world.level.sector(cx, cz)?.flags.has('death'),
    );
    e.pos.x = res.x;
    e.pos.z = res.z;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as EnemyState;
      const b = list[j] as EnemyState;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const min = statsOf(a).radius + statsOf(b).radius;
      if (d >= min || Math.abs(a.pos.y - b.pos.y) > 1) continue;
      const nx = d > EPS ? dx / d : 1;
      const nz = d > EPS ? dz / d : 0;
      const push = (min - d) * 0.25;
      shove(a, -nx * push, -nz * push);
      shove(b, nx * push, nz * push);
    }
  }
  const p = world.state.player;
  if (p.mode === 'dead') return;
  for (const e of list) {
    const dx = e.pos.x - p.pos.x;
    const dz = e.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const min = tuning.radius + statsOf(e).radius + 0.05;
    if (d >= min || Math.abs(e.pos.y - p.pos.y) > 1) continue;
    const nx = d > EPS ? dx / d : Math.sin(e.yaw);
    const nz = d > EPS ? dz / d : Math.cos(e.yaw);
    shove(e, nx * (min - d), nz * (min - d));
  }
}

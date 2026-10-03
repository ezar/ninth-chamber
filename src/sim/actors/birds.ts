/**
 * The Wind Stair's rock birds (spec §19, chamber VII): the 'flyer' behaviour.
 * A bird perches on its nest until it sees Nora, screeches as it rises, then
 * dives at her chest and shoves her (a little damage, and a push that can
 * knock her off a ledge or tear her from one) instead of biting, climbs
 * away, and dives again. Flight is free in three dimensions, kept clear of
 * walls, floors and ceilings; no pathfinding. Shot down, it falls.
 */
import { sweep } from '../grid/collision';
import { BLOCK } from '../grid/units';
import { damagePlayer, setMode as setPlayerMode } from '../player/context';
import { birds, tuning, weapons, type EnemyStats } from '../player/tuning';
import type { EnemyMode, EnemyState } from '../state';
import type { World } from '../world';

function emit(world: World, type: string, e: EnemyState, data: Record<string, unknown> = {}): void {
  world.events.emit({
    type,
    tick: world.tick,
    id: e.id,
    enemy: e.type,
    x: e.pos.x,
    y: e.pos.y,
    z: e.pos.z,
    ...data,
  });
}

function setMode(e: EnemyState, mode: EnemyMode): void {
  e.mode = mode;
  e.modeTime = 0;
}

const yawTowards = (from: { x: number; z: number }, to: { x: number; z: number }): number =>
  Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** Free space at a point: not in a wall or a closed door, between floor and ceiling. */
function openAt(world: World, x: number, y: number, z: number): boolean {
  const cx = Math.floor(x / BLOCK);
  const cz = Math.floor(z / BLOCK);
  const floor = world.grid.cellFloor(cx, cz);
  if (!Number.isFinite(floor)) return false;
  return y >= floor && y <= world.grid.cellCeil(cx, cz);
}

/** Steers its velocity towards `target` at `speed` (3D). */
function fly(
  e: EnemyState,
  s: EnemyStats,
  target: { x: number; y: number; z: number },
  speed: number,
  dt: number,
): void {
  const dx = target.x - e.pos.x;
  const dy = target.y - e.pos.y;
  const dz = target.z - e.pos.z;
  const d = Math.hypot(dx, dy, dz);
  // Slow down into a hover near the target.
  const v = d > 1e-6 ? Math.min(speed, d * 3) / d : 0;
  const k = Math.min(1, s.accel * dt);
  e.vel.x += (dx * v - e.vel.x) * k;
  e.vel.z += (dz * v - e.vel.z) * k;
  e.vy = (e.vy ?? 0) + (dy * v - (e.vy ?? 0)) * k;
  if (Math.hypot(e.vel.x, e.vel.z) > 0.3) {
    const yaw = yawTowards(e.pos, { x: e.pos.x + e.vel.x, z: e.pos.z + e.vel.z });
    const diff = Math.atan2(Math.sin(yaw - e.yaw), Math.cos(yaw - e.yaw));
    e.yaw += Math.max(-s.turnSpeed * dt, Math.min(s.turnSpeed * dt, diff));
  }
}

/** Moves it by its velocity, axis by axis, never into a wall, floor or ceiling. */
function move(world: World, e: EnemyState, s: EnemyStats, dt: number): void {
  const c = birds.clearance;
  const nx = e.pos.x + e.vel.x * dt;
  if (openAt(world, nx + Math.sign(e.vel.x) * c, e.pos.y, e.pos.z)) e.pos.x = nx;
  else e.vel.x = 0;
  const nz = e.pos.z + e.vel.z * dt;
  if (openAt(world, e.pos.x, e.pos.y, nz + Math.sign(e.vel.z) * c)) e.pos.z = nz;
  else e.vel.z = 0;
  const cx = Math.floor(e.pos.x / BLOCK);
  const cz = Math.floor(e.pos.z / BLOCK);
  const floor = world.grid.floorAt(e.pos.x, e.pos.z);
  const ceil = world.grid.cellCeil(cx, cz);
  const ny = e.pos.y + (e.vy ?? 0) * dt;
  e.pos.y = Math.min(ceil - c - s.height, Math.max(floor, ny));
  if (e.pos.y !== ny) e.vy = 0;
}

/** Nora's chest: what it dives at (its own centre at her chest). */
const chest = (world: World, s: EnemyStats): { x: number; y: number; z: number } => {
  const p = world.state.player.pos;
  return { x: p.x, y: p.y + weapons.chestHeight - s.height / 2, z: p.z };
};

/** The shove: a little damage and a push along its dive that ignores edges. */
function shove(world: World, e: EnemyState, s: EnemyStats): void {
  const p = world.state.player;
  const h = Math.hypot(e.vel.x, e.vel.z);
  const dx = h > 0.3 ? e.vel.x / h : -Math.sin(e.yaw);
  const dz = h > 0.3 ? e.vel.z / h : -Math.cos(e.yaw);
  emit(world, 'enemy.shove', e, { hit: true });
  if (p.mode === 'hang' || p.mode === 'rope') {
    // Knocked off the ledge or the rope.
    p.vel = { x: dx * 1.5, y: 0, z: dz * 1.5 };
    p.airSpeedCap = tuning.airControlMinCap;
    p.fallFrom = p.pos.y;
    p.sinceRelease = 0;
    p.jumped = false;
    p.ledge = null;
    p.target = null;
    setPlayerMode(p, 'air');
    world.events.emit({ type: 'player.torn', tick: world.tick });
  } else if (p.mode === 'ground' || p.mode === 'air') {
    const res = sweep(
      world.grid,
      { x: p.pos.x, z: p.pos.z, y: p.pos.y, radius: tuning.radius, height: tuning.height },
      dx * birds.shove,
      dz * birds.shove,
      tuning.stepUp,
    );
    p.pos.x = res.x;
    p.pos.z = res.z;
  }
  damagePlayer(world, s.bite.damage, 'bird');
}

/** One tick of a flyer. The caller has advanced its timers and says whether it sees Nora. */
export function updateBird(world: World, e: EnemyState, s: EnemyStats, sees: boolean, dt: number): void {
  const p = world.state.player;
  if (e.mode === 'dead') {
    // Shot down: it tumbles to the floor.
    e.vel.x *= Math.max(0, 1 - 2 * dt);
    e.vel.z *= Math.max(0, 1 - 2 * dt);
    e.vy = (e.vy ?? 0) - birds.gravity * dt;
    move(world, e, s, dt);
    return;
  }
  if (p.mode === 'dead' && e.aware) {
    e.aware = false;
    setMode(e, 'flee');
  }
  switch (e.mode) {
    case 'idle': {
      // Perched on the nest.
      e.vel = { x: 0, z: 0 };
      e.vy = 0;
      e.pos = { ...e.home };
      if (e.calm <= 0 && sees) {
        e.aware = true;
        setMode(e, 'alert');
        emit(world, 'enemy.alerted', e, { cause: 'sight' });
      }
      return;
    }
    case 'alert':
      // Rises over the nest, screeching, facing her.
      fly(e, s, { x: e.home.x, y: e.home.y + birds.hover, z: e.home.z }, s.trotSpeed, dt);
      e.yaw = yawTowards(e.pos, p.pos);
      if (e.modeTime >= s.alertTime) setMode(e, 'chase');
      break;
    case 'chase': {
      const target = chest(world, s);
      fly(e, s, target, s.runSpeed, dt);
      const d = Math.hypot(target.x - e.pos.x, target.y - e.pos.y, target.z - e.pos.z);
      if (d <= s.bite.range) {
        shove(world, e, s);
        setMode(e, 'attack');
      }
      break;
    }
    case 'attack': {
      // Climbs away after a shove, then dives again.
      const target = chest(world, s);
      const away = Math.hypot(e.pos.x - target.x, e.pos.z - target.z) > 1e-3;
      const ax = away ? (e.pos.x - target.x) / Math.hypot(e.pos.x - target.x, e.pos.z - target.z) : 0;
      const az = away ? (e.pos.z - target.z) / Math.hypot(e.pos.x - target.x, e.pos.z - target.z) : 1;
      fly(
        e,
        s,
        { x: target.x + ax * 3, y: target.y + birds.retreatHeight, z: target.z + az * 3 },
        s.trotSpeed * 1.5,
        dt,
      );
      if (e.modeTime >= birds.retreat) setMode(e, p.mode === 'dead' ? 'flee' : 'chase');
      break;
    }
    case 'hurt':
      e.vel.x *= Math.max(0, 1 - 4 * dt);
      e.vel.z *= Math.max(0, 1 - 4 * dt);
      e.vy = (e.vy ?? 0) * Math.max(0, 1 - 4 * dt) - 2 * dt;
      if (e.modeTime >= s.hurtTime) setMode(e, 'attack');
      break;
    case 'flee': {
      // Back to the nest.
      fly(e, s, e.home, s.trotSpeed, dt);
      if (Math.hypot(e.pos.x - e.home.x, e.pos.y - e.home.y, e.pos.z - e.home.z) < 0.15) {
        e.calm = s.calmTime;
        setMode(e, 'idle');
      }
      break;
    }
  }
  move(world, e, s, dt);
}

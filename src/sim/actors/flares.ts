/**
 * Burning flares in the world (spec §7 "Bengalas"): held in Nora's hand or
 * thrown, they fly, bounce and come to rest on the grid, sink slowly in
 * water (they keep burning), light cold braziers they come close to, and go
 * out after `flares.life` seconds. Flare packs on the floor are picked up by
 * walking or swimming over them.
 */
import { BLOCK, yawVec } from '../grid/units';
import { setSignal } from '../logic/rules';
import { flares, swimming } from '../player/tuning';
import type { FlareState, PlayerState, Vec3 } from '../state';
import type { World } from '../world';
import { wetSurfaceAt } from './water';

/** Where Nora holds a lit flare (m, world space). */
export function flareHand(p: PlayerState): Vec3 {
  const f = yawVec(p.yaw);
  const r = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
  const h = flares.hand;
  let up = h.up;
  // Swimming she holds it up out of the water; diving, ahead of her chest.
  if (p.mode === 'swim') up = swimming.surfaceSink + 0.25;
  else if (p.mode === 'dive') up = (swimming.bodyLow + swimming.bodyHigh) / 2;
  else if (p.mode === 'hang') up = 1.4;
  return {
    x: p.pos.x + r.x * h.right + f.x * h.forward,
    y: p.pos.y + up,
    z: p.pos.z + r.z * h.right + f.z * h.forward,
  };
}

export const heldFlare = (world: World): FlareState | undefined => world.state.flares.find((f) => f.held);

function putOut(world: World, f: FlareState): void {
  world.state.flares = world.state.flares.filter((x) => x !== f);
  world.events.emit({ type: 'flare.out', tick: world.tick, id: f.id, x: f.x, y: f.y, z: f.z });
}

/** Makes room for one more flare: the oldest one lying on the ground goes out. */
export function capFlares(world: World): void {
  while (world.state.flares.length >= flares.max) {
    const oldest = world.state.flares.filter((f) => !f.held).sort((a, b) => b.age - a.age)[0];
    if (!oldest) return;
    putOut(world, oldest);
  }
}

function fly(world: World, f: FlareState, dt: number): void {
  const q = world.grid;
  const water = wetSurfaceAt(world, f.x, f.z);
  if (water !== null && f.y < water) {
    const k = Math.exp(-flares.waterDrag * dt);
    f.vx *= k;
    f.vz *= k;
    f.vy += (-flares.sinkSpeed - f.vy) * Math.min(1, flares.waterDrag * dt);
  } else {
    f.vy -= flares.gravity * dt;
  }
  // Walls (and steps higher than the flare) turn it back.
  const nx = f.x + f.vx * dt;
  if (q.floorAt(nx, f.z) > f.y + 0.02) f.vx = -f.vx * 0.35;
  else f.x = nx;
  const nz = f.z + f.vz * dt;
  if (q.floorAt(f.x, nz) > f.y + 0.02) f.vz = -f.vz * 0.35;
  else f.z = nz;
  let ny = f.y + f.vy * dt;
  const ceil = q.cellCeil(Math.floor(f.x / BLOCK), Math.floor(f.z / BLOCK));
  if (ny > ceil - 0.05) {
    ny = ceil - 0.05;
    f.vy = Math.min(0, f.vy);
  }
  const floor = q.floorAt(f.x, f.z);
  if (ny <= floor) {
    ny = floor;
    f.vy = f.vy < -2 ? -f.vy * flares.bounce : 0;
    const k = Math.exp(-flares.friction * dt);
    f.vx *= k;
    f.vz *= k;
    if (Math.hypot(f.vx, f.vz) < 0.05) f.vx = f.vz = 0;
  }
  f.y = ny;
}

export function updateFlares(world: World, dt: number): void {
  const { state } = world;
  const p = state.player;
  for (const f of [...state.flares]) {
    f.age += dt;
    if (f.age >= flares.life) {
      putOut(world, f);
      continue;
    }
    if (f.held) {
      const h = flareHand(p);
      f.x = h.x;
      f.y = h.y;
      f.z = h.z;
      f.vx = p.vel.x;
      f.vy = p.vel.y;
      f.vz = p.vel.z;
    } else {
      fly(world, f, dt);
    }
  }

  const pcx = Math.floor(p.pos.x / BLOCK);
  const pcz = Math.floor(p.pos.z / BLOCK);
  for (const a of state.actors) {
    if (a.kind === 'brazier' && !a.lit) {
      const bx = a.cx * BLOCK + BLOCK / 2;
      const bz = a.cz * BLOCK + BLOCK / 2;
      const by = world.level.floorAt(bx, bz) + flares.brazierBowl;
      const near = state.flares.some((f) => Math.hypot(f.x - bx, f.y - by, f.z - bz) <= flares.igniteRange);
      if (near) {
        a.lit = true;
        setSignal(world, `${a.id}.lit`, true);
        world.events.emit({ type: 'brazier.lit', tick: world.tick, id: a.id });
      }
    } else if (a.kind === 'flares' && !a.taken && a.cx === pcx && a.cz === pcz) {
      const reach = p.mode === 'ground' || p.mode === 'swim' || (p.mode === 'dive' && nearFloor(world, p));
      if (!reach) continue;
      a.taken = true;
      state.inventory.flare = (state.inventory.flare ?? 0) + a.count;
      setSignal(world, `${a.id}.taken`, true);
      world.events.emit({ type: 'pickup', tick: world.tick, id: a.id, kind: 'flares', count: a.count });
    }
  }
}

/** A diver close enough to the floor to pick things up. */
export function nearFloor(world: World, p: PlayerState): boolean {
  return p.pos.y + swimming.bodyLow - world.grid.floorAt(p.pos.x, p.pos.z) < 0.6;
}

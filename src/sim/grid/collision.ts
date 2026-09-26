/**
 * Grid collision (spec §4 "Consultas que ofrece sim/grid"). The body is an
 * axis-aligned box moved one axis at a time against sector columns, like the
 * PoC. No generic physics.
 */
import { BLOCK, DIR_VEC, type Dir } from './units';

/** Effective grid heights, including dynamic objects. */
export interface GridQuery {
  /** Floor top (m) of a cell; +Infinity if solid. */
  cellFloor(cx: number, cz: number): number;
  /** Ceiling (m) of a cell; -Infinity if solid. */
  cellCeil(cx: number, cz: number): number;
  /** Floor height (m) at a point, with slopes; +Infinity if solid. */
  floorAt(x: number, z: number): number;
  /** Whether a ledge in this cell may be grabbed. */
  grabbable(cx: number, cz: number): boolean;
}

const EPS = 1e-4;

export interface Body {
  x: number;
  z: number;
  /** Feet height. */
  y: number;
  radius: number;
  height: number;
}

/**
 * Whether a cell blocks a body whose feet are at `feet`: solid, a floor higher
 * than `feet + stepUp`, or a ceiling lower than the head.
 */
export function blocks(
  q: GridQuery,
  cx: number,
  cz: number,
  feet: number,
  height: number,
  stepUp: number,
): boolean {
  const floor = q.cellFloor(cx, cz);
  if (floor > feet + stepUp + EPS) return true;
  const ceil = q.cellCeil(cx, cz);
  return ceil < Math.max(feet, floor) + height - EPS;
}

export interface SweepResult {
  x: number;
  z: number;
  hitX: boolean;
  hitZ: boolean;
}

/**
 * Moves a box by (dx, dz), one axis at a time, clamping against blocking
 * cells. `canEnter` lets callers veto cells (e.g. walking never drops off edges).
 */
export function sweep(
  q: GridQuery,
  body: Body,
  dx: number,
  dz: number,
  stepUp: number,
  canEnter?: (cx: number, cz: number) => boolean,
): SweepResult {
  let { x, z } = body;
  const r = body.radius;
  const blocked = (cx: number, cz: number): boolean =>
    blocks(q, cx, cz, body.y, body.height, stepUp) || (canEnter !== undefined && !canEnter(cx, cz));

  let hitX = false;
  if (dx !== 0) {
    const nx = x + dx;
    const zs0 = Math.floor((z - r + EPS) / BLOCK);
    const zs1 = Math.floor((z + r - EPS) / BLOCK);
    const edge = dx > 0 ? nx + r : nx - r;
    const cxEdge = Math.floor((dx > 0 ? edge - EPS : edge + EPS) / BLOCK);
    const cxNow = Math.floor((dx > 0 ? x + r - EPS : x - r + EPS) / BLOCK);
    let limit = nx;
    for (let cx = cxNow + Math.sign(dx); dx > 0 ? cx <= cxEdge : cx >= cxEdge; cx += Math.sign(dx)) {
      let hit = false;
      for (let cz = zs0; cz <= zs1; cz++) if (blocked(cx, cz)) hit = true;
      if (hit) {
        limit = dx > 0 ? cx * BLOCK - r - EPS : (cx + 1) * BLOCK + r + EPS;
        hitX = true;
        break;
      }
    }
    x = dx > 0 ? Math.min(nx, limit) : Math.max(nx, limit);
  }

  let hitZ = false;
  if (dz !== 0) {
    const nz = z + dz;
    const xs0 = Math.floor((x - r + EPS) / BLOCK);
    const xs1 = Math.floor((x + r - EPS) / BLOCK);
    const edge = dz > 0 ? nz + r : nz - r;
    const czEdge = Math.floor((dz > 0 ? edge - EPS : edge + EPS) / BLOCK);
    const czNow = Math.floor((dz > 0 ? z + r - EPS : z - r + EPS) / BLOCK);
    let limit = nz;
    for (let cz = czNow + Math.sign(dz); dz > 0 ? cz <= czEdge : cz >= czEdge; cz += Math.sign(dz)) {
      let hit = false;
      for (let cx = xs0; cx <= xs1; cx++) if (blocked(cx, cz)) hit = true;
      if (hit) {
        limit = dz > 0 ? cz * BLOCK - r - EPS : (cz + 1) * BLOCK + r + EPS;
        hitZ = true;
        break;
      }
    }
    z = dz > 0 ? Math.min(nz, limit) : Math.max(nz, limit);
  }

  return { x, z, hitX, hitZ };
}

/** Highest floor under the box footprint (the body stands on the highest cell it overlaps). */
export function supportHeight(q: GridQuery, x: number, z: number, r: number): number {
  let h = -Infinity;
  const x0 = Math.floor((x - r + EPS) / BLOCK);
  const x1 = Math.floor((x + r - EPS) / BLOCK);
  const z0 = Math.floor((z - r + EPS) / BLOCK);
  const z1 = Math.floor((z + r - EPS) / BLOCK);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const f =
        cx === Math.floor(x / BLOCK) && cz === Math.floor(z / BLOCK) ? q.floorAt(x, z) : q.cellFloor(cx, cz);
      if (f !== Infinity) h = Math.max(h, f);
    }
  }
  return h;
}

/** Distance from a point to the boundary of its cell in direction `dir`. */
export function distanceToEdge(x: number, z: number, dir: Dir): number {
  const cx = Math.floor(x / BLOCK);
  const cz = Math.floor(z / BLOCK);
  switch (dir) {
    case 'E':
      return (cx + 1) * BLOCK - x;
    case 'W':
      return x - cx * BLOCK;
    case 'S':
      return (cz + 1) * BLOCK - z;
    case 'N':
      return z - cz * BLOCK;
  }
}

export interface LedgeHit {
  cx: number;
  cz: number;
  y: number;
  /** Horizontal distance from the point to the ledge edge. */
  distance: number;
}

/**
 * The grabbable ledge in front of a point, looking in `dir` (spec: ledgeAt).
 * A ledge is the top of the neighbouring cell when it is higher than the
 * current floor and has room above it for hands.
 */
export function ledgeAhead(q: GridQuery, x: number, z: number, dir: Dir): LedgeHit | null {
  const cx = Math.floor(x / BLOCK);
  const cz = Math.floor(z / BLOCK);
  const v = DIR_VEC[dir];
  const nx = cx + v.x;
  const nz = cz + v.z;
  const top = q.cellFloor(nx, nz);
  if (!Number.isFinite(top)) return null;
  if (!q.grabbable(nx, nz)) return null;
  if (q.cellCeil(nx, nz) - top < 0.6) return null;
  const here = q.cellFloor(cx, cz);
  if (Number.isFinite(here) && top - here < 0.75) return null;
  return { cx: nx, cz: nz, y: top, distance: distanceToEdge(x, z, dir) };
}

/**
 * First solid point along a segment, sampled every `step` metres. Used for
 * camera collision and line of sight. Returns the fraction [0, 1] reached.
 */
export function raycast(
  q: GridQuery,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  step = 0.1,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    const z = from.z + dz * t;
    const cx = Math.floor(x / BLOCK);
    const cz = Math.floor(z / BLOCK);
    if (y <= q.floorAt(x, z) || y >= q.cellCeil(cx, cz)) return (i - 1) / n;
  }
  return 1;
}

/**
 * Enemy navigation on the sector grid (spec §7 "Pathfinding"): A* over cells
 * with height costs, bounded by a node budget, and a walkability test used to
 * straighten paths. Each walker declares what steps it can take.
 */
import type { GridQuery } from '../grid/collision';
import { BLOCK } from '../grid/units';

export interface Walker {
  /** Highest step up between neighbouring cells (m). */
  climb: number;
  /** Deepest step down between neighbouring cells (m). */
  maxDrop: number;
  /** Body height, for headroom (m). */
  height: number;
  /** Collision half-size (m). */
  radius: number;
}

export interface NavGrid {
  q: GridQuery;
  /** Cells a walker must never enter (spikes). */
  forbidden(cx: number, cz: number): boolean;
}

export type Cell = [number, number];

export interface PathResult {
  /** Cells to walk through, next first; ends at the goal or at the reachable cell closest to it. */
  path: Cell[];
  /** True when the goal cell itself can be reached. */
  reached: boolean;
}

const EPS = 1e-3;
const SQRT2 = Math.SQRT2;
/** Extra cost per metre climbed and dropped, in cells. */
const UP_COST = 1;
const DOWN_COST = 0.5;

/** 8 neighbours in a fixed order (determinism): orthogonals first. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

const key = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);

/** Whether a walker standing on floor `fa` may step into cell (bx, bz). */
export function canStep(nav: NavGrid, w: Walker, fa: number, bx: number, bz: number): boolean {
  const fb = nav.q.cellFloor(bx, bz);
  if (!Number.isFinite(fb)) return false;
  if (fb - fa > w.climb + EPS) return false;
  if (fa - fb > w.maxDrop + EPS) return false;
  if (nav.q.cellCeil(bx, bz) - Math.max(fa, fb) < w.height) return false;
  return !nav.forbidden(bx, bz);
}

interface Node {
  cx: number;
  cz: number;
  floor: number;
  g: number;
  f: number;
  parent: Node | null;
  closed: boolean;
  /** Insertion order, to break ties deterministically. */
  seq: number;
}

/** Binary min-heap on (f, seq). */
class Heap {
  private readonly items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  push(n: Node): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(n, a[p] as Node)) break;
      a[i] = a[p] as Node;
      i = p;
    }
    a[i] = n;
  }

  pop(): Node | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (!top || !last || a.length === 0) return top;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      let best = last;
      if (l < a.length && less(a[l] as Node, best)) {
        m = l;
        best = a[l] as Node;
      }
      if (r < a.length && less(a[r] as Node, best)) m = r;
      if (m === i) break;
      a[i] = a[m] as Node;
      i = m;
    }
    a[i] = last;
    return top;
  }
}

const less = (a: Node, b: Node): boolean => a.f < b.f || (a.f === b.f && a.seq < b.seq);

/** Octile distance in cells. */
function octile(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
}

/**
 * A* from `start` to `goal`. Diagonal moves need both orthogonal cells to be
 * passable (no corner cutting). When the goal cannot be reached within
 * `limit` expansions, the path leads to the explored cell closest to it.
 */
export function findPath(nav: NavGrid, w: Walker, start: Cell, goal: Cell, limit: number): PathResult {
  const [sx, sz] = start;
  const [gx, gz] = goal;
  const startFloor = nav.q.cellFloor(sx, sz);
  if (!Number.isFinite(startFloor)) return { path: [], reached: false };
  if (sx === gx && sz === gz) return { path: [], reached: true };

  const nodes = new Map<number, Node>();
  const open = new Heap();
  let seq = 0;
  const first: Node = {
    cx: sx,
    cz: sz,
    floor: startFloor,
    g: 0,
    f: octile(sx, sz, gx, gz),
    parent: null,
    closed: false,
    seq: seq++,
  };
  nodes.set(key(sx, sz), first);
  open.push(first);

  let best = first;
  let bestH = octile(sx, sz, gx, gz);
  let expanded = 0;
  let found: Node | null = null;

  while (open.size > 0 && expanded < limit) {
    const n = open.pop();
    if (!n || n.closed) continue;
    n.closed = true;
    expanded++;
    if (n.cx === gx && n.cz === gz) {
      found = n;
      break;
    }
    const h = octile(n.cx, n.cz, gx, gz);
    if (h < bestH || (h === bestH && n.g < best.g)) {
      best = n;
      bestH = h;
    }
    for (const [dx, dz] of NEIGHBOURS) {
      const bx = n.cx + dx;
      const bz = n.cz + dz;
      if (!canStep(nav, w, n.floor, bx, bz)) continue;
      if (dx !== 0 && dz !== 0) {
        if (!canStep(nav, w, n.floor, n.cx + dx, n.cz) || !canStep(nav, w, n.floor, n.cx, n.cz + dz))
          continue;
      }
      const floor = nav.q.cellFloor(bx, bz);
      const rise = floor - n.floor;
      const cost = (dx !== 0 && dz !== 0 ? SQRT2 : 1) + (rise > 0 ? rise * UP_COST : -rise * DOWN_COST);
      const g = n.g + cost;
      const k = key(bx, bz);
      const old = nodes.get(k);
      if (old && (old.closed || old.g <= g)) continue;
      const node: Node = {
        cx: bx,
        cz: bz,
        floor,
        g,
        f: g + octile(bx, bz, gx, gz),
        parent: n,
        closed: false,
        seq: seq++,
      };
      nodes.set(k, node);
      open.push(node);
    }
  }

  const end = found ?? best;
  const path: Cell[] = [];
  for (let n: Node | null = end; n && n !== first; n = n.parent) path.push([n.cx, n.cz]);
  path.reverse();
  return { path, reached: found !== null };
}

/**
 * Whether a walker can go in a straight line from (x0, z0), standing on
 * `y0`, to (x1, z1): every cell under its footprint along the way must be a
 * valid step from the cell it comes from.
 */
export function walkable(
  nav: NavGrid,
  w: Walker,
  x0: number,
  z0: number,
  y0: number,
  x1: number,
  z1: number,
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / 0.25));
  let cx = Math.floor(x0 / BLOCK);
  let cz = Math.floor(z0 / BLOCK);
  let floor = nav.q.cellFloor(cx, cz);
  if (!Number.isFinite(floor)) floor = y0;
  const r = w.radius;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + dx * t;
    const z = z0 + dz * t;
    for (const [ox, oz] of [
      [0, 0],
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ] as const) {
      const ccx = Math.floor((x + ox) / BLOCK);
      const ccz = Math.floor((z + oz) / BLOCK);
      if (ccx === cx && ccz === cz) continue;
      if (!canStep(nav, w, floor, ccx, ccz)) return false;
    }
    const ncx = Math.floor(x / BLOCK);
    const ncz = Math.floor(z / BLOCK);
    if (ncx !== cx || ncz !== cz) {
      cx = ncx;
      cz = ncz;
      floor = nav.q.cellFloor(cx, cz);
    }
  }
  return true;
}

/**
 * Room visibility through portals (spec §14 "Visibilidad por portales"): only
 * the rooms the camera can see are drawn. A portal is the opening where open
 * sectors of two rooms touch; a room is visible when a chain of portals whose
 * openings are inside the view frustum leads to it from the camera's room.
 *
 * Pure logic with no Three.js or DOM (the frustum test is passed in), so it
 * runs and is tested in Node.
 */
import type { Level } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';

/** An axis-aligned box in world metres. */
export interface Box {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface Portal {
  from: string;
  to: string;
  /** The opening: the shared edges of the two rooms, from the lower floor to the higher ceiling. */
  box: Box;
}

export interface RoomGraph {
  /** Portals leaving each room. */
  portals: Map<string, Portal[]>;
  /** Each room's bounds, floors to ceilings (for tests of what lies in a room). */
  bounds: Map<string, Box>;
}

const grow = (b: Box, x: number, y: number, z: number): void => {
  b.min.x = Math.min(b.min.x, x);
  b.min.y = Math.min(b.min.y, y);
  b.min.z = Math.min(b.min.z, z);
  b.max.x = Math.max(b.max.x, x);
  b.max.y = Math.max(b.max.y, y);
  b.max.z = Math.max(b.max.z, z);
};

const emptyBox = (): Box => ({
  min: { x: Infinity, y: Infinity, z: Infinity },
  max: { x: -Infinity, y: -Infinity, z: -Infinity },
});

/** Finds every portal of a level and the bounds of its rooms. */
export function roomGraph(level: Level): RoomGraph {
  const byPair = new Map<string, Portal>();
  const bounds = new Map<string, Box>();
  for (const s of level.allSectors()) {
    const rb = bounds.get(s.room) ?? emptyBox();
    bounds.set(s.room, rb);
    grow(rb, s.cx * BLOCK, Math.min(...s.floor, s.pitFloor), s.cz * BLOCK);
    grow(rb, (s.cx + 1) * BLOCK, s.ceil, (s.cz + 1) * BLOCK);
    if (s.wall) continue;
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const n = level.sector(s.cx + dx, s.cz + dz);
      if (!n || n.wall || n.room === s.room) continue;
      // The shared edge between the two cells.
      const x0 = (s.cx + dx) * BLOCK;
      const z0 = (s.cz + dz) * BLOCK;
      const x1 = dx ? x0 : x0 + BLOCK;
      const z1 = dz ? z0 : z0 + BLOCK;
      const y0 = Math.min(...s.floor, ...n.floor, s.pitFloor, n.pitFloor);
      const y1 = Math.max(s.ceil, n.ceil);
      for (const [a, b] of [
        [s.room, n.room],
        [n.room, s.room],
      ] as const) {
        const k = `${a}\u0000${b}`;
        let p = byPair.get(k);
        if (!p) {
          p = { from: a, to: b, box: emptyBox() };
          byPair.set(k, p);
        }
        grow(p.box, x0, y0, z0);
        grow(p.box, x1, y1, z1);
      }
    }
  }
  const portals = new Map<string, Portal[]>();
  for (const r of level.rooms) portals.set(r.id, []);
  for (const p of byPair.values()) portals.get(p.from)?.push(p);
  return { portals, bounds };
}

/**
 * Rooms visible from `start` (the camera's room, and the player's when they
 * differ): breadth first through portals that `seen` accepts, at most
 * `maxDepth` portals deep. `seen` is the frustum test; it is only asked about
 * portals of rooms already visible, so an opening hidden behind a wall of an
 * unseen room never lets its room in.
 */
export function visibleRooms(
  graph: RoomGraph,
  start: Iterable<string>,
  seen: (portal: Portal) => boolean,
  maxDepth = 3,
  out = new Set<string>(),
): Set<string> {
  out.clear();
  let frontier: string[] = [];
  for (const r of start) {
    if (graph.portals.has(r) && !out.has(r)) {
      out.add(r);
      frontier.push(r);
    }
  }
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const room of frontier) {
      for (const p of graph.portals.get(room) ?? []) {
        if (out.has(p.to) || !seen(p)) continue;
        out.add(p.to);
        next.push(p.to);
      }
    }
    frontier = next;
  }
  return out;
}

/** The room containing a world point (walls count: the camera may sit inside one), or null outside the level. */
export function roomAtPoint(level: Level, x: number, z: number): string | null {
  return level.sector(Math.floor(x / BLOCK), Math.floor(z / BLOCK))?.room ?? null;
}

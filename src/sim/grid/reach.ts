/**
 * Where the controller can possibly go (spec §16 "Validador de niveles"): a
 * graph over the level's cells, built to over-approximate Nora's movement.
 * Doors count as open, water as at its highest, a pour's trench as cooled
 * into its bridge, moving platforms as standing
 * at every height on their path, and any cell of a room with a pushable
 * block as possibly holding that block, to stand on, and every wind zone as
 * blowing whichever way helps: jumps from a windy cell reach further, and an
 * updraught lets her reach higher ledges. A climbable face is climbed to its
 * top from any height, and traversed sideways while it continues. A cell this graph cannot reach can never be reached
 * in play, so an exit, secret or checkpoint outside it is a broken level.
 * Being reachable here does not prove a cell is reachable in play: the bot
 * walkthroughs do that.
 */
import type { Level, Sector } from './level';
import { tuning, wind as windTuning } from '../player/tuning';
import { BLOCK, CLICK } from './units';

/** Highest ledge reachable from standing: hands at full jump plus the grab window (≈3.7 m). */
export const CLIMB =
  tuning.handHeight + (tuning.jumpSpeed * tuning.jumpSpeed) / (2 * tuning.gravity) + tuning.grabAbove + 0.05;
/** A pushable block is one block tall: standing on it adds this much. */
const BLOCK_BONUS = BLOCK;
/** Least room above the feet for Nora to pass (she ducks into a climb-up or a roll). */
const HEADROOM = 1;
/** Running jumps: gaps of up to this many cells, landing no higher than JUMP_RISE above take-off. */
const GAP_CELLS = 3;
const JUMP_RISE = 1.5;
/** A gust lengthens a running jump by about a block: count two more, to over-approximate. */
const WIND_GAP_CELLS = 2;

/** Highest ledge reachable in an updraught that takes `lift` of gravity away. */
const climbIn = (lift: number): number =>
  tuning.handHeight +
  (tuning.jumpSpeed * tuning.jumpSpeed) / (2 * tuning.gravity * (1 - lift)) +
  tuning.grabAbove +
  0.05;

export const key = (cx: number, cz: number): string => `${cx},${cz}`;

interface Node {
  cx: number;
  cz: number;
  h: number;
}

const nodeKey = (n: Node): string => `${n.cx},${n.cz},${n.h}`;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The cells (keys) the controller could stand in, starting from the level's start. */
export function reachableCells(level: Level): Set<string> {
  // Extra standing heights per cell: water surfaces, trapdoor leaves, platform stops.
  const extra = new Map<string, number[]>();
  const add = (cx: number, cz: number, h: number): void => {
    const k = key(cx, cz);
    const list = extra.get(k) ?? [];
    if (!list.includes(h)) list.push(h);
    extra.set(k, list);
  };
  const blockRooms = new Set<string>();
  // Cells where a horizontal wind may blow, and the strongest updraught over each cell.
  const windy = new Set<string>();
  const updraught = new Map<string, number>();
  const floodTo = new Map<string, number>();
  for (const e of level.entities) {
    const room = level.rooms.find((r) => r.id === e.room);
    if (!room) continue;
    const [cx, cz] = e.at;
    if (e.type === 'block') blockRooms.add(e.room);
    if (e.type === 'wind') {
      const lift = Math.min(0.9, e.strength ?? windTuning.lift);
      for (let x = 0; x < e.size[0]; x++)
        for (let z = 0; z < e.size[1]; z++) {
          const k = key(cx + x, cz + z);
          if (e.dir === 'up') updraught.set(k, Math.max(updraught.get(k) ?? 0, lift));
          else windy.add(k);
        }
    }
    if (e.type === 'watergate') {
      const high = room.originY + e.high * CLICK;
      for (const r of e.rooms ?? [e.room]) floodTo.set(r, Math.max(floodTo.get(r) ?? -Infinity, high));
    }
    if (e.type === 'trapdoor') {
      for (let x = 0; x < e.size[0]; x++)
        for (let z = 0; z < e.size[1]; z++) add(cx + x, cz + z, room.originY + e.h * CLICK);
    }
    if (e.type === 'pour') {
      // The bridge a pour cools into, along its whole trench (legs between the listed cells).
      const y = room.originY + e.h * CLICK;
      let [px, pz] = [cx, cz];
      add(px, pz, y);
      for (const [x, z] of e.path.slice(1)) {
        const [tx, tz] = [room.minX + x, room.minZ + z];
        while (px !== tx || pz !== tz) {
          px += Math.sign(tx - px);
          pz += Math.sign(tz - pz);
          add(px, pz, y);
        }
      }
    }
    if (e.type === 'platform') {
      // Every cell of every leg, at both ends' heights: a rising leg reaches between them.
      const pts = e.path.map(([x, z, h]) => ({
        cx: room.minX + x,
        cz: room.minZ + z,
        h: room.originY + h * CLICK,
      }));
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (!a || !b) continue;
        const steps = Math.max(Math.abs(b.cx - a.cx), Math.abs(b.cz - a.cz));
        for (let s = 0; s <= steps; s++) {
          const t = steps === 0 ? 0 : s / steps;
          const x = Math.round(a.cx + (b.cx - a.cx) * t);
          const z = Math.round(a.cz + (b.cz - a.cz) * t);
          for (let h = Math.min(a.h, b.h); h <= Math.max(a.h, b.h) + 1e-6; h += CLICK) add(x, z, h);
        }
      }
    }
  }

  const water = (s: Sector): number | null => {
    const flood = floodTo.get(s.room);
    const top = Math.max(...s.floor);
    if (flood !== undefined && flood > top) return Math.max(flood, s.water ?? -Infinity);
    return s.water;
  };
  const heights = (s: Sector): number[] => {
    const out: number[] = [];
    if (s.wall) return out;
    const floor = s.pit ? s.pitFloor : Math.max(...s.floor);
    if (!s.flags.has('death')) out.push(floor);
    const w = water(s);
    if (w !== null && w > floor) out.push(w);
    for (const h of extra.get(key(s.cx, s.cz)) ?? []) out.push(h);
    // Any cell of a room with a pushable block may end up with the block in it, to stand on.
    if (blockRooms.has(s.room)) out.push(floor + BLOCK_BONUS);
    return out.filter((h) => s.ceil - h >= HEADROOM || (w !== null && h < w));
  };
  /** Whether the cell at (cx, cz) has a climbable face looking along (dx, dz). */
  const faceLooking = (cx: number, cz: number, dx: number, dz: number): boolean => {
    const s = level.sector(cx, cz);
    const flag = dx > 0 ? 'climbE' : dx < 0 ? 'climbW' : dz > 0 ? 'climbS' : 'climbN';
    return s?.flags.has(flag) ?? false;
  };
  /** The faces a cell has in front of it: she can be on them at any height. */
  const facesAt = (cx: number, cz: number): (readonly [number, number])[] =>
    NEIGHBOURS.filter(([dx, dz]) => faceLooking(cx + dx, cz + dz, -dx, -dz));

  const start = level.sector(level.start.x, level.start.z);
  const seen = new Set<string>();
  const cells = new Set<string>();
  if (!start) return cells;
  const queue: Node[] = heights(start).map((h) => ({ cx: start.cx, cz: start.cz, h }));
  const visit = (n: Node): void => {
    const k = nodeKey(n);
    if (seen.has(k)) return;
    seen.add(k);
    queue.push(n);
  };
  for (const n of queue) seen.add(nodeKey(n));

  while (queue.length > 0) {
    const n = queue.shift() as Node;
    const here = level.sector(n.cx, n.cz);
    if (!here) continue;
    cells.add(key(n.cx, n.cz));
    const w = water(here);
    const swimming = w !== null && n.h <= w + 1e-6 && n.h > Math.max(...here.floor) - 1e-6;
    // Within a cell: dive from the surface, swim up from the bottom, step off a platform.
    for (const h of heights(here))
      if (h !== n.h && (h < n.h || swimming || (w !== null && h <= w))) visit({ ...n, h });
    const lift = updraught.get(key(n.cx, n.cz));
    const reach = (lift === undefined ? CLIMB : climbIn(lift)) + (swimming ? 1 : 0);
    const gaps = GAP_CELLS + (windy.has(key(n.cx, n.cz)) ? WIND_GAP_CELLS : 0);
    for (const [dx, dz] of NEIGHBOURS) {
      const next = level.sector(n.cx + dx, n.cz + dz);
      if (next && !next.wall) {
        // Up the face of the neighbour that looks at her.
        const climb = faceLooking(next.cx, next.cz, -dx, -dz);
        for (const h of heights(next)) {
          const nw = water(next);
          // Under water she swims to any depth of a flooded neighbour.
          const underwater = swimming && nw !== null && h <= nw + 1e-6;
          if (h - n.h <= reach || climb || underwater) visit({ cx: next.cx, cz: next.cz, h });
        }
      }
      // Along a face that continues beside her, at any height: to the cell beside and the top above it.
      for (const [fx, fz] of facesAt(n.cx, n.cz)) {
        if (dx === fx && dz === fz) continue;
        if (dx === -fx && dz === -fz) continue;
        if (!next || next.wall || !faceLooking(next.cx + fx, next.cz + fz, -fx, -fz)) continue;
        for (const h of heights(next)) visit({ cx: next.cx, cz: next.cz, h });
        const top = level.sector(next.cx + fx, next.cz + fz);
        if (top) for (const h of heights(top)) visit({ cx: top.cx, cz: top.cz, h });
      }
      // Running jumps over gaps: nothing taller than a grab in the way, landing not much higher.
      if (swimming) continue;
      for (let k = 2; k <= gaps; k++) {
        const mid = level.sector(n.cx + dx * (k - 1), n.cz + dz * (k - 1));
        if (!mid || mid.wall || mid.ceil - n.h < 2) break;
        const land = level.sector(n.cx + dx * k, n.cz + dz * k);
        if (!land || land.wall) continue;
        for (const h of heights(land)) if (h - n.h <= JUMP_RISE) visit({ cx: land.cx, cz: land.cz, h });
      }
    }
  }
  return cells;
}

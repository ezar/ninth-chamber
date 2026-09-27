/**
 * Sun beams (spec §8 "Pilar giratorio / espejo"): a beam of sunlight enters
 * at a declared cell and direction and is traced cell by cell through the
 * grid at its height. Mirrors on their drums turn it 90° (their polished
 * face looks along a diagonal; the back of the drum stops it); walls, raised
 * floors, low ceilings, closed doors, blocks and platforms stop it; a sun
 * disc facing it lights up. The traced path is simulation state, so it is
 * deterministic and testable, and the renderer only draws it.
 */
import { sectorTop } from '../grid/level';
import { BLOCK, DIR_VEC, OPPOSITE, type Dir } from '../grid/units';
import { devices, mechanics } from '../player/tuning';
import type { World } from '../world';
import { platformOverCell } from './platforms';
import type { MechanismDefs, SunbeamDef } from './defs';
import type { Facing4, Point } from './types';

/** Diagonal normals of a mirror's face, by facing index (NE, SE, SW, NW). */
const NORMALS: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

const dirOf = (x: number, z: number): Dir => (x > 0 ? 'E' : x < 0 ? 'W' : z > 0 ? 'S' : 'N');

/** The direction a beam travelling `dir` leaves a mirror in, or null when it strikes the back of the drum. */
export function reflect(dir: Dir, facing: Facing4): Dir | null {
  const d = DIR_VEC[dir];
  const [nx, nz] = NORMALS[facing] as readonly [number, number];
  const dot = d.x * nx + d.z * nz;
  if (dot >= 0) return null;
  // d − 2(d·n̂)n̂ with |n|² = 2.
  return dirOf(d.x - dot * nx, d.z - dot * nz);
}

export interface Trace {
  points: Point[];
  /** Mirrors reached and receivers lit, in order. */
  hits: string[];
}

/** Traces one beam through the current state of the world. */
export function traceBeam(world: World, defs: MechanismDefs, src: SunbeamDef): Trace {
  const y = src.y;
  const m = world.state.mechanisms;
  const centre = (cx: number, cz: number): Point => ({
    x: cx * BLOCK + BLOCK / 2,
    y,
    z: cz * BLOCK + BLOCK / 2,
  });
  let dir = src.dir;
  let cx = src.cx;
  let cz = src.cz;
  const points: Point[] = [];
  const hits: string[] = [];
  const start = centre(cx, cz);
  if (src.from === 'sky') {
    const ceil = world.level.sector(cx, cz)?.ceil ?? y + 4;
    points.push({ ...start, y: ceil }, start);
  } else {
    const v = DIR_VEC[dir];
    points.push({ x: start.x - v.x, y, z: start.z - v.z });
  }

  const seen = new Set<string>();
  for (let n = 0; n < devices.beamMaxCells; n++) {
    const v = DIR_VEC[dir];
    const c = centre(cx, cz);
    const entry = { x: c.x - v.x, y, z: c.z - v.z };
    if (n > 0) {
      const key = `${cx},${cz},${dir}`;
      if (seen.has(key)) break;
      seen.add(key);
      const mirror = m.mirrors.find((mi) => mi.cx === cx && mi.cz === cz);
      if (mirror) {
        points.push(c);
        hits.push(mirror.id);
        const out = reflect(dir, mirror.facing);
        if (!out) return { points, hits };
        dir = out;
        cx += DIR_VEC[dir].x;
        cz += DIR_VEC[dir].z;
        continue;
      }
      const rx = m.receivers.find((r) => r.cx === cx && r.cz === cz);
      if (rx) {
        const def = defs.receivers.get(rx.id);
        if (def && dir === OPPOSITE[def.face]) hits.push(rx.id);
        points.push(def?.inWall ? entry : { x: c.x - v.x * 0.4, y, z: c.z - v.z * 0.4 });
        return { points, hits };
      }
      const stop = blocker(world, cx, cz, y, entry, c, v);
      if (stop) {
        points.push(stop);
        return { points, hits };
      }
    }
    cx += v.x;
    cz += v.z;
  }
  const last = points[points.length - 1];
  const v = DIR_VEC[dir];
  points.push(last ? { x: cx * BLOCK + BLOCK / 2 - v.x, y, z: cz * BLOCK + BLOCK / 2 - v.z } : start);
  return { points, hits };
}

/** Where the beam stops in cell (cx, cz), or null if it passes through. */
function blocker(
  world: World,
  cx: number,
  cz: number,
  y: number,
  entry: Point,
  c: Point,
  v: { x: number; z: number },
): Point | null {
  const s = world.level.sector(cx, cz);
  if (!s || s.wall) return entry;
  const fallen = world.state.tiles[`${cx},${cz}`]?.fallen === true;
  const floor = fallen ? s.pitFloor : sectorTop(s);
  if (floor >= y - 0.05 || s.ceil <= y + 0.05) return entry;
  for (const a of world.state.actors) {
    if (a.kind === 'door' && a.cx === cx && a.cz === cz && a.open < mechanics.doorPassable) {
      return { x: c.x - v.x * 0.25, y, z: c.z - v.z * 0.25 };
    }
    if (a.kind !== 'block') continue;
    const here = (a.cx === cx && a.cz === cz) || (a.from !== null && a.from.cx === cx && a.from.cz === cz);
    if (here && a.y < y && a.y + mechanics.blockHeight > y) return entry;
  }
  for (const p of world.state.mechanisms.platforms) {
    if (!platformOverCell(p.pos, cx, cz)) continue;
    if (p.pos.y >= y && p.pos.y - devices.platformThickness <= y) return entry;
  }
  return null;
}

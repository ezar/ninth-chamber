/**
 * Static description of a level's mechanisms, derived once from its entities
 * (world cells and metres). The dynamic part lives in DynamicState.
 */
import type { Level } from '../grid/level';
import { BLOCK, CLICK, DIR_VEC, type Dir } from '../grid/units';
import { DIAGONALS } from './schema';
import type { Facing4, Point } from './types';
import { forge, wind as windTuning } from '../player/tuning';

export interface PlatformDef {
  id: string;
  /** Top-centre of each waypoint (m). */
  path: Point[];
  speed: number;
  pause: number;
  loop: 'pingpong' | 'cycle' | 'once';
  running: boolean;
}

export interface Rect {
  minX: number;
  minZ: number;
  /** Exclusive. */
  maxX: number;
  maxZ: number;
}

export interface TrapdoorDef extends Rect {
  id: string;
  /** Top of the closed leaves (m). */
  y: number;
  open: boolean;
}

export interface SunbeamDef {
  id: string;
  cx: number;
  cz: number;
  dir: Dir;
  /** Beam height (m). */
  y: number;
  from: 'wall' | 'sky';
  on: boolean;
}

export interface MirrorDef {
  id: string;
  cx: number;
  cz: number;
  facing: Facing4;
  fixed: boolean;
}

export interface ReceiverDef {
  id: string;
  cx: number;
  cz: number;
  face: Dir;
  /** Set into a wall rather than standing on a pedestal. */
  inWall: boolean;
}

export interface ItemDef {
  id: string;
  cx: number;
  cz: number;
  item: string;
}

export interface SlotDef {
  id: string;
  cx: number;
  cz: number;
  wall: Dir;
  accepts: string;
}

export interface BoulderDef {
  id: string;
  /** Cell centres along its path (m). */
  path: { x: number; z: number }[];
  /** Cumulative distance at each path point (m). */
  at: number[];
  length: number;
}

export interface BladeDef {
  id: string;
  cx: number;
  cz: number;
  axis: 'x' | 'z';
  phase: number;
  /** Pivot height under the ceiling and the floor of its sector (m). */
  pivot: number;
  floor: number;
  /** Pivot to the blade's lowest point (m). */
  reach: number;
}

export interface FireDef extends Rect {
  id: string;
  period: number;
  burn: number;
  offset: number;
  on: boolean;
}

export interface GlyphLockDef {
  id: string;
  cx: number;
  cz: number;
  facing: Dir;
  glyph: number;
  target: number;
}

export interface DartDef {
  id: string;
  /** The painted slab. */
  cx: number;
  cz: number;
  from: Dir;
  count: number;
  /** Cells the volley crosses, from the wall it leaves to the one it strikes (open cells only). */
  line: { cx: number; cz: number }[];
}

export interface PourDef {
  id: string;
  /** Trench cells in pouring order (world cells). */
  cells: { cx: number; cz: number }[];
  /** Top of the cast bronze (m). */
  y: number;
  speed: number;
  cool: number;
  period: number | null;
  running: boolean;
}

export interface HeatDef extends Rect {
  id: string;
  on: boolean;
}

export type WindDir = 'N' | 'E' | 'S' | 'W' | 'up';

export interface WindDef extends Rect {
  id: string;
  dir: WindDir;
  /** Horizontal speed (m/s), or for an updraught the fraction of gravity taken away. */
  strength: number;
  /** Null: it blows steadily while on. */
  period: number | null;
  blow: number;
  offset: number;
  tear: boolean;
  on: boolean;
}

export interface RingDef {
  id: string;
  kind: 'sky' | 'moon' | 'horizon';
  /** The dome's centre (world cell) and the ring's radius (m), for the look. */
  cx: number;
  cz: number;
  radius: number;
  positions: number;
  start: number;
  target: number;
}

export interface OculusDef extends Rect {
  id: string;
  on: boolean;
}

export interface TangleDef extends Rect {
  id: string;
  /** Top of the grown roots (m). */
  top: number;
  grown: boolean;
  hold: 'free' | 'sealed' | 'parted';
}

export interface MechanismDefs {
  platforms: Map<string, PlatformDef>;
  trapdoors: Map<string, TrapdoorDef>;
  sunbeams: Map<string, SunbeamDef>;
  mirrors: Map<string, MirrorDef>;
  receivers: Map<string, ReceiverDef>;
  items: Map<string, ItemDef>;
  slots: Map<string, SlotDef>;
  boulders: Map<string, BoulderDef>;
  blades: Map<string, BladeDef>;
  fires: Map<string, FireDef>;
  glyphs: Map<string, GlyphLockDef>;
  darts: Map<string, DartDef>;
  pours: Map<string, PourDef>;
  heat: Map<string, HeatDef>;
  winds: Map<string, WindDef>;
  rings: Map<string, RingDef>;
  oculi: Map<string, OculusDef>;
  tangles: Map<string, TangleDef>;
  /** Trench cells of each pour: the pour and the cell's place in its order. */
  pourCells: Map<number, { id: string; i: number }[]>;
  /** Cells taken by mirror drums and receiver pedestals: solid for bodies. */
  solid: Set<number>;
  /** Cells covered by trapdoors (for navigation). */
  trapdoorCells: Set<number>;
}

export const cellKey = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);
const center = (c: number): number => c * BLOCK + BLOCK / 2;

const cache = new WeakMap<Level, MechanismDefs>();

/** The mechanisms of a level (cached per level). */
export function defsOf(level: Level): MechanismDefs {
  const hit = cache.get(level);
  if (hit) return hit;
  const d = buildDefs(level);
  cache.set(level, d);
  return d;
}

function buildDefs(level: Level): MechanismDefs {
  const d: MechanismDefs = {
    platforms: new Map(),
    trapdoors: new Map(),
    sunbeams: new Map(),
    mirrors: new Map(),
    receivers: new Map(),
    items: new Map(),
    slots: new Map(),
    boulders: new Map(),
    blades: new Map(),
    fires: new Map(),
    glyphs: new Map(),
    darts: new Map(),
    pours: new Map(),
    heat: new Map(),
    winds: new Map(),
    rings: new Map(),
    oculi: new Map(),
    tangles: new Map(),
    pourCells: new Map(),
    solid: new Set(),
    trapdoorCells: new Set(),
  };
  const roomOf = (id: string): { x: number; z: number; y: number } => {
    const r = level.rooms.find((x) => x.id === id);
    return r ? { x: r.minX, z: r.minZ, y: r.originY } : { x: 0, z: 0, y: 0 };
  };
  for (const e of level.entities) {
    const [cx, cz] = e.at;
    const o = roomOf(e.room);
    switch (e.type) {
      case 'platform':
        d.platforms.set(e.id, {
          id: e.id,
          path: e.path.map(([x, z, h]) => ({ x: center(o.x + x), y: o.y + h * CLICK, z: center(o.z + z) })),
          speed: e.speed,
          pause: e.pause,
          loop: e.loop,
          running: e.running,
        });
        break;
      case 'trapdoor':
        d.trapdoors.set(e.id, {
          id: e.id,
          minX: cx,
          minZ: cz,
          maxX: cx + e.size[0],
          maxZ: cz + e.size[1],
          y: o.y + e.h * CLICK,
          open: e.open,
        });
        for (let x = cx; x < cx + e.size[0]; x++)
          for (let z = cz; z < cz + e.size[1]; z++) d.trapdoorCells.add(cellKey(x, z));
        break;
      case 'sunbeam':
        d.sunbeams.set(e.id, { id: e.id, cx, cz, dir: e.dir, y: o.y + e.y * CLICK, from: e.from, on: e.on });
        break;
      case 'mirror':
        d.mirrors.set(e.id, {
          id: e.id,
          cx,
          cz,
          facing: DIAGONALS.indexOf(e.facing) as Facing4,
          fixed: e.fixed,
        });
        d.solid.add(cellKey(cx, cz));
        break;
      case 'receiver': {
        const inWall = level.sector(cx, cz)?.wall !== false;
        d.receivers.set(e.id, { id: e.id, cx, cz, face: e.face, inWall });
        if (!inWall) d.solid.add(cellKey(cx, cz));
        break;
      }
      case 'item':
        d.items.set(e.id, { id: e.id, cx, cz, item: e.item });
        break;
      case 'slot':
        d.slots.set(e.id, { id: e.id, cx, cz, wall: e.wall, accepts: e.accepts });
        break;
      case 'boulder': {
        const path = e.path.map(([x, z]) => ({ x: center(o.x + x), z: center(o.z + z) }));
        const at = [0];
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1] as { x: number; z: number };
          const b = path[i] as { x: number; z: number };
          at.push((at[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
        }
        d.boulders.set(e.id, { id: e.id, path, at, length: at[at.length - 1] ?? 0 });
        break;
      }
      case 'blade': {
        const s = level.sector(cx, cz);
        const floor = s ? Math.max(...s.floor) : 0;
        const ceil = s ? s.ceil : floor + 6;
        const pivot = ceil - 0.3;
        d.blades.set(e.id, { id: e.id, cx, cz, axis: e.axis, phase: e.phase, pivot, floor, reach: 0 });
        break;
      }
      case 'fire':
        d.fires.set(e.id, {
          id: e.id,
          minX: cx,
          minZ: cz,
          maxX: cx + e.size[0],
          maxZ: cz + e.size[1],
          period: e.period,
          burn: e.burn,
          offset: e.offset,
          on: e.on,
        });
        break;
      case 'glyphlock':
        d.glyphs.set(e.id, { id: e.id, cx, cz, facing: e.facing, glyph: e.glyph, target: e.target });
        d.solid.add(cellKey(cx, cz));
        break;
      case 'darts': {
        // Walk from the slab towards the wall the darts leave, then across to the far wall.
        const v = DIR_VEC[e.from];
        const open = (x: number, z: number): boolean => {
          const s = level.sector(x, z);
          return s !== undefined && !s.wall;
        };
        let sx = cx;
        let sz = cz;
        while (open(sx + v.x, sz + v.z)) {
          sx += v.x;
          sz += v.z;
        }
        const line: { cx: number; cz: number }[] = [];
        for (let x = sx, z = sz; open(x, z); x -= v.x, z -= v.z) line.push({ cx: x, cz: z });
        d.darts.set(e.id, { id: e.id, cx, cz, from: e.from, count: e.count, line });
        break;
      }
      case 'pour': {
        // Legs run straight between the listed cells, `at` first.
        const pts = [e.at, ...e.path.slice(1).map(([x, z]) => [o.x + x, o.z + z] as const)];
        const cells: { cx: number; cz: number }[] = [{ cx, cz }];
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1] as readonly [number, number];
          const [bx, bz] = pts[i] as readonly [number, number];
          const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
          for (let k = 1; k <= n; k++)
            cells.push({ cx: ax + Math.sign(bx - ax) * k, cz: az + Math.sign(bz - az) * k });
        }
        d.pours.set(e.id, {
          id: e.id,
          cells,
          y: o.y + e.h * CLICK,
          speed: e.speed ?? forge.pour.speed,
          cool: e.cool ?? forge.pour.cool,
          period: e.period ?? null,
          running: e.running,
        });
        cells.forEach((c, i) => {
          const k = cellKey(c.cx, c.cz);
          const list = d.pourCells.get(k) ?? [];
          list.push({ id: e.id, i });
          d.pourCells.set(k, list);
        });
        break;
      }
      case 'heat':
        d.heat.set(e.id, {
          id: e.id,
          minX: cx,
          minZ: cz,
          maxX: cx + e.size[0],
          maxZ: cz + e.size[1],
          on: e.on,
        });
        break;
      case 'wind':
        d.winds.set(e.id, {
          id: e.id,
          minX: cx,
          minZ: cz,
          maxX: cx + e.size[0],
          maxZ: cz + e.size[1],
          dir: e.dir,
          strength: e.strength ?? (e.dir === 'up' ? windTuning.lift : windTuning.speed),
          period: e.period ?? null,
          blow: e.blow ?? Math.min(windTuning.blow, e.period ?? windTuning.blow),
          offset: e.offset,
          tear: e.tear,
          on: e.on,
        });
        break;
      case 'ring':
        d.rings.set(e.id, {
          id: e.id,
          kind: e.kind,
          cx,
          cz,
          radius: e.radius ?? { sky: 5, moon: 6.2, horizon: 7.4 }[e.kind],
          positions: e.positions,
          start: e.start % e.positions,
          target: e.target % e.positions,
        });
        break;
      case 'oculus':
        d.oculi.set(e.id, {
          id: e.id,
          minX: cx,
          minZ: cz,
          maxX: cx + e.size[0],
          maxZ: cz + e.size[1],
          on: e.on,
        });
        break;
      case 'tangle':
        d.tangles.set(e.id, {
          id: e.id,
          minX: cx,
          minZ: cz,
          maxX: cx + e.size[0],
          maxZ: cz + e.size[1],
          top: o.y + e.top * CLICK,
          grown: e.grown,
          hold: e.hold,
        });
        break;
      default:
        break;
    }
  }
  return d;
}

export const inRect = (r: Rect, cx: number, cz: number): boolean =>
  cx >= r.minX && cx < r.maxX && cz >= r.minZ && cz < r.maxZ;

/** Unit vector of a direction, as a helper for beams and traps. */
export const dirVec = (d: Dir): { x: number; z: number } => DIR_VEC[d];

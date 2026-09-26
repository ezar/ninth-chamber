/**
 * Static level geometry built from a level file: a map of 2 × 2 m sectors in
 * world cell coordinates. Dynamic objects (blocks, doors, collapsed tiles) are
 * layered on top by World.
 */
import {
  levelSchema,
  type EntityFile,
  type LevelFile,
  type Material,
  type RuleFile,
  type SectorFlag,
} from './schema';
import { BLOCK, CLICK, type Dir } from './units';

export interface Sector {
  cx: number;
  cz: number;
  room: string;
  wall: boolean;
  pit: boolean;
  /** Corner floor heights in metres: NW, NE, SE, SW. */
  floor: [number, number, number, number];
  /** Ceiling height in metres. */
  ceil: number;
  mat: Material;
  flags: ReadonlySet<SectorFlag>;
  /** Water surface height in metres, if any. */
  water: number | null;
  /** Floor height (m) this sector drops to if it collapses. */
  pitFloor: number;
}

export interface RoomInfo {
  id: string;
  /** Cell bounds (inclusive min, exclusive max). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  look: string | null;
  reverb: string | null;
}

export interface Start {
  x: number;
  z: number;
  dir: Dir;
}

const key = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);

export class Level {
  readonly id: string;
  readonly name: string;
  /** Par time (s) for the end-of-level rating, if the level sets one. */
  readonly par: number | null;
  readonly rooms: RoomInfo[] = [];
  readonly entities: EntityFile[];
  readonly logic: RuleFile[];
  readonly start: Start;
  private readonly sectors = new Map<number, Sector>();

  constructor(file: LevelFile) {
    this.id = file.id;
    this.name = file.name;
    this.par = file.par ?? null;
    this.entities = file.entities.map((e) => ({ ...e, at: this.toWorld(file, e.room, e.at) }));
    this.logic = file.logic;

    for (const room of file.rooms) {
      const [ox, oz, oy] = room.origin;
      const width = Math.max(...room.rows.map((r) => r.length));
      this.rooms.push({
        id: room.id,
        minX: ox,
        minZ: oz,
        maxX: ox + width,
        maxZ: oz + room.rows.length,
        look: room.look ?? null,
        reverb: room.reverb ?? null,
      });
      room.rows.forEach((row, rz) => {
        [...row].forEach((ch, rx) => {
          if (ch === ' ') return;
          const entry = room.legend[ch];
          if (entry === undefined) throw new Error(`Room ${room.id}: no legend entry for '${ch}'`);
          const cx = ox + rx;
          const cz = oz + rz;
          if (this.sectors.has(key(cx, cz)))
            throw new Error(`Room ${room.id} overlaps another room at ${cx},${cz}`);
          const base = {
            cx,
            cz,
            room: room.id,
            ceil: (oy + room.ceil) * CLICK,
            mat: room.mat,
            flags: new Set<SectorFlag>(),
            water: null,
            pitFloor: (oy + room.pitDepth) * CLICK,
          };
          let sector: Sector;
          if (entry === 'wall') {
            sector = { ...base, wall: true, pit: false, floor: flat((oy + room.ceil) * CLICK) };
          } else if (entry === 'pit') {
            sector = { ...base, wall: false, pit: true, floor: flat((oy + room.pitDepth) * CLICK) };
          } else if (typeof entry === 'number') {
            sector = { ...base, wall: false, pit: false, floor: flat((oy + entry) * CLICK) };
          } else {
            sector = {
              ...base,
              wall: false,
              pit: false,
              floor: flat((oy + entry.floor) * CLICK),
              ceil: entry.ceil !== undefined ? (oy + entry.ceil) * CLICK : base.ceil,
              mat: entry.mat ?? base.mat,
              flags: new Set(entry.flags ?? []),
            };
          }
          this.sectors.set(key(cx, cz), sector);
        });
      });
      for (const o of room.overrides) {
        const s = this.sectors.get(key(ox + o.at[0], oz + o.at[1]));
        if (!s) throw new Error(`Room ${room.id}: override at ${o.at.join(',')} is outside the room`);
        if (o.floor !== undefined) {
          s.floor =
            typeof o.floor === 'number'
              ? flat((oy + o.floor) * CLICK)
              : (o.floor.map((f) => (oy + f) * CLICK) as Sector['floor']);
        }
        if (o.ceil !== undefined) s.ceil = (oy + o.ceil) * CLICK;
        if (o.mat !== undefined) s.mat = o.mat;
        if (o.flags !== undefined) s.flags = new Set(o.flags);
        if (o.water !== undefined) s.water = (oy + o.water) * CLICK;
      }
    }

    const [sx, sz] = this.toWorld(file, file.start.room, file.start.at);
    this.start = { x: sx, z: sz, dir: file.start.face };
  }

  static parse(json: unknown): Level {
    return new Level(levelSchema.parse(json));
  }

  private toWorld(file: LevelFile, roomId: string, at: [number, number]): [number, number] {
    const room = file.rooms.find((r) => r.id === roomId);
    if (!room) throw new Error(`Unknown room '${roomId}'`);
    return [room.origin[0] + at[0], room.origin[1] + at[1]];
  }

  sector(cx: number, cz: number): Sector | undefined {
    return this.sectors.get(key(cx, cz));
  }

  allSectors(): IterableIterator<Sector> {
    return this.sectors.values();
  }

  roomAt(cx: number, cz: number): RoomInfo | undefined {
    const id = this.sector(cx, cz)?.room;
    return id ? this.rooms.find((r) => r.id === id) : undefined;
  }

  /** Floor height (m) at a world point, interpolating slopes. Walls and outside return +Infinity. */
  floorAt(x: number, z: number): number {
    const cx = Math.floor(x / BLOCK);
    const cz = Math.floor(z / BLOCK);
    const s = this.sector(cx, cz);
    if (!s || s.wall) return Infinity;
    const u = x / BLOCK - cx;
    const v = z / BLOCK - cz;
    const [nw, ne, se, sw] = s.floor;
    const north = nw + (ne - nw) * u;
    const south = sw + (se - sw) * u;
    return north + (south - north) * v;
  }
}

function flat(h: number): [number, number, number, number] {
  return [h, h, h, h];
}

/** Highest corner of a sector's floor. */
export const sectorTop = (s: Sector): number => Math.max(...s.floor);

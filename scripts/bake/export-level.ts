/**
 * Exports a level's static geometry and light rig for the Blender lightmap
 * bake (scripts/bake/bake_lightmap.py). Usage:
 *   tsx scripts/bake/export-level.ts levels/antechamber.level.json out.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Level } from '../../src/sim/grid/level';
import { BLOCK } from '../../src/sim/grid/units';
import { FIRE_BASE, FIRE_GAIN, FIRE_LIGHT_LIFT } from '../../src/render/fire-lights';
import { buildLevelMeshes, mergeSurfaces } from '../../src/render/level-mesh';
import type { LookFile } from '../../src/render/looks';

const [levelPath, outPath] = process.argv.slice(2);
if (!levelPath || !outPath) throw new Error('usage: export-level.ts <level.json> <out.json>');

const root = join(import.meta.dirname, '..', '..');
const level = Level.parse(JSON.parse(readFileSync(levelPath, 'utf8')));
const look = (id: string | null): LookFile | null =>
  id ? (JSON.parse(readFileSync(join(root, 'art', 'looks', `${id}.json`), 'utf8')) as LookFile) : null;

const sunRooms = new Set(level.rooms.filter((r) => look(r.look)?.sun).map((r) => r.id));
const meshes = buildLevelMeshes(level, { skylightRooms: sunRooms });

/** Albedo targets from the art direction (docs/art/README.md). */
const ALBEDO: Record<string, string> = {
  wall: '#b8895a',
  floorStone: '#a08a6c',
  floorSand: '#c8a77c',
  ceiling: '#6d5a47',
  lip: '#cfc5b1',
};

const roomIds = level.rooms.map((r) => r.id);

/**
 * The room each triangle belongs to (index into roomIds, -1 for none): its
 * centroid nudged along its normal into the open cell it faces. The bake
 * lets each room's sun light only that room (Cycles light linking), as the
 * game has one sun at a time, from the room the player is in.
 */
function triangleRooms(
  position: ArrayLike<number>,
  normal: ArrayLike<number>,
  index: ArrayLike<number>,
): number[] {
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    let x = 0;
    let z = 0;
    let nx = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      const i = index[t + k] ?? 0;
      x += (position[i * 3] ?? 0) / 3;
      z += (position[i * 3 + 2] ?? 0) / 3;
      nx += (normal[i * 3] ?? 0) / 3;
      nz += (normal[i * 3 + 2] ?? 0) / 3;
    }
    const room = level.roomAt(Math.floor((x + nx * 0.25) / BLOCK), Math.floor((z + nz * 0.25) / BLOCK));
    out.push(room ? roomIds.indexOf(room.id) : -1);
  }
  return out;
}

const surfaces = Object.fromEntries(
  // A level without some surface (the Cisterns have no sand) merges it to an empty geometry.
  Object.entries(mergeSurfaces(meshes.parts))
    .filter(([, g]) => g.getAttribute('position') !== undefined)
    .map(([name, g]) => {
      const position = g.getAttribute('position').array as Float32Array;
      const index = Array.from(g.getIndex()?.array ?? []);
      return [
        name,
        {
          albedo: ALBEDO[name],
          position: Array.from(position),
          uv1: Array.from(g.getAttribute('uv1').array as Float32Array),
          index,
          rooms: triangleRooms(position, g.getAttribute('normal').array as Float32Array, index),
        },
      ];
    }),
);

const suns = level.rooms
  .map((r) => ({ room: r.id, look: look(r.look) }))
  .filter((r) => r.look?.sun)
  .map((r) => ({ room: r.room, ...(r.look?.sun as NonNullable<LookFile['sun']>) }));

const points: { x: number; y: number; z: number; color: string; candela: number }[] = [];
for (const e of level.entities) {
  if (e.type !== 'brazier' && e.type !== 'relic') continue;
  // A cold brazier is dark until the player lights it: its bounce is not baked in.
  if (e.type === 'brazier' && e.lit === false) continue;
  const x = e.at[0] * BLOCK + BLOCK / 2;
  const z = e.at[1] * BLOCK + BLOCK / 2;
  const room = level.roomAt(e.at[0], e.at[1]);
  const fire = look(room?.look ?? null)?.fire;
  const y = level.floorAt(x, z) + (e.type === 'relic' ? 1.05 : FIRE_BASE + FIRE_LIGHT_LIFT);
  // The runtime drives brazier lights hotter than the look value (scene.ts, FIRE_GAIN); match it.
  const candela = e.type === 'relic' ? 26 : Math.max(fire?.intensity ?? 30, 20) * FIRE_GAIN;
  points.push({ x, y, z, color: fire?.color ?? '#ff9448', candela });
}

writeFileSync(
  outPath,
  JSON.stringify({
    level: level.id,
    lightmapSize: meshes.lightmapSize,
    roomIds,
    surfaces,
    suns,
    skylights: meshes.skylights,
    points,
  }),
);
console.log(
  `wrote ${outPath}: ${meshes.lightmapSize.width}×${meshes.lightmapSize.height}, ${points.length} point lights`,
);

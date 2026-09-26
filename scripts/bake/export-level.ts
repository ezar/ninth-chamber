/**
 * Exports a level's static geometry and light rig for the Blender lightmap
 * bake (scripts/bake/bake_lightmap.py). Usage:
 *   tsx scripts/bake/export-level.ts levels/antechamber.level.json out.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Level } from '../../src/sim/grid/level';
import { BLOCK } from '../../src/sim/grid/units';
import { buildLevelMeshes } from '../../src/render/level-mesh';
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

const surfaces = Object.fromEntries(
  Object.entries(meshes.surfaces).map(([name, g]) => [
    name,
    {
      albedo: ALBEDO[name],
      position: Array.from(g.getAttribute('position').array as Float32Array),
      uv1: Array.from(g.getAttribute('uv1').array as Float32Array),
      index: Array.from(g.getIndex()?.array ?? []),
    },
  ]),
);

const suns = level.rooms
  .map((r) => ({ room: r.id, look: look(r.look) }))
  .filter((r) => r.look?.sun)
  .map((r) => ({ room: r.room, ...(r.look?.sun as NonNullable<LookFile['sun']>) }));

const points: { x: number; y: number; z: number; color: string; candela: number }[] = [];
for (const e of level.entities) {
  if (e.type !== 'brazier' && e.type !== 'relic') continue;
  const x = e.at[0] * BLOCK + BLOCK / 2;
  const z = e.at[1] * BLOCK + BLOCK / 2;
  const room = level.roomAt(e.at[0], e.at[1]);
  const fire = look(room?.look ?? null)?.fire;
  const y = level.floorAt(x, z) + (e.type === 'relic' ? 1.05 : 1.45);
  // The runtime drives brazier lights hotter than the look value (see scene.ts); match it.
  const candela = e.type === 'relic' ? 26 : Math.max(fire?.intensity ?? 30, 20) * 2.5;
  points.push({ x, y, z, color: fire?.color ?? '#ff9448', candela });
}

writeFileSync(
  outPath,
  JSON.stringify({
    level: level.id,
    lightmapSize: meshes.lightmapSize,
    surfaces,
    suns,
    skylights: meshes.skylights,
    points,
  }),
);
console.log(
  `wrote ${outPath}: ${meshes.lightmapSize.width}×${meshes.lightmapSize.height}, ${points.length} point lights`,
);

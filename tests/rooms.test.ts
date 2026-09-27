/**
 * Room visibility (render/rooms.ts): the portal graph of The Antechamber and
 * the portal walk that decides which rooms are drawn.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/antechamber.level.json';
import { buildLevelMeshes, mergeSurfaces } from '../src/render/level-mesh';
import { roomAtPoint, roomGraph, visibleRooms, type Portal } from '../src/render/rooms';
import { Level } from '../src/sim/grid/level';

const level = Level.parse(levelJson);
const graph = roomGraph(level);
const always = (): boolean => true;

/** Portal hops between rooms, breadth first. */
function hops(from: string): Map<string, number> {
  const d = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const r = queue.shift() as string;
    for (const p of graph.portals.get(r) ?? []) {
      if (d.has(p.to)) continue;
      d.set(p.to, (d.get(r) ?? 0) + 1);
      queue.push(p.to);
    }
  }
  return d;
}

describe('room graph', () => {
  it('connects all ten rooms, with every portal matched by one back', () => {
    expect(graph.portals.size).toBe(10);
    expect(hops('entrance').size).toBe(10);
    for (const [room, list] of graph.portals) {
      for (const p of list) {
        expect(p.from).toBe(room);
        expect(graph.portals.get(p.to)?.some((q) => q.to === room)).toBe(true);
      }
    }
  });

  it('puts each portal on the boundary between its two rooms, floor to ceiling', () => {
    for (const list of graph.portals.values()) {
      for (const p of list) {
        const { min, max } = p.box;
        expect(max.y - min.y).toBeGreaterThan(1.5);
        // Flat in one horizontal axis: the shared edge of the cells.
        expect(Math.min(max.x - min.x, max.z - min.z)).toBe(0);
        const mx = (min.x + max.x) / 2;
        const mz = (min.z + max.z) / 2;
        const sides = [
          roomAtPoint(level, mx + 0.5, mz + 0.5),
          roomAtPoint(level, mx - 0.5, mz - 0.5),
          roomAtPoint(level, mx + 0.5, mz - 0.5),
          roomAtPoint(level, mx - 0.5, mz + 0.5),
        ];
        expect(sides).toContain(p.from);
        expect(sides).toContain(p.to);
      }
    }
  });
});

describe('visible rooms', () => {
  it('shows only the starting rooms when no portal is in view', () => {
    expect([...visibleRooms(graph, ['gallery'], () => false)]).toEqual(['gallery']);
    expect(visibleRooms(graph, ['gallery', 'relic'], () => false).size).toBe(2);
  });

  it('reaches no deeper than the portal depth', () => {
    const d = hops('entrance');
    for (const depth of [0, 1, 2, 3]) {
      const seen = visibleRooms(graph, ['entrance'], always, depth);
      const expected = [...d].filter(([, h]) => h <= depth).map(([r]) => r);
      expect([...seen].sort()).toEqual(expected.sort());
    }
  });

  it('only crosses portals the test accepts, and only from rooms already visible', () => {
    const asked: Portal[] = [];
    const seen = visibleRooms(graph, ['entrance'], (p) => {
      asked.push(p);
      return p.to === 'brazier_hall';
    });
    expect([...seen].sort()).toEqual(['brazier_hall', 'entrance']);
    for (const p of asked) expect(seen.has(p.from)).toBe(true);
  });

  it('ignores unknown rooms (a camera outside the level)', () => {
    expect(visibleRooms(graph, ['nowhere'], always).size).toBe(0);
  });
});

describe('level geometry per room', () => {
  const meshes = buildLevelMeshes(level, { skylightRooms: new Set() });

  it('gives every room its own walls and floors', () => {
    for (const r of level.rooms) {
      const surfaces = meshes.parts.filter((p) => p.room === r.id).map((p) => p.surface);
      expect(surfaces).toContain('wall');
      expect(surfaces.some((s) => s === 'floorStone' || s === 'floorSand')).toBe(true);
    }
  });

  it('keeps each part inside its room', () => {
    for (const p of meshes.parts) {
      p.geometry.computeBoundingBox();
      const b = p.geometry.boundingBox;
      if (!b) throw new Error('no bounds');
      const room = level.rooms.find((r) => r.id === p.room);
      if (!room) throw new Error(`unknown room ${p.room}`);
      expect(b.min.x).toBeGreaterThanOrEqual(room.minX * 2 - 0.5);
      expect(b.max.x).toBeLessThanOrEqual(room.maxX * 2 + 0.5);
      expect(b.min.z).toBeGreaterThanOrEqual(room.minZ * 2 - 0.5);
      expect(b.max.z).toBeLessThanOrEqual(room.maxZ * 2 + 0.5);
    }
  });

  it('merges back into the whole level for the lightmap bake', () => {
    const merged = mergeSurfaces(meshes.parts);
    const total = meshes.parts
      .filter((p) => p.surface === 'wall')
      .reduce((a, p) => a + p.geometry.getAttribute('position').count, 0);
    expect(merged.wall.getAttribute('position').count).toBe(total);
  });
});

import { describe, expect, it } from 'vitest';
import levelJson from '../levels/antechamber.level.json';
import { entranceShots, samplePath, type Shot } from '../src/camera/cinematic';
import { Level } from '../src/sim/grid/level';
import { createWorld } from '../src/sim/world';

describe('intro camera', () => {
  const level = Level.parse(levelJson);
  const p = createWorld(level).state.player;
  const shots = entranceShots(level, p.pos, p.yaw);

  it('keeps every key shot inside the start room, off walls and under the ceiling', () => {
    expect(shots.length).toBeGreaterThanOrEqual(3);
    const room = level.roomAt(Math.floor(p.pos.x / 2), Math.floor(p.pos.z / 2));
    for (const { eye } of shots) {
      const s = level.sector(Math.floor(eye.x / 2), Math.floor(eye.z / 2));
      expect(s?.wall).toBe(false);
      expect(s?.room).toBe(room?.id);
      expect(eye.y).toBeLessThan((s?.ceil ?? 0) - 0.3);
      expect(eye.y).toBeGreaterThan(Math.max(...(s?.floor ?? [0])) + 0.3);
    }
  });

  it('ends every shot looking at or near Nora after the first', () => {
    for (const { look } of shots.slice(1))
      expect(Math.hypot(look.x - p.pos.x, look.z - p.pos.z)).toBeLessThan(1);
  });

  it('starts and ends the path on its first and last shots', () => {
    const last: Shot = { eye: { x: 9, y: 3, z: 21.5 }, look: { x: 9, y: 1.45, z: 19 } };
    const path = [...shots, last];
    expect(samplePath(path, 0)).toEqual({ eye: shots[0]?.eye, look: shots[0]?.look });
    const end = samplePath(path, 1);
    expect(end.eye.x).toBeCloseTo(last.eye.x);
    expect(end.eye.z).toBeCloseTo(last.eye.z);
    expect(end.look.y).toBeCloseTo(last.look.y);
  });
});

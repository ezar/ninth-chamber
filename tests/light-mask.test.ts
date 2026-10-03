import { describe, expect, it } from 'vitest';
import { MASK_RES, MASK_SIZE, clearLine, fireMask, maskAtlas, type MaskGrid } from '../src/render/light-mask';
import { BLOCK } from '../src/sim/grid/units';

/**
 * Two rooms side by side, x 0..4 and x 6..10 (cells), z 0..6, with a wall at
 * cell x = 5 and a doorway in it at z = 5. Everything else is outside.
 */
const grid: MaskGrid = {
  open(cx, cz) {
    if (cz < 0 || cz > 6 || cx < 0 || cx > 10) return false;
    if (cx === 5) return cz === 5;
    return true;
  },
};

const at = (cx: number, cz: number): [number, number] => [(cx + 0.5) * BLOCK, (cz + 0.5) * BLOCK];

/** The mask value (0..1) at a world point. */
function sample(mask: ReturnType<typeof fireMask>, x: number, z: number): number {
  const i = Math.floor(((x - mask.originX) / BLOCK) * MASK_RES);
  const j = Math.floor(((z - mask.originZ) / BLOCK) * MASK_RES);
  if (i < 0 || j < 0 || i >= MASK_SIZE || j >= MASK_SIZE) return 0;
  return (mask.data[j * MASK_SIZE + i] ?? 0) / 255;
}

describe('fire light mask', () => {
  it('traces lines in plan through open cells only', () => {
    expect(clearLine(grid, ...at(2, 1), ...at(3, 4))).toBe(true);
    expect(clearLine(grid, ...at(4, 1), ...at(6, 1))).toBe(false);
    expect(clearLine(grid, ...at(4, 5), ...at(7, 5))).toBe(true);
  });

  it('lights the brazier’s room fully and the room behind the wall not at all', () => {
    const [x, z] = at(4, 1);
    const mask = fireMask(grid, x, z);
    expect(sample(mask, ...at(1, 1))).toBe(1);
    expect(sample(mask, ...at(3, 5))).toBe(1);
    // Right behind the wall, in the next room.
    expect(sample(mask, ...at(6, 1))).toBe(0);
    expect(sample(mask, ...at(7, 2))).toBe(0);
  });

  it('lets light spill through the doorway', () => {
    const [x, z] = at(3, 5);
    const mask = fireMask(grid, x, z);
    // Straight through the doorway.
    expect(sample(mask, ...at(7, 5))).toBeGreaterThan(0.9);
    // Off to the side of the opening, out of sight.
    expect(sample(mask, ...at(6, 0))).toBe(0);
  });

  it('keeps the lit face of a wall lit and its far face dark', () => {
    const [x, z] = at(4, 1);
    const mask = fireMask(grid, x, z);
    // Just inside the wall cell on each side (wall x 10..12 m).
    expect(sample(mask, 10.1, 2)).toBeGreaterThan(0.9);
    expect(sample(mask, 11.9, 2)).toBe(0);
  });

  it('packs the masks into one atlas', () => {
    const masks = [fireMask(grid, ...at(1, 1)), fireMask(grid, ...at(8, 1)), fireMask(grid, ...at(2, 4))];
    const atlas = maskAtlas(masks);
    expect(atlas.width).toBe(2 * MASK_SIZE);
    expect(atlas.height).toBe(2 * MASK_SIZE);
    expect(atlas.tiles[2]).toMatchObject({ tileX: 0, tileY: MASK_SIZE });
    const t = atlas.tiles[1];
    const m = masks[1];
    if (!t || !m) throw new Error('missing tile');
    const row = 30;
    expect([
      ...atlas.data.subarray(
        (t.tileY + row) * atlas.width + t.tileX,
        (t.tileY + row) * atlas.width + t.tileX + MASK_SIZE,
      ),
    ]).toEqual([...m.data.subarray(row * MASK_SIZE, (row + 1) * MASK_SIZE)]);
  });
});

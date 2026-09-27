import { describe, expect, it } from 'vitest';
import {
  SHORE_WALL,
  TINT_DEPTH,
  absorption,
  causticTexture,
  causticTriangles,
  flowSign,
  rippleField,
  rippleTexture,
  seeded,
  shoreDistance,
  skylightOpenings,
  transmittance,
} from '../src/render/water-maths';

describe('seeded', () => {
  it('repeats for a seed and stays in [0, 1)', () => {
    const a = seeded(5);
    const b = seeded(5);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rippleField', () => {
  const size = 32;
  const f = rippleField(size, 3, 12, 1.5, 6);

  it('tiles: slopes across the wrap match the slopes inside', () => {
    // Finite differences across the seam agree with the analytic slope as well as inside.
    const at = (x: number, y: number): number =>
      f.h[(((y % size) + size) % size) * size + (((x % size) + size) % size)] ?? 0;
    const errAt = (x: number, y: number): number => {
      const fd = ((at(x + 1, y) - at(x - 1, y)) / 2) * size;
      return Math.abs(fd - (f.du[y * size + x] ?? 0));
    };
    const scale = Math.max(...Array.from(f.du, Math.abs));
    expect(errAt(0, 7)).toBeLessThan(scale * 0.2);
    expect(errAt(size - 1, 7)).toBeLessThan(scale * 0.2);
  });

  it('has analytic slopes that match the height field', () => {
    let err = 0;
    let norm = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const fd = (((f.h[y * size + x + 1] ?? 0) - (f.h[y * size + x - 1] ?? 0)) / 2) * size;
        err += Math.abs(fd - (f.du[y * size + x] ?? 0));
        norm += Math.abs(f.du[y * size + x] ?? 0);
      }
    }
    expect(err / norm).toBeLessThan(0.15);
  });
});

describe('rippleTexture', () => {
  it('encodes slopes around mid grey with an opaque alpha', () => {
    const t = rippleTexture(32, 1);
    let sum = 0;
    for (let i = 0; i < 32 * 32; i++) {
      sum += t.data[i * 4] ?? 0;
      expect(t.data[i * 4 + 3]).toBe(255);
    }
    expect(Math.abs(sum / (32 * 32) - 127.5)).toBeLessThan(12);
    expect(t.slopeScale).toBeGreaterThan(0);
  });
});

describe('causticTexture', () => {
  it('conserves light: the decoded mean intensity is about 1, with bright lines above it', () => {
    const c = causticTexture(64, 2);
    let mean = 0;
    let max = 0;
    for (const v of c.data) {
      const i = (v / 255) ** 2 * c.peak;
      mean += i;
      max = Math.max(max, i);
    }
    mean /= c.data.length;
    expect(mean).toBeGreaterThan(0.8);
    expect(mean).toBeLessThan(1.1);
    expect(max).toBeGreaterThan(2.5);
  });
});

describe('shoreDistance', () => {
  const open = (v = -5): number[] => new Array<number>(8).fill(v);

  it('is far in open water', () => {
    expect(shoreDistance(1, 1, open(), 0, 2)).toBe(10);
  });

  it('measures to a wall edge', () => {
    const tops = open();
    tops[1] = SHORE_WALL; // +x
    expect(shoreDistance(1.5, 1, tops, 0, 2)).toBeCloseTo(0.5);
    tops[3] = SHORE_WALL; // −x
    expect(shoreDistance(0.2, 1, tops, 0, 2)).toBeCloseTo(0.2);
  });

  it('rounds the corner of a pillar standing diagonally', () => {
    const tops = open();
    tops[6] = SHORE_WALL; // +x +z corner
    expect(shoreDistance(1.7, 1.6, tops, 0, 2)).toBeCloseTo(Math.hypot(0.3, 0.4));
  });

  it('counts a step as shore until the water rises over it', () => {
    const tops = open();
    tops[0] = 0.5; // −z neighbour's floor at 0.5 m
    expect(shoreDistance(1, 0.3, tops, 0, 2)).toBeCloseTo(0.3);
    expect(shoreDistance(1, 0.3, tops, 1, 2)).toBe(10);
  });
});

describe('absorption', () => {
  it('keeps the tint after TINT_DEPTH metres and absorbs red first', () => {
    const tint: [number, number, number] = [0.11, 0.34, 0.3];
    const s = absorption(tint);
    const t = transmittance(s, TINT_DEPTH);
    expect(t[0]).toBeCloseTo(0.11);
    expect(t[1]).toBeCloseTo(0.34);
    expect(s[0]).toBeGreaterThan(s[1]);
    // Shallows stay clear.
    expect(Math.min(...transmittance(s, 0.1))).toBeGreaterThan(0.9);
  });

  it('never absorbs a channel completely', () => {
    const s = absorption([0, 1, 0.5]);
    expect(Number.isFinite(s[0])).toBe(true);
    expect(s[1]).toBeGreaterThan(0);
  });
});

describe('flowSign', () => {
  it('follows the gate', () => {
    expect(flowSign(1, 1)).toBe(0);
    expect(flowSign(1, 3)).toBe(1);
    expect(flowSign(3, -1)).toBe(-1);
  });
});

describe('causticTriangles', () => {
  // Two triangles of a wall: one from y 0 to 1, one from y 4 to 5, facing +z.
  const position = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 4, 0, 1, 4, 0, 0, 5, 0];
  const normal = new Array<number>(18).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));

  it('keeps the triangles reaching below the top and lifts them along the normal', () => {
    const out = causticTriangles(position, normal, null, 2, -10, 0.01);
    expect(out.position.length).toBe(9);
    expect(out.position[2]).toBeCloseTo(0.01);
    expect(out.normal[2]).toBe(1);
  });

  it('drops triangles under the bottom and honours the index and the filter', () => {
    expect(causticTriangles(position, normal, null, 10, 3.5).position.length).toBe(9);
    expect(causticTriangles(position, normal, [3, 4, 5], 10, -10).position[1]).toBe(4);
    expect(causticTriangles(position, normal, null, 10, -10, 0.01, () => false).position.length).toBe(0);
  });
});

describe('skylightOpenings', () => {
  it('joins the cells of one opening and keeps separate openings apart', () => {
    const cells = [
      { x: 1, z: 1, ceil: 10 },
      { x: 3, z: 1, ceil: 10 },
      { x: 1, z: 3, ceil: 10 },
      { x: 3, z: 3, ceil: 10 },
      { x: 21, z: 1, ceil: 8 },
    ];
    const o = skylightOpenings(cells, 2);
    expect(o).toHaveLength(2);
    expect(o[0]).toEqual({ minX: 0, minZ: 0, maxX: 4, maxZ: 4, ceil: 10 });
    expect(o[1]).toEqual({ minX: 20, minZ: 0, maxX: 22, maxZ: 2, ceil: 8 });
  });
});

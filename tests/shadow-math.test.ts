import { describe, expect, it } from 'vitest';
import {
  cubeTexel,
  fitOrtho,
  orthoBias,
  perspectiveBiasToWorld,
  perspectiveDepth,
  skylightPrism,
  snap,
  texelBias,
  WINDOW_DEPTH_PAD,
  WINDOW_RIM,
  levelReach,
} from '../src/render/shadow-math';

describe('skylightPrism', () => {
  const cells = [
    { x: 9, z: 11, ceil: 12 },
    { x: 11, z: 11, ceil: 12 },
    { x: 9, z: 13, ceil: 12 },
    { x: 11, z: 13, ceil: 12 },
  ];

  it('covers the opening plus its rim at the ceiling', () => {
    const pts = skylightPrism(cells, 0, { x: 0, y: 1, z: 0 });
    const top = pts.filter((p) => p.y === 12 + WINDOW_DEPTH_PAD);
    expect(Math.min(...top.map((p) => p.x))).toBeCloseTo(8 - WINDOW_RIM);
    expect(Math.max(...top.map((p) => p.x))).toBeCloseTo(12 + WINDOW_RIM);
    expect(Math.min(...top.map((p) => p.z))).toBeCloseTo(10 - WINDOW_RIM);
    expect(Math.max(...top.map((p) => p.z))).toBeCloseTo(14 + WINDOW_RIM);
  });

  it('carries the outline along the light down past the floor', () => {
    const dir = { x: 0.24, y: 0.96, z: -0.14 };
    const pts = skylightPrism(cells, 0, dir);
    const bottom = pts.filter((p) => p.y === -WINDOW_DEPTH_PAD);
    expect(bottom).toHaveLength(4);
    const run = (12 + 2 * WINDOW_DEPTH_PAD) / dir.y;
    // The sun is towards +x, so the patch moves towards -x.
    expect(Math.min(...bottom.map((p) => p.x))).toBeCloseTo(8 - WINDOW_RIM - dir.x * run);
    expect(Math.max(...bottom.map((p) => p.z))).toBeCloseTo(14 + WINDOW_RIM - dir.z * run);
  });

  it('is empty without skylights', () => {
    expect(skylightPrism([], 0, { x: 0, y: 1, z: 0 })).toEqual([]);
  });
});

describe('fitOrtho', () => {
  const pts = [
    { x: -2.1, y: -1, z: -5 },
    { x: 2.3, y: 1.5, z: -30 },
    { x: 0, y: 0.2, z: -12 },
  ];

  it('is square, contains every point and spans their depth', () => {
    const f = fitOrtho(pts, 1024, 0);
    expect(f.right - f.left).toBeCloseTo(f.top - f.bottom);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(f.left);
      expect(p.x).toBeLessThanOrEqual(f.right);
      expect(p.y).toBeGreaterThanOrEqual(f.bottom);
      expect(p.y).toBeLessThanOrEqual(f.top);
    }
    expect(f.near).toBeCloseTo(5);
    expect(f.far).toBeCloseTo(30);
    expect(f.texel).toBeCloseTo((f.right - f.left) / 1024);
  });

  it('snaps its centre to whole texels', () => {
    const f = fitOrtho(pts, 512, 0.3);
    const cx = (f.left + f.right) / 2;
    const cy = (f.top + f.bottom) / 2;
    expect(Math.abs(cx / f.texel - Math.round(cx / f.texel))).toBeLessThan(1e-6);
    expect(Math.abs(cy / f.texel - Math.round(cy / f.texel))).toBeLessThan(1e-6);
  });

  it('moving the points by whole texels moves the frustum by the same texels', () => {
    const a = fitOrtho(pts, 1024);
    const step = a.texel * 7;
    const b = fitOrtho(
      pts.map((p) => ({ ...p, x: p.x + step })),
      1024,
    );
    expect(b.left - a.left).toBeCloseTo(step, 6);
  });

  it('a window a few metres wide is far denser than a whole room', () => {
    const window = fitOrtho(
      [
        { x: -2.6, y: -2.6, z: -1 },
        { x: 2.6, y: 2.6, z: -26 },
      ],
      1024,
    );
    const room = fitOrtho(
      [
        { x: -16, y: -16, z: -1 },
        { x: 16, y: 16, z: -26 },
      ],
      1024,
    );
    expect(window.texel).toBeLessThan(room.texel / 5);
  });
});

describe('biases', () => {
  it('scale with the texel and the filter reach', () => {
    const a = texelBias(0.01, 0);
    const b = texelBias(0.02, 0);
    const c = texelBias(0.01, 2);
    expect(b.normal).toBeCloseTo(a.normal * 2);
    expect(b.depth).toBeCloseTo(a.depth * 2);
    expect(c.normal).toBeGreaterThan(a.normal);
    expect(c.depth).toBeCloseTo(a.depth);
  });

  it('orthographic depth bias is negative and a texel-sized fraction of the depth range', () => {
    const f = { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 26, texel: 6 / 1024 };
    const { bias, normalBias } = orthoBias(f, 1);
    expect(bias).toBeLessThan(0);
    expect(-bias * (f.far - f.near)).toBeCloseTo(texelBias(f.texel, 1).depth);
    expect(normalBias).toBeCloseTo(texelBias(f.texel, 1).normal);
  });

  it('cube texels grow linearly with distance', () => {
    expect(cubeTexel(4, 512)).toBeCloseTo(2 * cubeTexel(2, 512));
    expect(cubeTexel(5, 512)).toBeCloseTo(10 / 512);
  });

  it('the old constant point bias pulled shadows metres off at room scale', () => {
    // bias -0.004 with the fire lights' near 0.5 and far 18.
    const at1 = perspectiveBiasToWorld(-0.004, 1, 0.5, 18);
    const at8 = perspectiveBiasToWorld(-0.004, 8, 0.5, 18);
    expect(at1).toBeLessThan(0.01);
    expect(at8).toBeGreaterThan(0.45);
    expect(at8 / at1).toBeCloseTo(64, 0);
  });

  it('perspectiveDepth maps near to 0 and far to 1', () => {
    expect(perspectiveDepth(0.5, 0.5, 18)).toBeCloseTo(0);
    expect(perspectiveDepth(18, 0.5, 18)).toBeCloseTo(1);
  });

  it('snap rounds to the step', () => {
    expect(snap(0.26, 0.1)).toBeCloseTo(0.3);
    expect(snap(1.234, 0)).toBe(1.234);
  });
});

describe('levelReach', () => {
  // A ledge: floor 2 for x < 1, a drop to 0 beyond.
  const ledge = (x: number): number => (x < 1 ? 2 : 0);

  it('keeps the full reach on open floor and next to higher floors or walls', () => {
    expect(levelReach(() => 0, 0, 0, 0, 0.8)).toBeCloseTo(0.8);
    expect(levelReach((x) => (x > 0.3 ? 5 : 0), 0, 0, 0, 0.8)).toBeCloseTo(0.8);
  });

  it('stops short of a drop', () => {
    const r = levelReach(ledge, 0.5, 0, 2, 0.8);
    expect(r).toBeLessThanOrEqual(0.5);
    expect(r).toBeGreaterThanOrEqual(0.15);
  });

  it('treats a missing floor as a drop', () => {
    expect(levelReach((x) => (x > 0.4 ? -Infinity : 0), 0, 0, 0, 0.8)).toBeLessThan(0.5);
  });
});

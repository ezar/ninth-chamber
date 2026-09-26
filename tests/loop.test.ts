import { describe, expect, it } from 'vitest';
import { FixedStepLoop, MAX_TICKS_PER_FRAME, TICK_DT } from '../src/core/loop';

describe('FixedStepLoop', () => {
  it('runs 60 ticks per simulated second at any framerate', () => {
    for (const fps of [30, 60, 75, 144, 240]) {
      let ticks = 0;
      const loop = new FixedStepLoop(() => ticks++);
      for (let i = 0; i < fps * 10; i++) loop.advance(1 / fps);
      // 10 s at any framerate is 600 ticks (±1 for accumulator rounding).
      expect(Math.abs(ticks - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('accumulates short frames until a tick is due', () => {
    let ticks = 0;
    const loop = new FixedStepLoop(() => ticks++);
    const r1 = loop.advance(TICK_DT * 0.4);
    expect(r1.ticks).toBe(0);
    expect(r1.alpha).toBeCloseTo(0.4, 6);
    const r2 = loop.advance(TICK_DT * 0.7);
    expect(r2.ticks).toBe(1);
    expect(r2.alpha).toBeCloseTo(0.1, 6);
  });

  it('alpha always stays in [0, 1)', () => {
    const loop = new FixedStepLoop(() => {});
    for (let i = 0; i < 1000; i++) {
      const { alpha } = loop.advance(((i * 7919) % 50) / 1000);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it(`runs at most ${MAX_TICKS_PER_FRAME} ticks per frame and drops the rest`, () => {
    let ticks = 0;
    const loop = new FixedStepLoop(() => ticks++);
    const r = loop.advance(1); // a 1 s hitch
    expect(r.ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(r.dropped).toBeGreaterThan(0);
    // After the hitch, the next normal frame is back to one tick.
    expect(loop.advance(TICK_DT).ticks).toBe(1);
  });

  it('ignores negative times', () => {
    const loop = new FixedStepLoop(() => {});
    expect(loop.advance(-1)).toEqual({ ticks: 0, alpha: 0, dropped: 0 });
  });
});

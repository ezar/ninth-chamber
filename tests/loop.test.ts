import { describe, expect, it } from 'vitest';
import { FixedStepLoop, MAX_TICKS_PER_FRAME, TICK_DT } from '../src/core/loop';

describe('FixedStepLoop', () => {
  it('ejecuta 60 ticks por segundo simulado sea cual sea el framerate', () => {
    for (const fps of [30, 60, 75, 144, 240]) {
      let ticks = 0;
      const loop = new FixedStepLoop(() => ticks++);
      for (let i = 0; i < fps * 10; i++) loop.advance(1 / fps);
      // 10 s a cualquier framerate son 600 ticks (±1 por redondeo del acumulador).
      expect(Math.abs(ticks - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('acumula frames cortos hasta completar un tick', () => {
    let ticks = 0;
    const loop = new FixedStepLoop(() => ticks++);
    const r1 = loop.advance(TICK_DT * 0.4);
    expect(r1.ticks).toBe(0);
    expect(r1.alpha).toBeCloseTo(0.4, 6);
    const r2 = loop.advance(TICK_DT * 0.7);
    expect(r2.ticks).toBe(1);
    expect(r2.alpha).toBeCloseTo(0.1, 6);
  });

  it('alpha queda siempre en [0, 1)', () => {
    const loop = new FixedStepLoop(() => {});
    for (let i = 0; i < 1000; i++) {
      const { alpha } = loop.advance(((i * 7919) % 50) / 1000);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it(`no ejecuta más de ${MAX_TICKS_PER_FRAME} ticks por frame y descarta el resto`, () => {
    let ticks = 0;
    const loop = new FixedStepLoop(() => ticks++);
    const r = loop.advance(1); // un tirón de 1 s
    expect(r.ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(r.dropped).toBeGreaterThan(0);
    // Tras el tirón, el siguiente frame normal vuelve a un tick.
    expect(loop.advance(TICK_DT).ticks).toBe(1);
  });

  it('ignora tiempos negativos', () => {
    const loop = new FixedStepLoop(() => {});
    expect(loop.advance(-1)).toEqual({ ticks: 0, alpha: 0, dropped: 0 });
  });
});

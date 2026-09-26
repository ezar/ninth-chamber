import { describe, expect, it } from 'vitest';
import {
  DynamicResolution,
  QUALITY,
  QUALITY_TIERS,
  TierBenchmark,
  heuristicTier,
  lowerTier,
  tierFromFrameTimes,
} from '../src/render/quality';

const desktop = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  coarsePointer: false,
  finePointer: true,
};

/** Feeds `seconds` of frames of `ms` each; returns every change reported. */
function run(drs: DynamicResolution, ms: number, seconds: number): (string | null)[] {
  const out: (string | null)[] = [];
  for (let t = 0; t < seconds; t += ms / 1000) {
    const c = drs.update(ms / 1000);
    if (c) out.push(c);
  }
  return out;
}

describe('quality tiers', () => {
  it('spend less from high to mobile', () => {
    expect(QUALITY_TIERS).toEqual(['high', 'medium', 'mobile']);
    const { high, medium, mobile } = QUALITY;
    expect(high.ambientOcclusion).toBe(true);
    expect(medium.ambientOcclusion).toBe(false);
    expect(mobile.contactShadow).toBe(true);
    expect(high.pixelRatioCap).toBeGreaterThan(medium.pixelRatioCap);
    expect(medium.pixelRatioCap).toBeGreaterThan(mobile.pixelRatioCap);
    expect(high.fireShadows).toBeGreaterThan(medium.fireShadows);
    expect(mobile.fireShadows).toBe(0);
    expect(mobile.sun.live).toBe(false);
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('mobile')).toBe('mobile');
  });

  it('guesses mobile for phones and touch-only screens, medium for small machines', () => {
    expect(heuristicTier(desktop)).toBe('high');
    expect(heuristicTier({ ...desktop, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile' })).toBe(
      'mobile',
    );
    expect(heuristicTier({ ...desktop, coarsePointer: true, finePointer: false })).toBe('mobile');
    expect(heuristicTier({ ...desktop, cores: 4 })).toBe('medium');
    expect(heuristicTier({ ...desktop, memoryGb: 4 })).toBe('medium');
    expect(heuristicTier({ ...desktop, cores: 12, memoryGb: 16 })).toBe('high');
  });
});

describe('first-run benchmark', () => {
  it('keeps a tier that holds 60 fps and steps down otherwise', () => {
    const frames = (ms: number): number[] => Array.from({ length: 180 }, () => ms);
    expect(tierFromFrameTimes(frames(16.7), 'high')).toBe('high');
    expect(tierFromFrameTimes(frames(8.3), 'high')).toBe('high');
    expect(tierFromFrameTimes(frames(25), 'high')).toBe('medium');
    expect(tierFromFrameTimes(frames(50), 'high')).toBe('mobile');
    expect(tierFromFrameTimes(frames(25), 'medium')).toBe('mobile');
    expect(tierFromFrameTimes(frames(90), 'mobile')).toBe('mobile');
  });

  it('is not fooled by a few slow frames', () => {
    const frames = Array.from({ length: 180 }, (_, i) => (i % 20 === 0 ? 40 : 16.7));
    expect(tierFromFrameTimes(frames, 'high')).toBe('high');
  });

  it('runs about 3 s after a warm-up and ignores stalls', () => {
    const b = new TierBenchmark('high');
    b.add(2); // a compile stall during warm-up
    let frames = 0;
    while (!b.add(1 / 60)) frames++;
    expect(frames).toBeGreaterThan(100);
    expect(frames).toBeLessThan(250);
    expect(b.result()).toBe('high');
  });

  it('gives up without a result in a throttled tab', () => {
    const b = new TierBenchmark('high');
    b.add(1);
    for (let i = 0; i < 5; i++) b.add(1.05);
    expect(b.done).toBe(true);
    expect(b.result()).toBeNull();
  });
});

describe('dynamic resolution', () => {
  it('drops a step after a second over 18 ms, down to the floor', () => {
    const drs = new DynamicResolution(0.7);
    expect(run(drs, 16.7, 5)).toEqual([]);
    expect(drs.scale).toBe(1);
    const changes = run(drs, 25, 1.2);
    expect(changes).toEqual(['down']);
    expect(drs.scale).toBeCloseTo(0.9);
    run(drs, 25, 10);
    expect(drs.scale).toBeCloseTo(0.7);
    expect(run(drs, 25, 1.2)).toContain('floor');
  });

  it('ignores single spikes and stalls', () => {
    const drs = new DynamicResolution(0.5);
    for (let i = 0; i < 600; i++) drs.update(i % 30 === 0 ? 0.05 : 1 / 60);
    drs.update(3);
    expect(drs.scale).toBe(1);
  });

  it('recovers slowly, waiting longer after each drop', () => {
    const drs = new DynamicResolution(0.5);
    run(drs, 30, 1.5);
    expect(drs.scale).toBeCloseTo(0.9);
    // The first recovery waits longer than the base delay because a drop doubled it.
    expect(run(drs, 16.7, 4)).toEqual([]);
    expect(run(drs, 16.7, 5)).toEqual(['up']);
    expect(drs.scale).toBeCloseTo(0.95);
    run(drs, 16.7, 20);
    expect(drs.scale).toBe(1);
  });

  it('starts over after a tier change', () => {
    const drs = new DynamicResolution(0.7);
    run(drs, 30, 3);
    expect(drs.scale).toBeLessThan(1);
    drs.reset(0.5);
    expect(drs.scale).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DynamicResolution,
  QUALITY,
  QUALITY_TIERS,
  TierBenchmark,
  MOBILE_DEFAULT_PIXEL_RATIO,
  anisotropyFor,
  autoFloor,
  dynamicResolutionFor,
  heuristicTier,
  lowerTier,
  mobilePixelRatioFromFrameTimes,
  pixelRatioFor,
  tierFromFrameTimes,
} from '../src/render/quality';

describe('smoother phones', () => {
  it('render phones with SMAA, 8× filtering and no grain by default', () => {
    const { mobile } = QUALITY;
    expect(mobile.antialias).toBe('smaa');
    expect(mobile.anisotropy).toBeGreaterThanOrEqual(8);
    expect(mobile.filmGrain).toBe(false);
    expect(QUALITY.high.filmGrain).toBe(true);
  });

  it('let the benchmark raise the pixel ratio on phones that keep up', () => {
    const frames = (ms: number): number[] => Array.from({ length: 180 }, () => ms);
    expect(mobilePixelRatioFromFrameTimes(frames(16.7))).toBe(QUALITY.mobile.pixelRatioCap);
    expect(mobilePixelRatioFromFrameTimes(frames(25))).toBe(1.75);
    expect(mobilePixelRatioFromFrameTimes(frames(33))).toBe(1.5);
    expect(mobilePixelRatioFromFrameTimes(frames(60))).toBe(1.25);
    expect(mobilePixelRatioFromFrameTimes([])).toBe(MOBILE_DEFAULT_PIXEL_RATIO);
  });

  it('report a pixel ratio only from a mobile benchmark', () => {
    const phone = new TierBenchmark('mobile');
    while (!phone.add(1 / 60));
    expect(phone.result()).toBe('mobile');
    expect(phone.pixelRatio()).toBe(QUALITY.mobile.pixelRatioCap);
    const desktop = new TierBenchmark('high');
    while (!desktop.add(1 / 60));
    expect(desktop.pixelRatio()).toBeNull();
  });
});

describe('resolution and filtering options', () => {
  it('maps each resolution mode to a pixel ratio', () => {
    expect(pixelRatioFor('auto', 3, 2)).toBe(2);
    expect(pixelRatioFor('auto', 1, 2)).toBe(1);
    expect(pixelRatioFor('native', 3.5, 2)).toBe(3);
    expect(pixelRatioFor('native', 2, 1.25)).toBe(2);
    expect(pixelRatioFor('75', 2, 1.25)).toBe(1.5);
    expect(pixelRatioFor('50', 3, 2)).toBe(1.5);
    expect(pixelRatioFor('native', Number.NaN, 2)).toBe(1);
  });

  it('keeps dynamic resolution for the automatic mode only', () => {
    expect(dynamicResolutionFor('auto')).toBe(true);
    expect(dynamicResolutionFor('native')).toBe(false);
    expect(dynamicResolutionFor('75')).toBe(false);
  });

  it('takes the tier anisotropy on auto and the chosen level otherwise', () => {
    expect(anisotropyFor('auto', QUALITY.high)).toBe(16);
    expect(anisotropyFor('auto', QUALITY.mobile)).toBe(8);
    expect(anisotropyFor('standard', QUALITY.high)).toBe(4);
    expect(anisotropyFor('high', QUALITY.mobile)).toBe(8);
    expect(anisotropyFor('max', QUALITY.mobile)).toBe(16);
  });
});

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
    // Phones start at a moderate ratio; the benchmark may raise it up to the tier's cap.
    expect(MOBILE_DEFAULT_PIXEL_RATIO).toBeLessThanOrEqual(medium.pixelRatioCap);
    expect(mobile.pixelRatioCap).toBeGreaterThanOrEqual(MOBILE_DEFAULT_PIXEL_RATIO);
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
    // One step at most: a slow first run never jumps from high straight to mobile.
    expect(tierFromFrameTimes(frames(50), 'high')).toBe('medium');
    expect(tierFromFrameTimes(frames(25), 'medium')).toBe('mobile');
    expect(tierFromFrameTimes(frames(90), 'mobile')).toBe('mobile');
  });

  it('never takes a computer below medium by itself', () => {
    const frames = (ms: number): number[] => Array.from({ length: 180 }, () => ms);
    expect(tierFromFrameTimes(frames(50), 'medium', 'medium')).toBe('medium');
    expect(lowerTier('medium', 'medium')).toBe('medium');
    expect(lowerTier('high', 'medium')).toBe('medium');
    expect(lowerTier('medium')).toBe('mobile');
    const desktop = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      coarsePointer: false,
      finePointer: true,
    };
    const phone = {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      coarsePointer: true,
      finePointer: false,
    };
    expect(autoFloor(desktop)).toBe('medium');
    expect(autoFloor(phone)).toBe('mobile');
  });

  it('is not fooled by a few slow frames', () => {
    const frames = Array.from({ length: 180 }, (_, i) => (i % 20 === 0 ? 40 : 16.7));
    expect(tierFromFrameTimes(frames, 'high')).toBe('high');
  });

  it('runs about 3 s after a 2 s warm-up of real frames and ignores stalls', () => {
    const b = new TierBenchmark('high');
    b.add(2); // a compile stall does not count as warm-up
    let frames = 0;
    while (!b.add(1 / 60)) frames++;
    expect(frames).toBeGreaterThan(250);
    expect(frames).toBeLessThan(350);
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

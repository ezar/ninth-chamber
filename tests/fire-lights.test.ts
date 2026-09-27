import { describe, expect, it } from 'vitest';
import { FADE_RATE, FireLightScheduler, SHARE_RATE, type FireSpot } from '../src/render/fire-lights';

/** Six braziers in a hall (like the brazier hall) and two in a gallery further north. */
const fires: FireSpot[] = [
  { x: 3, y: 5, z: -23, room: 'hall' },
  { x: 17, y: 5, z: -23, room: 'hall' },
  { x: 3, y: 5, z: -11, room: 'hall' },
  { x: 17, y: 5, z: -11, room: 'hall' },
  { x: 7, y: 5, z: -25, room: 'hall' },
  { x: 11, y: 5, z: -25, room: 'hall' },
  { x: 3, y: 5, z: -57, room: 'gallery' },
  { x: 21, y: 5, z: -57, room: 'gallery' },
];
const roomAt = (z: number): string => (z > -28 ? 'hall' : 'gallery');
const DT = 1 / 60;

interface Frame {
  plain: { fire: number; level: number }[];
  casters: { fire: number; level: number }[];
}
const copy = (l: Frame): Frame => ({
  plain: l.plain.map((p) => ({ ...p })),
  casters: l.casters.map((c) => ({ ...c })),
});

/** Walks the eye from `from` to `to` (z) over `seconds`, returning every frame. */
function walk(s: FireLightScheduler, from: number, to: number, seconds: number, casters = 2): Frame[] {
  const frames: Frame[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i <= steps; i++) {
    const z = from + ((to - from) * i) / steps;
    const eye = { x: 10, y: 6, z };
    frames.push(copy(s.update(fires, eye, new Set([roomAt(z)]), 6, casters, DT)));
  }
  return frames;
}

function expectSeamless(frames: Frame[]): void {
  const maxStep = (FADE_RATE + SHARE_RATE) * DT + 1e-9;
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1] as Frame;
    const b = frames[f] as Frame;
    for (const kind of ['plain', 'casters'] as const) {
      b[kind].forEach((now, i) => {
        const before = a[kind][i] as { fire: number; level: number };
        if (now.fire !== before.fire) {
          // A light only moves once (all but) dark, and comes up from dark.
          expect(before.level).toBeLessThanOrEqual(maxStep);
          expect(now.level).toBeLessThanOrEqual(maxStep);
        } else {
          expect(Math.abs(now.level - before.level)).toBeLessThanOrEqual(maxStep);
        }
      });
    }
  }
}

describe('fire lights', () => {
  it('fade in and out without pops while walking through the rooms and back', () => {
    const s = new FireLightScheduler({ plain: 8, casters: 2 });
    const frames = [...walk(s, 10, -70, 12), ...walk(s, -70, 10, 12)];
    expectSeamless(frames);
  });

  it('light every brazier of the hall and keep them when standing still', () => {
    const s = new FireLightScheduler({ plain: 8, casters: 2 });
    walk(s, -18, -18, 3);
    for (let i = 0; i < 6; i++) expect(s.total(i)).toBeGreaterThan(0.5);
    const settled = copy(walk(s, -18, -18, 0.5).at(-1) as Frame);
    const later = walk(s, -18, -18, 2).at(-1) as Frame;
    expect(later).toEqual(settled);
  });

  it('prefer the braziers of the current room', () => {
    const s = new FireLightScheduler({ plain: 8, casters: 0 });
    // Standing at the hall's north end: the gallery's braziers are dark.
    walk(s, -27, -27, 3);
    expect(s.total(6)).toBe(0);
    expect(s.total(7)).toBe(0);
  });

  it('do not swap shadow casters back and forth on small moves', () => {
    const s = new FireLightScheduler({ plain: 8, casters: 1 });
    walk(s, -17, -17, 3, 1);
    const owners: number[] = [];
    for (let k = 0; k < 10; k++) {
      const z = k % 2 === 0 ? -16 : -18;
      const frame = walk(s, z, z, 0.3, 1).at(-1) as Frame;
      owners.push(frame.casters[0]?.fire ?? -1);
    }
    expect(new Set(owners).size).toBe(1);
  });

  it('hand shadows back smoothly when casters are no longer allowed', () => {
    const s = new FireLightScheduler({ plain: 8, casters: 2 });
    const frames = [...walk(s, -18, -18, 3, 2), ...walk(s, -18, -18, 2, 0)];
    expectSeamless(frames);
    const last = frames.at(-1) as Frame;
    expect(last.casters.every((c) => c.level === 0)).toBe(true);
  });

  it('never use more lights than the pool has', () => {
    const s = new FireLightScheduler({ plain: 4, casters: 0 });
    const frames = walk(s, 10, -70, 10);
    expectSeamless(frames);
    for (const f of frames) expect(f.plain.length).toBe(4);
  });

  it('gives a cold brazier no light, then fades it in once lit', () => {
    const s = new FireLightScheduler({ plain: 4, casters: 0 });
    const spots: FireSpot[] = [
      { x: 0, y: 1, z: 0, room: 'dark', off: true },
      { x: 4, y: 1, z: 0, room: 'dark' },
    ];
    const eye = { x: 2, y: 2, z: 2 };
    const step = (n: number): void => {
      for (let i = 0; i < n; i++) s.update(spots, eye, new Set(['dark']), 4, 0, DT);
    };
    step(120);
    expect(s.total(0)).toBe(0);
    expect(s.total(1)).toBe(1);
    (spots[0] as FireSpot).off = false;
    step(1);
    expect(s.total(0)).toBeGreaterThan(0);
    expect(s.total(0)).toBeLessThanOrEqual(FADE_RATE * DT + 1e-9);
    step(120);
    expect(s.total(0)).toBe(1);
  });
});

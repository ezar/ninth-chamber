import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { contactWeight, decodeInt16, encodeInt16, inContact, ROT_SCALE } from '../src/render/anim/clip';
import { JOINT_COUNT } from '../src/render/anim/skeleton';
import { tuning } from '../src/sim/player/tuning';
import { loadClip, LocomotionProbe, plantedSlide } from '../scripts/anim/locomotion-probe';

describe('motion clip data', () => {
  it('round-trips int16 base64 data', () => {
    const v = [0, 0.5, -0.25, 1, -1, 0.123456];
    const back = decodeInt16(encodeInt16(v, ROT_SCALE), ROT_SCALE);
    v.forEach((x, i) => expect(back[i]).toBeCloseTo(x, 4));
  });

  it('handles contact intervals that wrap around the loop', () => {
    const c: [number, number][] = [[0.9, 0.2]];
    expect(inContact(c, 0.95)).toBe(true);
    expect(inContact(c, 0.1)).toBe(true);
    expect(inContact(c, 0.5)).toBe(false);
    expect(contactWeight(c, 0.25, 0.1)).toBeCloseTo(0.5, 5);
    expect(contactWeight(c, 0.5, 0.1)).toBe(0);
  });

  for (const name of ['idle', 'walk', 'run']) {
    it(`${name} decodes to unit quaternions and loops seamlessly`, () => {
      const clip = loadClip(name);
      expect(clip.loop).toBe(true);
      const rot: THREE.Quaternion[] = [];
      const hips = new THREE.Vector3();
      const first: THREE.Quaternion[] = [];
      clip.samplePhase(0, first, new THREE.Vector3());
      for (let i = 0; i < clip.frames; i++) {
        clip.samplePhase(i / clip.frames, rot, hips);
        expect(rot).toHaveLength(JOINT_COUNT);
        for (const q of rot) expect(q.length()).toBeCloseTo(1, 5);
        expect(hips.y).toBeGreaterThan(0.6);
      }
      // Just before the end blends back into the first frame.
      clip.samplePhase(0.9999, rot, hips);
      rot.forEach((q, j) => expect(q.angleTo(first[j] ?? q)).toBeLessThan(0.01));
    });
  }

  it('walk and run are phase-aligned at the left heel strike', () => {
    for (const name of ['walk', 'run']) {
      const clip = loadClip(name);
      expect(clip.speed).toBeGreaterThan(0);
      expect(inContact(clip.contacts.L, 0.01)).toBe(true);
      expect(inContact(clip.contacts.L, 0.99)).toBe(false);
      expect(inContact(clip.contacts.R, 0.51)).toBe(true);
      expect(inContact(clip.contacts.R, 0.49)).toBe(false);
    }
  });
});

describe('ground locomotion', () => {
  const probe = new LocomotionProbe();

  it('keeps planted feet still while walking and running', () => {
    for (const speed of [tuning.walkSpeed, tuning.runSpeed]) {
      const samples = probe.run({ speed: () => speed, seconds: 3 });
      expect(plantedSlide(samples, 1)).toBeLessThan(0.1);
    }
  });

  it('keeps the soles on or above the floor', () => {
    for (const speed of [0, tuning.walkSpeed, tuning.runSpeed]) {
      // After the first cross-fade from the procedural pose.
      const samples = probe.run({ speed: () => speed, seconds: 2 }).filter((s) => s.t > 0.3);
      for (const s of samples)
        for (const f of s.feet) {
          expect(f.heel.y).toBeGreaterThan(-0.005);
          expect(f.ball.y).toBeGreaterThan(-0.005);
        }
    }
  });

  it('stands still when idle and settles after stopping', () => {
    const samples = probe.run({ speed: (t) => (t < 1.5 ? tuning.runSpeed : 0), seconds: 4 });
    const end = samples.filter((s) => s.t > 3.5);
    expect(plantedSlide(end, 0)).toBeLessThan(0.01);
    for (const s of end) for (const f of s.feet) expect(Math.min(f.heel.y, f.ball.y)).toBeLessThan(0.01);
  });

  it('walks with bent but not buckled knees', () => {
    const samples = probe.run({ speed: () => tuning.walkSpeed, seconds: 3 }).filter((s) => s.t > 1);
    const hips = samples.map((s) => s.hipsY);
    expect(Math.min(...hips)).toBeGreaterThan(0.8);
    const knees = samples.flatMap((s) => s.feet.map((f) => f.knee));
    expect(Math.max(...knees)).toBeLessThan(1.7);
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { contactWeight, decodeInt16, encodeInt16, inContact, ROT_SCALE } from '../src/render/anim/clip';
import { JOINT_COUNT } from '../src/render/anim/skeleton';
import { swimming, tuning } from '../src/sim/player/tuning';
import { CLIP_NAMES, NoraAnimator, WATER_CLIPS, type ClipName } from '../src/render/anim/animator';
import { AnimPose } from '../src/render/anim/pose';
import type { NoraPose } from '../src/render/nora';
import { loadClip, LocomotionProbe, plantedSlide } from '../scripts/anim/locomotion-probe';

const loops = new Set([
  'idle',
  'walk',
  'run',
  'walk_back',
  'fall',
  'hang',
  'shimmy_left',
  'shimmy_right',
  'push',
  'pull',
  'pistol_idle',
  'pistol_run',
  'tread',
  'swim',
  'wall_idle',
  'wall_up',
  'wall_down',
  'wall_left',
  'wall_right',
]);

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

  for (const name of CLIP_NAMES) {
    it(`${name} decodes to unit quaternions${loops.has(name) ? ' and loops seamlessly' : ''}`, () => {
      const clip = loadClip(name);
      expect(clip.loop).toBe(loops.has(name));
      const rot: THREE.Quaternion[] = [];
      const hips = new THREE.Vector3();
      const first: THREE.Quaternion[] = [];
      clip.samplePhase(0, first, new THREE.Vector3());
      for (let i = 0; i < clip.frames; i++) {
        clip.samplePhase(i / clip.frames, rot, hips);
        expect(rot).toHaveLength(JOINT_COUNT);
        for (const q of rot) expect(q.length()).toBeCloseTo(1, 5);
        // Hips stay near a plausible height (dying ends on the floor).
        expect(hips.y).toBeGreaterThan(name === 'die' ? 0 : 0.5);
        expect(hips.y).toBeLessThan(3);
      }
      if (!clip.loop) return;
      // Just before the end blends back into the first frame.
      clip.samplePhase(0.9999, rot, hips);
      rot.forEach((q, j) => expect(q.angleTo(first[j] ?? q)).toBeLessThan(0.01));
    });
  }

  it('walk and run are phase-aligned at the left heel strike', () => {
    for (const name of ['walk', 'run']) {
      const clip = loadClip(name);
      expect(clip.speed).toBeGreaterThan(0);
      // The left foot lands at phase 0 and the right one half a cycle later.
      expect(inContact(clip.contacts.L, 0.01)).toBe(true);
      expect(inContact(clip.contacts.L, 0.97)).toBe(false);
      const r = clip.contacts.R[0]?.[0] ?? 0;
      expect(r).toBeGreaterThan(0.4);
      expect(r).toBeLessThan(0.6);
    }
  });
});

describe('clip metadata', () => {
  it('matches clip speeds to the game', () => {
    expect(loadClip('walk').speed).toBeGreaterThan(1);
    expect(loadClip('run').speed).toBeGreaterThan(3);
    expect(loadClip('walk_back').speed).toBeLessThan(0);
    expect(Math.abs(loadClip('shimmy_left').speed)).toBeGreaterThan(0.2);
  });

  it('marks take-off and landing in the jump clips', () => {
    for (const name of ['jump', 'jump_run']) {
      const e = loadClip(name).events;
      expect(e.takeoff).toBeDefined();
      expect(e.touchdown ?? 0).toBeGreaterThan(e.takeoff ?? 0);
    }
    expect(loadClip('land').events.touchdown).toBeDefined();
  });

  it('starts hanging clips with the hands on the ledge and ends the climb on top', () => {
    const climb = loadClip('climb');
    const end = climb.rootEnd;
    expect(end).not.toBeNull();
    // The simulation climbs 2 m (hands 2 m above the feet while hanging).
    expect(end?.y ?? 0).toBeGreaterThan(1.7);
    expect(end?.y ?? 0).toBeLessThan(2.3);
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

describe('Nora in the water', () => {
  const probe = new LocomotionProbe();
  const names: ClipName[] = ['idle', 'walk', 'run', 'climb', ...Object.values(WATER_CLIPS)];
  const clips = Object.fromEntries(names.map((n) => [n, loadClip(n)]));
  const pose = (over: Partial<NoraPose>): NoraPose => ({
    mode: 'swim',
    modeTime: 0,
    speed: 0,
    vy: 0,
    climbT: 0,
    health: 100,
    weapons: 0,
    aiming: 0,
    aimYaw: 0,
    aimPitch: 0,
    ...over,
  });
  /** Plays a sequence of poses at 60 Hz; returns the shown pose and the head's height over the root. */
  function play(steps: NoraPose[]): { out: AnimPose; head: number; hips: number } {
    const sk = probe.sk;
    const anim = new NoraAnimator(sk, {
      ...clips,
      idle: loadClip('idle'),
      walk: loadClip('walk'),
      run: loadClip('run'),
    });
    const proc = new AnimPose();
    proc.hips.copy(sk.hipsBind);
    const out = new AnimPose();
    for (const p of steps) anim.update(p, 1 / 60, proc, new THREE.Vector3(), 0, out);
    const pos: THREE.Vector3[] = [];
    sk.positions(out.rot, out.hips, pos);
    const head = Math.max(...pos.map((v) => v.y));
    return { out, head, hips: out.hips.y };
  }
  const hold = (p: NoraPose, seconds: number): NoraPose[] =>
    Array.from({ length: Math.round(seconds * 60) }, (_, i) => ({ ...p, modeTime: i / 60 }));

  it('treads water with the head out when still at the surface', () => {
    const { head } = play(hold(pose({}), 1.5));
    // The root is `surfaceSink` under the surface: the top of her head clears it.
    expect(head).toBeGreaterThan(swimming.surfaceSink);
    expect(head).toBeLessThan(swimming.surfaceSink + 0.6);
  });

  it('swims lying along the surface when moving', () => {
    const { head, hips } = play(hold(pose({ speed: swimming.swimSpeed }), 1.5));
    expect(hips).toBeGreaterThan(swimming.surfaceSink - 0.3);
    // Lying down: nothing rises far above the water.
    expect(head).toBeLessThan(swimming.surfaceSink + 0.45);
  });

  it('pitches the body with the dive and keeps it centred on the collision cylinder', () => {
    const level = play(hold(pose({ mode: 'dive', speed: swimming.diveSpeed, pitch: 0 }), 1.5)).out;
    const down = play(hold(pose({ mode: 'dive', speed: swimming.diveSpeed, pitch: -0.9 }), 1.5)).out;
    expect(level.hips.y).toBeCloseTo(tuning.height / 2, 3);
    // The hips turn by the pitch (model-space rotations rotated about X).
    expect(level.q(0).angleTo(down.q(0))).toBeGreaterThan(0.6);
  });

  it('climbs out of the water from the edge reach into the climb', () => {
    const swim = hold(pose({}), 0.5);
    const climb = Array.from({ length: 66 }, (_, i) =>
      pose({ mode: 'climb', climbT: i / 65, modeTime: i / 60 }),
    );
    const mid = play([...swim, ...climb.slice(0, 10)]).out;
    const end = play([...swim, ...climb]).out;
    const plainClimb = new AnimPose();
    loadClip('climb').samplePhase(0.999, plainClimb.rot, plainClimb.hips);
    // It ends like a land climb (crouched on the edge) and starts differently (reaching).
    expect(end.q(0).angleTo(plainClimb.q(0))).toBeLessThan(0.05);
    expect(mid.q(JOINT_COUNT - 1).angleTo(end.q(JOINT_COUNT - 1))).toBeGreaterThan(0.05);
  });
});

describe('Nora on a wall of roots', () => {
  const probe = new LocomotionProbe();
  const names: ClipName[] = [
    'idle',
    'walk',
    'run',
    'wall_idle',
    'wall_up',
    'wall_down',
    'wall_left',
    'wall_right',
  ];
  const clips = Object.fromEntries(names.map((n) => [n, loadClip(n)]));
  const pose = (mode: NoraPose['mode']): NoraPose => ({
    mode,
    modeTime: 0,
    speed: 0,
    vy: 0,
    climbT: 0,
    health: 100,
    weapons: 0,
    aiming: 0,
    aimYaw: 0,
    aimPitch: 0,
  });
  /** Plays root positions at 60 Hz (on the ground until `attach`, on the wall after); returns every shown pose. */
  function play(roots: THREE.Vector3[], attach: number, missing?: ClipName): AnimPose[] {
    const anim = new NoraAnimator(probe.sk, {
      ...clips,
      ...(missing ? { [missing]: undefined } : {}),
      idle: loadClip('idle'),
      walk: loadClip('walk'),
      run: loadClip('run'),
    });
    const proc = new AnimPose();
    proc.hips.copy(probe.sk.hipsBind);
    return roots.map((r, i) => {
      const out = new AnimPose();
      anim.update(pose(i < attach ? 'ground' : 'wall'), 1 / 60, proc, r, 0, out);
      return out;
    });
  }
  /** The largest turn of any joint between two frames (rad). */
  const step = (a: AnimPose, b: AnimPose): number =>
    Math.max(...Array.from({ length: JOINT_COUNT }, (_, j) => a.q(j).angleTo(b.q(j))));

  it('holds still on the face after the attach snap', () => {
    const still = Array.from({ length: 60 }, () => new THREE.Vector3());
    // From the ground the root is raised 0.15 m on the frame she takes hold.
    const snapped = still.map((v, i) => (i < 20 ? v.clone() : new THREE.Vector3(0, 0.15, 0)));
    const a = play(still, 20);
    const b = play(snapped, 20);
    a.forEach((p, i) => expect(step(p, b[i] ?? p)).toBeLessThan(1e-6));
  });

  /** Climbing up at 0.6 m/s for a second, then straight to the right at 0.28 m/s. */
  function upThenRight(): THREE.Vector3[] {
    const roots: THREE.Vector3[] = [];
    const at = new THREE.Vector3();
    for (let i = 0; i < 120; i++) {
      roots.push(at.clone());
      if (i < 60) at.y += 0.6 / 60;
      else at.x += 0.28 / 60;
    }
    return roots;
  }
  /** The largest frame-to-frame turn over frames [from, to]. */
  const largest = (shown: AnimPose[], from: number, to: number): number =>
    Math.max(...shown.slice(from, to).map((p, i) => step(p, shown[from + i + 1] ?? p)));

  it('cross-fades between climbing directions', () => {
    const shown = play(upThenRight(), 0);
    expect(largest(shown, 55, 90)).toBeLessThan(largest(shown, 30, 59) * 2);
  });

  it('fades to the idle when the clip of the new direction is missing', () => {
    const shown = play(upThenRight(), 0, 'wall_right');
    expect(largest(shown, 55, 90)).toBeLessThan(largest(shown, 30, 59) * 2);
    // Moving right with no clip for it: the idle, as if still.
    const still = play(
      Array.from({ length: 120 }, () => new THREE.Vector3()),
      0,
    );
    // Half a second on, the climb up has faded as it would into the idle (about e^-4 of it left).
    const half = shown[90];
    const idle = still[90];
    expect(half && idle && step(half, idle)).toBeLessThan(0.06);
    const last = shown.at(-1);
    const end = still.at(-1);
    expect(last && end && step(last, end)).toBeLessThan(1e-3);
  });
});

/**
 * Drives Nora's clip animator headlessly (no renderer) along a scripted path
 * and measures what the feet do. Used by tests/anim.test.ts and by
 * scripts/anim/simulate.ts when tuning.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three/webgpu';
import { NoraAnimator } from '../../src/render/anim/animator';
import { Clip, type ClipFile } from '../../src/render/anim/clip';
import { AnimPose } from '../../src/render/anim/pose';
import { JOINT_INDEX, type ScanSkeleton } from '../../src/render/anim/skeleton';
import type { NoraPose } from '../../src/render/nora';
import { loadSkeleton, REPO } from './nora-skeleton';

export function loadClip(name: string): Clip {
  return new Clip(JSON.parse(readFileSync(join(REPO, 'public', 'anim', `${name}.json`), 'utf8')) as ClipFile);
}

export interface FootSample {
  /** World position of the ankle. */
  ankle: THREE.Vector3;
  /** World positions of the heel and the ball of the foot. */
  heel: THREE.Vector3;
  ball: THREE.Vector3;
  /** Knee flexion (rad). */
  knee: number;
}

export interface Sample {
  t: number;
  speed: number;
  hipsY: number;
  feet: [FootSample, FootSample];
}

export interface ProbeOptions {
  /** Target speed over time (m/s). */
  speed: (t: number) => number;
  /** Heading over time (rad), 0 = towards -Z. */
  yaw?: (t: number) => number;
  seconds: number;
  dt?: number;
}

export class LocomotionProbe {
  readonly sk: ScanSkeleton;
  private readonly clips = { idle: loadClip('idle'), walk: loadClip('walk'), run: loadClip('run') };

  constructor() {
    this.sk = loadSkeleton();
  }

  run(o: ProbeOptions): Sample[] {
    const sk = this.sk;
    const anim = new NoraAnimator(sk, this.clips);
    const proc = new AnimPose();
    proc.hips.copy(sk.hipsBind);
    const out = new AnimPose();
    const root = new THREE.Vector3();
    const pos: THREE.Vector3[] = [];
    const dt = o.dt ?? 1 / 60;
    const up = new THREE.Vector3(0, 1, 0);
    let v = 0;
    const samples: Sample[] = [];
    for (let i = 0; i * dt < o.seconds; i++) {
      const t = i * dt;
      const yaw = o.yaw?.(t) ?? 0;
      // The game's acceleration: 12/s towards the target speed.
      v += (o.speed(t) - v) * (1 - Math.exp(-12 * dt));
      root.x -= Math.sin(yaw) * v * dt;
      root.z -= Math.cos(yaw) * v * dt;
      const pose: NoraPose = {
        mode: 'ground',
        modeTime: t,
        speed: v,
        vy: 0,
        climbT: 0,
        health: 100,
        weapons: 0,
        aiming: 0,
        aimYaw: 0,
        aimPitch: 0,
      };
      anim.update(pose, dt, proc, root, yaw, out);
      sk.positions(out.rot, out.hips, pos);
      const foot = (s: 'L' | 'R'): FootSample => {
        const toWorld = (p: THREE.Vector3): THREE.Vector3 => p.clone().applyAxisAngle(up, yaw).add(root);
        const a = pos[JOINT_INDEX[`foot_${s}`]] ?? new THREE.Vector3();
        const q = out.rot[JOINT_INDEX[`foot_${s}`]] ?? new THREE.Quaternion();
        const heel = sk.heel.clone().applyQuaternion(q).add(a);
        const ball = sk.ball.clone().applyQuaternion(q).add(a);
        const th = pos[JOINT_INDEX[`thigh_${s}`]] ?? a;
        const kn = pos[JOINT_INDEX[`shin_${s}`]] ?? a;
        const knee = kn.clone().sub(th).angleTo(a.clone().sub(kn));
        return { ankle: toWorld(a), heel: toWorld(heel), ball: toWorld(ball), knee };
      };
      samples.push({ t, speed: v, hipsY: out.hips.y, feet: [foot('L'), foot('R')] });
    }
    return samples;
  }
}

/**
 * Largest horizontal speed (m/s) of a sole point while it is on the floor
 * (below `floor` m), after `after` seconds: how much planted feet slide.
 */
export function plantedSlide(samples: Sample[], after: number, floor = 0.01): number {
  let worst = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b || b.t < after) continue;
    const dt = b.t - a.t;
    for (let s = 0; s < 2; s++) {
      for (const k of ['heel', 'ball'] as const) {
        const pa = a.feet[s]?.[k];
        const pb = b.feet[s]?.[k];
        if (!pa || !pb || pa.y > floor || pb.y > floor) continue;
        worst = Math.max(worst, Math.hypot(pb.x - pa.x, pb.z - pa.z) / dt);
      }
    }
  }
  return worst;
}

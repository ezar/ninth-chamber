/**
 * Motion clips baked by scripts/anim/build-clips.ts (public/anim/*.json):
 * per-frame canonical model-space joint rotations (see skeleton.ts) and the
 * hips position, quantised to int16 and stored as base64.
 */
import * as THREE from 'three/webgpu';
import type { RetargetJoint } from '../nora';
import { JOINTS, JOINT_COUNT } from './skeleton';

/** Foot contact intervals as [start, end) in normalised phase; end < start wraps around. */
export type Contacts = [number, number][];

export interface ClipFile {
  format: 'nora-clip@1';
  name: string;
  /** Where the motion comes from (for credits). */
  source: string;
  fps: number;
  frames: number;
  loop: boolean;
  /** Ground speed of the clip scaled to Nora's leg length (m/s); 0 for in-place clips. */
  speed: number;
  contacts: { L: Contacts; R: Contacts };
  joints: RetargetJoint[];
  /** Int16 quaternions (x, y, z, w) × 32767, frames × joints × 4. */
  rotations: string;
  /** Int16 hips positions in millimetres, frames × 3. */
  hips: string;
  /** Where the root ends up, for clips that keep their travel (m, model space). */
  rootEnd?: [number, number, number];
  /** Take-off and touch-down times of one-shot clips (s). */
  events?: { takeoff?: number; touchdown?: number };
}

export const ROT_SCALE = 32767;
export const POS_SCALE = 1000;

export function encodeInt16(values: ArrayLike<number>, scale: number): string {
  const a = new Int16Array(values.length);
  for (let i = 0; i < values.length; i++)
    a[i] = Math.max(-32768, Math.min(32767, Math.round((values[i] ?? 0) * scale)));
  const bytes = new Uint8Array(a.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
  return btoa(s);
}

export function decodeInt16(b64: string, scale: number): Float32Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const a = new Int16Array(bytes.buffer);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) / scale;
  return out;
}

/** True when phase p (0..1) lies in one of the contact intervals. */
export function inContact(contacts: Contacts, p: number): boolean {
  for (const [a, b] of contacts) {
    if (a <= b ? p >= a && p < b : p >= a || p < b) return true;
  }
  return false;
}

/**
 * Contact weight at phase p: 1 inside an interval, easing to 0 over `ramp`
 * (phase units) on either side so locks engage and release smoothly.
 */
export function contactWeight(contacts: Contacts, p: number, ramp: number): number {
  let w = 0;
  for (const [a, b] of contacts) {
    const len = (b - a + 1) % 1 || 1;
    const x = (p - a + 1) % 1; // phase since the interval start
    if (x < len) {
      w = 1;
      break;
    }
    const after = x - len; // phase since the interval end
    const before = 1 - x; // phase until the interval start
    const d = Math.min(after, before);
    if (ramp > 0 && d < ramp) w = Math.max(w, 1 - d / ramp);
  }
  return w;
}

/** A decoded clip, sampled by time or normalised phase. */
export class Clip {
  readonly name: string;
  readonly fps: number;
  readonly frames: number;
  readonly loop: boolean;
  readonly speed: number;
  readonly duration: number;
  readonly contacts: { L: Contacts; R: Contacts };
  readonly rootEnd: THREE.Vector3 | null;
  readonly events: { takeoff?: number; touchdown?: number };
  private readonly rot: Float32Array;
  private readonly hips: Float32Array;
  /** Maps clip joint order to skeleton joint order. */
  private readonly map: number[];

  constructor(file: ClipFile) {
    if (file.format !== 'nora-clip@1') throw new Error(`clip ${file.name}: unknown format`);
    this.name = file.name;
    this.fps = file.fps;
    this.frames = file.frames;
    this.loop = file.loop;
    this.speed = file.speed;
    this.contacts = file.contacts;
    this.rootEnd = file.rootEnd ? new THREE.Vector3(...file.rootEnd) : null;
    this.events = file.events ?? {};
    // A loop's last frame wraps to the first, so it lasts `frames` frames.
    this.duration = (file.loop ? file.frames : file.frames - 1) / file.fps;
    this.rot = decodeInt16(file.rotations, ROT_SCALE);
    this.hips = decodeInt16(file.hips, POS_SCALE);
    this.map = JOINTS.map((j) => file.joints.indexOf(j));
    if (this.map.some((i) => i < 0)) throw new Error(`clip ${file.name}: missing joints`);
    if (this.rot.length !== file.frames * file.joints.length * 4 || this.hips.length !== file.frames * 3)
      throw new Error(`clip ${file.name}: bad data size`);
  }

  /** Samples the pose at normalised phase p (0..1 over the clip). */
  samplePhase(p: number, rot: THREE.Quaternion[], hips: THREE.Vector3): void {
    const n = this.frames;
    let f: number;
    if (this.loop) f = (((p % 1) + 1) % 1) * n;
    else f = Math.min(1, Math.max(0, p)) * (n - 1);
    const i0 = Math.min(n - 1, Math.floor(f));
    const i1 = this.loop ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
    const t = f - i0;
    const jn = this.map.length;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const c = this.map[j] ?? 0;
      const a = (i0 * jn + c) * 4;
      const b = (i1 * jn + c) * 4;
      const r = this.rot;
      const ax = r[a] ?? 0;
      const ay = r[a + 1] ?? 0;
      const az = r[a + 2] ?? 0;
      const aw = r[a + 3] ?? 1;
      let bx = r[b] ?? 0;
      let by = r[b + 1] ?? 0;
      let bz = r[b + 2] ?? 0;
      let bw = r[b + 3] ?? 1;
      if (ax * bx + ay * by + az * bz + aw * bw < 0) {
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
      }
      const q = rot[j] ?? (rot[j] = new THREE.Quaternion());
      q.set(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, aw + (bw - aw) * t).normalize();
    }
    const h = this.hips;
    hips.set(
      (h[i0 * 3] ?? 0) + ((h[i1 * 3] ?? 0) - (h[i0 * 3] ?? 0)) * t,
      (h[i0 * 3 + 1] ?? 0) + ((h[i1 * 3 + 1] ?? 0) - (h[i0 * 3 + 1] ?? 0)) * t,
      (h[i0 * 3 + 2] ?? 0) + ((h[i1 * 3 + 2] ?? 0) - (h[i0 * 3 + 2] ?? 0)) * t,
    );
  }

  /** Samples the pose at time t (seconds); loops wrap, one-shots clamp. */
  sample(t: number, rot: THREE.Quaternion[], hips: THREE.Vector3): void {
    this.samplePhase(t / this.duration, rot, hips);
  }
}

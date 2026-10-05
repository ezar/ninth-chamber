/**
 * Bakes Nora's motion clips (public/anim/*.json) from a source animation set
 * onto the canonical 19-joint space of src/render/anim/skeleton.ts.
 *
 * Usage:
 *   pnpm anim:build <manifest.json> <source folder> [outDir]
 *
 * The manifest (scripts/anim/sources/*.json) names the source skeleton
 * (a profile in rigs.ts: "ual" for the Quaternius Universal Animation
 * Library, "mixamo" for Mixamo), the reference pose and the clips to bake;
 * its file names are relative to the source folder. Sources are glTF binaries
 * (convert FBX with scripts/anim/fbx_to_glb.py). See docs/animation.md.
 *
 * Retargeting: every source joint's model-space rotation is taken relative to
 * the reference pose (a T-pose) and re-applied to Nora's canonical rest pose,
 * so each limb points exactly where the source limb points, and the pelvis,
 * spine, head and feet carry the source's twist. The source's facing is found
 * from its hips. The hips keep their vertical bob and sway, scaled to Nora's
 * leg length. Loops are made seamless; gait loops are rotated so that phase 0
 * is the left heel strike, which keeps walk and run phase-aligned for blending.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three/webgpu';
import { encodeInt16, POS_SCALE, ROT_SCALE, type ClipFile, type Contacts } from '../../src/render/anim/clip';
import {
  JOINTS,
  JOINT_COUNT,
  JOINT_INDEX,
  LIMB_END,
  type ScanSkeleton,
} from '../../src/render/anim/skeleton';
import type { RetargetJoint } from '../../src/render/nora';
import { Fbx, type SourceFile } from './fbx';
import { Gltf, worldMatrices, type Trs } from './gltf';
import { loadSkeleton, REPO } from './nora-skeleton';
import { RIGS, type SourceRig } from './rigs';

const FPS = 30;

interface ClipSpec {
  /** Output name (public/anim/<name>.json). */
  name: string;
  /** Source file, relative to the source folder. */
  file: string;
  /** Animation name in the file; the first one when omitted (Mixamo files hold one). */
  anim?: string;
  loop: boolean;
  /** A walk or run cycle: rotate it to start at the left heel strike. */
  gait?: boolean;
  /** Ground speed of the clip as recorded (m/s), for in-place clips... */
  speed?: number;
  /** ... or measured from a root-motion copy of the same animation. */
  speedFrom?: { file: string; anim?: string; node: string };
  /** Keep only this part of the animation (s). */
  from?: number;
  to?: number;
  /**
   * Travel baked into the clip: "remove" (default) takes out the steady
   * horizontal travel (and measures the clip's speed from it); "keep" leaves
   * it and records where the root ends up (rootEnd), for moves the runtime
   * lines up with the simulation (climb, death).
   */
  rootMotion?: 'remove' | 'keep';
  /**
   * "hands": place the clip so its hands start where the hanging Nora grips the ledge;
   * "wall": so its hands, on average, are where the climbing Nora holds the face.
   */
  anchor?: 'hands' | 'wall';
  /**
   * A climbing loop on a wall: its travel up, down or along the face is taken out too, and
   * its speed is measured along that travel (the runtime matches it to the climbing speed).
   */
  climb?: boolean;
}

/** Where the procedural rig grips a ledge while hanging (wrist, model space; nora.ts evalHang). */
const HANG_WRIST = new THREE.Vector3(0, 1.925, -0.285);
/** Where the procedural rig's hands hold a wall of roots, on average (nora.ts evalWall). */
const WALL_HANDS = new THREE.Vector3(0, 1.72, -0.29);

interface Manifest {
  rig: string;
  source: string;
  /** Reference T-pose: an animation's first frame, or the file's rest pose when `anim` is omitted. */
  rest: { file: string; anim?: string };
  clips: ClipSpec[];
}

const [manifestPath, srcDir, outArg] = process.argv.slice(2);
if (!manifestPath || !srcDir)
  throw new Error('usage: build-clips.ts <manifest.json> <source folder> [outDir]');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const rigProfile = RIGS[manifest.rig];
if (!rigProfile) throw new Error(`unknown rig '${manifest.rig}' (known: ${Object.keys(RIGS).join(', ')})`);
const rig: SourceRig = rigProfile;
const outDir = outArg ?? join(REPO, 'public', 'anim');

const files = new Map<string, SourceFile>();
function gltf(file: string): SourceFile {
  let g = files.get(file);
  if (!g) {
    const path = join(srcDir ?? '.', file);
    g = /\.fbx$/i.test(file) ? new Fbx(path) : new Gltf(path);
    files.set(file, g);
  }
  return g;
}

function animName(g: SourceFile, anim: string | undefined): string {
  const name = anim ?? g.animationNames()[0];
  if (name === undefined) throw new Error('source file has no animation');
  return name;
}

// --- Source sampling --------------------------------------------------------------------------

interface SourceFrame {
  rot: Map<string, THREE.Quaternion>;
  pos: Map<string, THREE.Vector3>;
}

/** Turns the source to face -Z with its left at -X, like Nora; set from the reference pose. */
const facing = new THREE.Quaternion();

function frameFromPose(g: SourceFile, pose: Trs[]): SourceFrame {
  const ms = worldMatrices(g, pose);
  const rot = new Map<string, THREE.Quaternion>();
  const pos = new Map<string, THREE.Vector3>();
  g.names.forEach((n, i) => {
    const m = ms[i];
    if (!m || !n) return;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.decompose(p, q, new THREE.Vector3());
    const name = rig.name(n);
    rot.set(name, facing.clone().multiply(q));
    pos.set(name, p.applyQuaternion(facing));
  });
  return { rot, pos };
}

function sourceFrame(g: SourceFile, anim: string, t: number): SourceFrame {
  return frameFromPose(g, g.animation(anim).sample(t));
}

const get = <T>(m: Map<string, T>, k: string): T => {
  const v = m.get(k);
  if (v === undefined) throw new Error(`source has no joint '${k}'`);
  return v;
};

const src1 = (j: RetargetJoint): string => {
  const s = rig.joints[j];
  return typeof s === 'string' ? s : s[0];
};

/** Sets `facing` so the reference pose's left hip is at -X (its forward then lands on -Z). */
function detectFacing(ref: SourceFrame): void {
  const left = get(ref.pos, src1('thigh_L'))
    .clone()
    .sub(get(ref.pos, src1('thigh_R')));
  left.y = 0;
  facing.setFromUnitVectors(left.normalize(), new THREE.Vector3(-1, 0, 0));
}

// --- Retargeting ------------------------------------------------------------------------------

const DOWN = new THREE.Vector3(0, -1, 0);

class Retargeter {
  /** Canonical rotation of each joint in the source's reference pose. */
  private readonly refCanon = new Map<RetargetJoint, THREE.Quaternion>();
  /** Scale from the source's leg length to Nora's. */
  readonly k: number;
  private readonly srcAnkle: number;
  private readonly srcHipXZ: THREE.Vector3;

  constructor(
    private readonly ref: SourceFrame,
    private readonly nora: ScanSkeleton,
  ) {
    for (const j of JOINTS) {
      const q = new THREE.Quaternion();
      const end = rig.ends[j];
      const src = rig.joints[j];
      if (end && typeof src === 'string') {
        const dir = get(ref.pos, end).clone().sub(get(ref.pos, src)).normalize();
        q.setFromUnitVectors(DOWN, dir);
      }
      this.refCanon.set(j, q);
    }
    const leg = (s: 'L' | 'R'): number =>
      get(ref.pos, src1(`thigh_${s}`)).distanceTo(get(ref.pos, src1(`shin_${s}`))) +
      get(ref.pos, src1(`shin_${s}`)).distanceTo(get(ref.pos, src1(`foot_${s}`)));
    this.k = (nora.thighLength + nora.shinLength) / ((leg('L') + leg('R')) / 2);
    this.srcAnkle = (get(ref.pos, src1('foot_L')).y + get(ref.pos, src1('foot_R')).y) / 2;
    this.srcHipXZ = this.hipCentre(ref).setY(0);
    for (const j of JOINTS) if (LIMB_END[j] && !rig.ends[j]) throw new Error(`no source end for ${j}`);
  }

  private canonRef(j: RetargetJoint): THREE.Quaternion {
    const q = this.refCanon.get(j);
    if (!q) throw new Error(`no reference for ${j}`);
    return q;
  }

  private hipCentre(f: SourceFrame): THREE.Vector3 {
    return get(f.pos, src1('thigh_L'))
      .clone()
      .add(get(f.pos, src1('thigh_R')))
      .multiplyScalar(0.5);
  }

  /** Model-space rotation of a source joint relative to the reference pose. */
  private delta(f: SourceFrame, name: string): THREE.Quaternion {
    return get(f.rot, name).clone().multiply(get(this.ref.rot, name).clone().invert());
  }

  /** Canonical rotations and hips position for one source frame. */
  frame(f: SourceFrame): { rot: THREE.Quaternion[]; hips: THREE.Vector3 } {
    const rot = JOINTS.map((j) => {
      const src = rig.joints[j];
      const d =
        typeof src === 'string'
          ? this.delta(f, src)
          : this.delta(f, src[0]).slerp(this.delta(f, src[1]), 0.5);
      return d.multiply(this.canonRef(j)).normalize();
    });
    // Hip joint centre: keep the bob and sway, scaled to Nora's leg length.
    const c = this.hipCentre(f);
    const centre = new THREE.Vector3(
      (c.x - this.srcHipXZ.x) * this.k,
      this.nora.ankleHeight + (c.y - this.srcAnkle) * this.k,
      (c.z - this.srcHipXZ.z) * this.k,
    );
    const hipsRot = rot[JOINT_INDEX.hips] ?? new THREE.Quaternion();
    const hips = centre.sub(this.nora.hipCentre.clone().applyQuaternion(hipsRot));
    return { rot, hips };
  }
}

// --- Clip building ----------------------------------------------------------------------------

interface Frame {
  rot: THREE.Quaternion[];
  hips: THREE.Vector3;
}

/** Spreads the mismatch between the last and first frame of a loop over the whole clip. */
function closeLoop(frames: Frame[]): Frame[] {
  const n = frames.length - 1;
  const first = frames[0];
  const last = frames[n];
  if (!first || !last) return frames;
  const errRot = first.rot.map((q, j) => q.clone().multiply((last.rot[j] ?? q).clone().invert()));
  const errPos = first.hips.clone().sub(last.hips);
  const id = new THREE.Quaternion();
  return frames.slice(0, n).map((f, i) => {
    const t = i / n;
    return {
      rot: f.rot.map((q, j) => new THREE.Quaternion().slerpQuaternions(id, errRot[j] ?? id, t).multiply(q)),
      hips: f.hips.clone().addScaledVector(errPos, t),
    };
  });
}

interface Sole {
  heel: THREE.Vector3;
  ball: THREE.Vector3;
}

/** Heel and ball of each foot for a frame (Nora's proportions, model space). */
function soles(nora: ScanSkeleton, f: Frame): [Sole, Sole] {
  const pos: THREE.Vector3[] = [];
  nora.positions(f.rot, f.hips, pos);
  const side = (s: 'L' | 'R'): Sole => {
    const ankle = pos[JOINT_INDEX[`foot_${s}`]] ?? new THREE.Vector3();
    const q = f.rot[JOINT_INDEX[`foot_${s}`]] ?? new THREE.Quaternion();
    return {
      heel: nora.heel.clone().applyQuaternion(q).add(ankle),
      ball: nora.ball.clone().applyQuaternion(q).add(ankle),
    };
  };
  return [side('L'), side('R')];
}

/**
 * Contact intervals (phase) of one foot: frames where its heel or ball is on
 * the floor and moving backwards with the ground at the clip's speed.
 */
function contacts(frames: [Sole, Sole][], side: 0 | 1, speed: number): Contacts {
  const n = frames.length;
  const at = (i: number): Sole | undefined => frames[((i % n) + n) % n]?.[side];
  const planted = (i: number, k: 'heel' | 'ball'): boolean => {
    const p = at(i)?.[k];
    const a = at(i - 1)?.[k];
    const b = at(i + 1)?.[k];
    if (!p || !a || !b) return false;
    const vz = ((b.z - a.z) / 2) * FPS;
    const vx = ((b.x - a.x) / 2) * FPS;
    const tol = Math.max(0.15, 0.55 * speed);
    return p.y < 0.02 && Math.abs(vz - speed) < tol && Math.abs(vx) < tol;
  };
  const raw = Array.from({ length: n }, (_, i) => planted(i, 'heel') || planted(i, 'ball'));
  // Drop one-frame blips and fill one-frame gaps.
  const on = raw.map((v, i) => {
    const a = raw[(i - 1 + n) % n] ?? false;
    const b = raw[(i + 1) % n] ?? false;
    return v ? a || b : a && b;
  });
  if (on.every(Boolean)) return [[0, 1]];
  const out: Contacts = [];
  // Start scanning just after a frame without contact so intervals don't split at the seam.
  const s0 = on.findIndex((v) => !v);
  for (let k = 0; k < n; k++) {
    const i = (s0 + k) % n;
    const prev = on[(i - 1 + n) % n];
    if (on[i] && !prev) {
      let len = 0;
      while (on[(i + len) % n] && len < n) len++;
      out.push([i / n, ((i + len) % n) / n]);
    }
  }
  return out;
}

/** Speed of the ground under a foot-planted in-place gait: the median backward speed of the lowest sole. */
function stanceSpeed(frames: [Sole, Sole][]): number {
  const n = frames.length;
  const v: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = frames[(i - 1 + n) % n];
    const b = frames[(i + 1) % n];
    const c = frames[i];
    if (!a || !b || !c) continue;
    for (let s = 0; s < 2; s++) {
      const low = (f: [Sole, Sole]): THREE.Vector3 => {
        const x = f[s as 0 | 1];
        return x.heel.y < x.ball.y ? x.heel : x.ball;
      };
      if (low(c).y > 0.02) continue;
      v.push(((low(b).z - low(a).z) / 2) * FPS);
    }
  }
  v.sort((x, y) => x - y);
  return Math.abs(v[Math.floor(v.length / 2)] ?? 0);
}

/** Take-off and touch-down times (s) of a one-shot clip: when both feet leave the floor, and when one lands again. */
function airEvents(
  frames: [Sole, Sole][],
  loop: boolean,
): { takeoff?: number; touchdown?: number } | undefined {
  if (loop) return undefined;
  const low = frames.map((f) => Math.min(f[0].heel.y, f[0].ball.y, f[1].heel.y, f[1].ball.y));
  const off = low.findIndex((y) => y > 0.05);
  const out: { takeoff?: number; touchdown?: number } = {};
  if (off > 0) out.takeoff = Math.round((off / FPS) * 1000) / 1000;
  const start = Math.max(0, off);
  const down = low.findIndex((y, i) => i > start && off >= 0 && y < 0.02);
  if (down > 0) out.touchdown = Math.round((down / FPS) * 1000) / 1000;
  return out.takeoff !== undefined || out.touchdown !== undefined ? out : undefined;
}

function rotateFrames<T>(frames: T[], start: number): T[] {
  return frames.slice(start).concat(frames.slice(0, start));
}

/** Ground speed of a clip as recorded (m/s, source scale). */
function recordedSpeed(spec: ClipSpec): number {
  if (spec.speed !== undefined) return spec.speed;
  const from = spec.speedFrom;
  if (!from) return 0;
  const g = gltf(from.file);
  const anim = g.animation(animName(g, from.anim ?? spec.anim));
  const node = g.names.findIndex((n) => rig.name(n) === from.node);
  if (node < 0) throw new Error(`${from.file}: no node '${from.node}'`);
  const at = (t: number): THREE.Vector3 =>
    new THREE.Vector3().setFromMatrixPosition(worldMatrices(g, anim.sample(t))[node] ?? new THREE.Matrix4());
  const d = at(anim.duration).sub(at(0));
  return Math.hypot(d.x, d.z) / anim.duration;
}

const nora = loadSkeleton();
const restFile = gltf(manifest.rest.file);
const restPose = manifest.rest.anim ? restFile.animation(manifest.rest.anim).sample(0) : restFile.restPose();
detectFacing(frameFromPose(restFile, restPose));
const retarget = new Retargeter(frameFromPose(restFile, restPose), nora);
console.log(`leg scale ${retarget.k.toFixed(3)}; Nora ankle height ${nora.ankleHeight.toFixed(3)} m`);

mkdirSync(outDir, { recursive: true });
for (const spec of manifest.clips) {
  const g = gltf(spec.file);
  const name = animName(g, spec.anim);
  const anim = g.animation(name);
  const t0 = spec.from ?? 0;
  const t1 = Math.min(anim.duration, spec.to ?? anim.duration);
  const count = Math.round((t1 - t0) * FPS);
  let frames: Frame[] = [];
  for (let i = 0; i <= count; i++) frames.push(retarget.frame(sourceFrame(g, name, t0 + i / FPS)));

  // Travel baked into the clip (Nora scale).
  const first = frames[0]?.hips.clone() ?? new THREE.Vector3();
  const travel = (frames[frames.length - 1]?.hips.clone() ?? first).sub(first);
  let rootEnd: [number, number, number] | undefined;
  if ((spec.rootMotion ?? 'remove') === 'remove') {
    frames.forEach((f, i) => {
      const u = i / Math.max(1, frames.length - 1);
      f.hips.x -= travel.x * u;
      f.hips.z -= travel.z * u;
      if (spec.climb) f.hips.y -= travel.y * u;
    });
  }
  if (spec.anchor === 'hands') {
    const pos: THREE.Vector3[] = [];
    const f0 = frames[0];
    if (f0) {
      nora.positions(f0.rot, f0.hips, pos);
      const hands = (pos[JOINT_INDEX.hand_L] ?? new THREE.Vector3())
        .clone()
        .add(pos[JOINT_INDEX.hand_R] ?? new THREE.Vector3())
        .multiplyScalar(0.5);
      const shift = HANG_WRIST.clone().sub(hands);
      for (const f of frames) f.hips.add(shift);
    }
  }
  if (spec.anchor === 'wall') {
    const pos: THREE.Vector3[] = [];
    const hands = new THREE.Vector3();
    for (const f of frames) {
      nora.positions(f.rot, f.hips, pos);
      hands
        .add(pos[JOINT_INDEX.hand_L] ?? new THREE.Vector3())
        .add(pos[JOINT_INDEX.hand_R] ?? new THREE.Vector3());
    }
    hands.multiplyScalar(0.5 / Math.max(1, frames.length));
    const shift = WALL_HANDS.clone().sub(hands);
    for (const f of frames) f.hips.add(shift);
    // Clips that hang from the hands (the shimmies) would put her feet through the floor at the
    // foot of a wall: those go up until the lowest sole is on it, the hands higher on the face.
    const lowest = Math.min(...frames.flatMap((f) => soles(nora, f).flatMap((sd) => [sd.heel.y, sd.ball.y])));
    if (lowest < 0) for (const f of frames) f.hips.y -= lowest;
  }
  if (spec.rootMotion === 'keep') {
    const last = frames[frames.length - 1];
    if (last) {
      const [l, r] = soles(nora, last);
      const feet = l.heel.clone().add(l.ball).add(r.heel).add(r.ball).multiplyScalar(0.25);
      const low = Math.min(l.heel.y, l.ball.y, r.heel.y, r.ball.y);
      rootEnd = [feet.x, low, feet.z].map((v) => Math.round(v * 1000) / 1000) as [number, number, number];
    }
  }
  if (spec.loop) frames = closeLoop(frames);

  let sole = frames.map((f) => soles(nora, f));
  // Ground speed scaled to Nora's legs: given, measured from the baked travel, or from the planted feet.

  let speed = recordedSpeed(spec) * retarget.k;
  if (spec.speed === undefined && !spec.speedFrom && (spec.rootMotion ?? 'remove') === 'remove')
    speed = (spec.climb ? travel.length() : Math.hypot(travel.x, travel.z)) / Math.max(1e-3, t1 - t0);
  if (speed < 0.05 && spec.gait) speed = stanceSpeed(sole);
  // Backwards travel (towards +Z): planted feet move forwards under the body.
  const signed = travel.z > 0.05 ? -speed : speed;

  if (spec.gait) {
    const left = contacts(sole, 0, signed);
    const start = Math.round((left[0]?.[0] ?? 0) * frames.length);
    frames = rotateFrames(frames, start);
    sole = rotateFrames(sole, start);
  }
  const events = airEvents(sole, spec.loop);
  const file: ClipFile = {
    ...(rootEnd ? { rootEnd } : {}),
    ...(events ? { events } : {}),
    format: 'nora-clip@1',
    name: spec.name,
    source: `${manifest.source}: ${name}`,
    fps: FPS,
    frames: frames.length,
    loop: spec.loop,
    speed: Math.round(signed * 1000) / 1000,
    contacts: { L: contacts(sole, 0, signed), R: contacts(sole, 1, signed) },
    joints: [...JOINTS],
    rotations: encodeInt16(
      frames.flatMap((f) =>
        f.rot.flatMap((q) => (q.w < 0 ? [-q.x, -q.y, -q.z, -q.w] : [q.x, q.y, q.z, q.w])),
      ),
      ROT_SCALE,
    ),
    hips: encodeInt16(
      frames.flatMap((f) => [f.hips.x, f.hips.y, f.hips.z]),
      POS_SCALE,
    ),
  };
  const path = join(outDir, `${spec.name}.json`);
  writeFileSync(path, JSON.stringify(file) + '\n');

  const hy = frames.map((f) => f.hips.y);
  const lows = sole.flatMap((h) => h.flatMap((s) => [s.heel.y, s.ball.y]));
  const fmt = (c: Contacts): string => c.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(',');
  console.log(
    `${spec.name.padEnd(5)} ${String(frames.length).padStart(3)} frames ${(frames.length / FPS).toFixed(3)} s` +
      ` speed ${file.speed.toFixed(2)} m/s hips ${Math.min(...hy).toFixed(3)}..${Math.max(...hy).toFixed(3)}` +
      ` lowest sole ${Math.min(...lows).toFixed(3)} contacts L ${fmt(file.contacts.L)} R ${fmt(file.contacts.R)}` +
      ` travel ${travel.x.toFixed(2)},${travel.y.toFixed(2)},${travel.z.toFixed(2)}` +
      (file.events ? ` events ${JSON.stringify(file.events)}` : '') +
      (file.rootEnd ? ` rootEnd ${file.rootEnd.join(',')}` : '') +
      ` (${(JSON.stringify(file).length / 1024).toFixed(1)} kB)`,
  );
  if (JOINT_COUNT !== file.joints.length) throw new Error('joint count mismatch');
}

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
}

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

const files = new Map<string, Gltf>();
function gltf(file: string): Gltf {
  let g = files.get(file);
  if (!g) {
    g = new Gltf(join(srcDir ?? '.', file));
    files.set(file, g);
  }
  return g;
}

function animName(g: Gltf, anim: string | undefined): string {
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

function frameFromPose(g: Gltf, pose: Trs[]): SourceFrame {
  const ms = worldMatrices(g, pose);
  const rot = new Map<string, THREE.Quaternion>();
  const pos = new Map<string, THREE.Vector3>();
  g.json.nodes.forEach((n, i) => {
    const m = ms[i];
    if (!m || !n.name) return;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.decompose(p, q, new THREE.Vector3());
    const name = rig.name(n.name);
    rot.set(name, facing.clone().multiply(q));
    pos.set(name, p.applyQuaternion(facing));
  });
  return { rot, pos };
}

function sourceFrame(g: Gltf, anim: string, t: number): SourceFrame {
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
  const node = g.json.nodes.findIndex((n) => n.name !== undefined && rig.name(n.name) === from.node);
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
  const count = Math.round(anim.duration * FPS);
  let frames: Frame[] = [];
  for (let i = 0; i <= count; i++) frames.push(retarget.frame(sourceFrame(g, name, i / FPS)));
  if (spec.loop) frames = closeLoop(frames);

  // Ground speed scaled to Nora's legs.
  const speed = recordedSpeed(spec) * retarget.k;

  let sole = frames.map((f) => soles(nora, f));
  if (spec.gait) {
    const left = contacts(sole, 0, speed);
    const start = Math.round((left[0]?.[0] ?? 0) * frames.length);
    frames = rotateFrames(frames, start);
    sole = rotateFrames(sole, start);
  }
  const file: ClipFile = {
    format: 'nora-clip@1',
    name: spec.name,
    source: `${manifest.source}: ${name}`,
    fps: FPS,
    frames: frames.length,
    loop: spec.loop,
    speed: Math.round(speed * 1000) / 1000,
    contacts: { L: contacts(sole, 0, speed), R: contacts(sole, 1, speed) },
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
      ` -> ${path} (${JSON.stringify(file).length} bytes)`,
  );
  if (JOINT_COUNT !== file.joints.length) throw new Error('joint count mismatch');
}

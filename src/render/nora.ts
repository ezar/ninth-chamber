/**
 * Procedural placeholder model of Nora Vidal, used until a real rigged model exists.
 *
 * The body is built from lathe-like ring surfaces, capsules and rounded boxes. Clothing that
 * bends (jacket, shirt, trousers, sleeves) is skinned to a small skeleton with half-angle helper
 * bones at the hips, knees, shoulders and elbows; rigid parts (head, hands, boots, satchel) ride
 * on their bones. Every mode is a procedural pose (FK angles plus two-bone IK for arms and legs)
 * and mode changes cross-fade from a snapshot of the displayed pose.
 */
import * as THREE from 'three/webgpu';
import type { PlayerMode } from '../sim/state';

export interface NoraPose {
  mode: PlayerMode;
  /** Seconds in the current mode. */
  modeTime: number;
  /** Horizontal speed (m/s): run 5.4, walk 2.2. */
  speed: number;
  /** Vertical velocity (m/s). */
  vy: number;
  /** 0..1 progress of climb, push and pull moves (0 otherwise). */
  climbT: number;
  /** 0..100. */
  health: number;
  /** Pistols in hand: 0 holstered … 1 drawn. */
  weapons: number;
  /** 1 while aiming at a target or firing, 0 holding the pistols ready. */
  aiming: number;
  /** Aim direction relative to the body: yaw (player convention, + = to her left) and pitch (+ = up), rad. */
  aimYaw: number;
  aimPitch: number;
  /** The torch in her left hand: 1 held, 0 (or absent) on her belt or none. */
  torch?: number;
  /** Swimming and diving: body pitch along the swim direction (rad, + = head up). */
  pitch?: number;
}

// ---------------------------------------------------------------------------------------------
// Small math helpers

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const ease = (t: number): number => smooth(0, 1, t);
const smoother = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const sgnPow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
const frac = (v: number): number => v - Math.floor(v);

function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error(`nora: index ${i} out of range`);
  return v;
}

/** Piecewise cubic (smoothstep) interpolation over [time, value] keys. */
function keys(k: readonly (readonly [number, number])[], t: number): number {
  const first = at(k, 0);
  if (t <= first[0]) return first[1];
  for (let i = 1; i < k.length; i++) {
    const b = at(k, i);
    if (t <= b[0]) {
      const a = at(k, i - 1);
      return lerp(a[1], b[1], ease((t - a[0]) / (b[0] - a[0])));
    }
  }
  return at(k, k.length - 1)[1];
}

// ---------------------------------------------------------------------------------------------
// Skeleton layout (bind pose: every bone has identity rotation, arms straight down)

const HIPS = 0;
const SPINE = 1;
const CHEST = 2;
const NECK = 3;
const HEAD = 4;
const CLAV_L = 5;
const UPPER_L = 6;
const FORE_L = 7;
const HAND_L = 8;
const CLAV_R = 9;
const UPPER_R = 10;
const FORE_R = 11;
const HAND_R = 12;
const THIGH_L = 13;
const SHIN_L = 14;
const FOOT_L = 15;
const THIGH_R = 16;
const SHIN_R = 17;
const FOOT_R = 18;
const JOINTS = 19;
// Helper bones: rotate half-way with their child joint to keep volume at bends.
const SHOULDER_H_L = 19;
const ELBOW_H_L = 20;
const SHOULDER_H_R = 21;
const ELBOW_H_R = 22;
const HIP_H_L = 23;
const KNEE_H_L = 24;
const HIP_H_R = 25;
const KNEE_H_R = 26;
const BONES = 27;

const UPPER_LEN = 0.28;
const FORE_LEN = 0.24;
const THIGH_LEN = 0.4;
const SHIN_LEN = 0.385;
const HIPS_Y = 0.92;

const PARENT: readonly number[] = [
  -1,
  HIPS,
  SPINE,
  CHEST,
  NECK,
  CHEST,
  CLAV_L,
  UPPER_L,
  FORE_L,
  CHEST,
  CLAV_R,
  UPPER_R,
  FORE_R,
  HIPS,
  THIGH_L,
  SHIN_L,
  HIPS,
  THIGH_R,
  SHIN_R,
  CLAV_L,
  UPPER_L,
  CLAV_R,
  UPPER_R,
  HIPS,
  THIGH_L,
  HIPS,
  THIGH_R,
];

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const OFFSET: readonly THREE.Vector3[] = [
  v3(0, HIPS_Y, 0),
  v3(0, 0.08, 0),
  v3(0, 0.17, 0),
  v3(0, 0.23, 0.005),
  v3(0, 0.1, -0.01),
  v3(-0.025, 0.195, 0),
  v3(-0.135, -0.01, 0.005),
  v3(0, -UPPER_LEN, 0),
  v3(0, -FORE_LEN, 0),
  v3(0.025, 0.195, 0),
  v3(0.135, -0.01, 0.005),
  v3(0, -UPPER_LEN, 0),
  v3(0, -FORE_LEN, 0),
  v3(-0.088, -0.06, 0),
  v3(0, -THIGH_LEN, 0),
  v3(0, -SHIN_LEN, 0),
  v3(0.088, -0.06, 0),
  v3(0, -THIGH_LEN, 0),
  v3(0, -SHIN_LEN, 0),
  v3(-0.135, -0.01, 0.005),
  v3(0, -UPPER_LEN, 0),
  v3(0.135, -0.01, 0.005),
  v3(0, -UPPER_LEN, 0),
  v3(-0.088, -0.06, 0),
  v3(0, -THIGH_LEN, 0),
  v3(0.088, -0.06, 0),
  v3(0, -THIGH_LEN, 0),
];

/** Bind-pose model-space position of every bone. */
const BIND: readonly THREE.Vector3[] = (() => {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < BONES; i++) {
    const p = PARENT[i] ?? -1;
    out.push(
      at(OFFSET, i)
        .clone()
        .add(p >= 0 ? at(out, p) : new THREE.Vector3()),
    );
  }
  return out;
})();

/** Chain of joint indices from the hips down to each joint. */
const CHAIN: readonly (readonly number[])[] = Array.from({ length: JOINTS }, (_, j) => {
  const c: number[] = [];
  for (let k = j; k >= 0; k = PARENT[k] ?? -1) c.unshift(k);
  return c;
});

interface Side {
  s: number;
  clav: number;
  upper: number;
  fore: number;
  hand: number;
  thigh: number;
  shin: number;
  foot: number;
  shoulderH: number;
  elbowH: number;
  hipH: number;
  kneeH: number;
}
const LEFT: Side = {
  s: -1,
  clav: CLAV_L,
  upper: UPPER_L,
  fore: FORE_L,
  hand: HAND_L,
  thigh: THIGH_L,
  shin: SHIN_L,
  foot: FOOT_L,
  shoulderH: SHOULDER_H_L,
  elbowH: ELBOW_H_L,
  hipH: HIP_H_L,
  kneeH: KNEE_H_L,
};
const RIGHT: Side = {
  s: 1,
  clav: CLAV_R,
  upper: UPPER_R,
  fore: FORE_R,
  hand: HAND_R,
  thigh: THIGH_R,
  shin: SHIN_R,
  foot: FOOT_R,
  shoulderH: SHOULDER_H_R,
  elbowH: ELBOW_H_R,
  hipH: HIP_H_R,
  kneeH: KNEE_H_R,
};
const SIDES: readonly Side[] = [LEFT, RIGHT];
/** Joints the aiming layer overrides. */
const AIM_JOINTS: readonly number[] = [
  SPINE,
  CHEST,
  CLAV_L,
  UPPER_L,
  FORE_L,
  HAND_L,
  CLAV_R,
  UPPER_R,
  FORE_R,
  HAND_R,
];

/** Joint names shared with the scanned model's skeleton (scripts/character/rig_nora.py). */
export type RetargetJoint =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulder_L'
  | 'upperArm_L'
  | 'lowerArm_L'
  | 'hand_L'
  | 'shoulder_R'
  | 'upperArm_R'
  | 'lowerArm_R'
  | 'hand_R'
  | 'thigh_L'
  | 'shin_L'
  | 'foot_L'
  | 'thigh_R'
  | 'shin_R'
  | 'foot_R';

/** Retarget name of each joint index, in joint order. */
const RETARGET_NAMES: readonly RetargetJoint[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulder_L',
  'upperArm_L',
  'lowerArm_L',
  'hand_L',
  'shoulder_R',
  'upperArm_R',
  'lowerArm_R',
  'hand_R',
  'thigh_L',
  'shin_L',
  'foot_L',
  'thigh_R',
  'shin_R',
  'foot_R',
];

// ---------------------------------------------------------------------------------------------
// Procedural detail textures (no DOM needed)

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 144269504)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Tileable value noise on a period x period lattice, u and v in [0,1). */
function vnoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const m = (n: number): number => ((n % period) + period) % period;
  const a = hash(m(xi), m(yi), seed);
  const b = hash(m(xi + 1), m(yi), seed);
  const c = hash(m(xi), m(yi + 1), seed);
  const d = hash(m(xi + 1), m(yi + 1), seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

function fbm(u: number, v: number, period: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u, v, period << o, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

interface Detail {
  map: THREE.DataTexture;
  rough: THREE.DataTexture;
  normal: THREE.DataTexture;
}

/** Builds a tileable detail set: grey multiplier map, roughness multiplier and normal map. */
function detailTextures(
  size: number,
  repeat: number,
  sample: (u: number, v: number) => { h: number; c: number; r: number },
  bump: number,
): Detail {
  const n = size * size;
  const h = new Float32Array(n);
  const col = new Uint8Array(n * 4);
  const rough = new Uint8Array(n * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = sample(x / size, y / size);
      const i = y * size + x;
      h[i] = s.h;
      const c = Math.round(clamp(s.c, 0, 1) * 255);
      const r = Math.round(clamp(s.r, 0, 1) * 255);
      col.set([c, c, c, 255], i * 4);
      rough.set([r, r, r, 255], i * 4);
    }
  }
  const nrm = new Uint8Array(n * 4);
  const hAt = (x: number, y: number): number => h[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * bump;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * bump;
      const l = Math.hypot(dx, dy, 1);
      nrm.set(
        [((-dx / l) * 0.5 + 0.5) * 255, ((-dy / l) * 0.5 + 0.5) * 255, ((1 / l) * 0.5 + 0.5) * 255, 255],
        (y * size + x) * 4,
      );
    }
  }
  const tex = (data: Uint8Array): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { map: tex(col), rough: tex(rough), normal: tex(nrm) };
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

/** One horizontal cross-section of a ring surface. phi = 0 faces -Z (front), phi = PI/2 faces +X. */
interface Ring {
  y: number;
  rx: number;
  /** Front (-Z) half radius. */
  rzf: number;
  /** Back (+Z) half radius (defaults to rzf). */
  rzb?: number;
  cx?: number;
  cz?: number;
  /** Angular range; a surface is closed only when no ring sets it. */
  a0?: number;
  a1?: number;
}

function ringPoint(r: Ring, phi: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(phi);
  const rz = c > 0 ? r.rzf : (r.rzb ?? r.rzf);
  return out.set((r.cx ?? 0) + r.rx * Math.sin(phi), r.y, (r.cz ?? 0) - rz * c);
}

/** Interpolated ring at height y (rings sorted by y). */
function ringAt(rings: readonly Ring[], y: number): Ring {
  for (let i = 1; i < rings.length; i++) {
    const b = at(rings, i);
    if (y <= b.y || i === rings.length - 1) {
      const a = at(rings, i - 1);
      const t = clamp((y - a.y) / (b.y - a.y), 0, 1);
      return {
        y,
        rx: lerp(a.rx, b.rx, t),
        rzf: lerp(a.rzf, b.rzf, t),
        rzb: lerp(a.rzb ?? a.rzf, b.rzb ?? b.rzf, t),
        cx: lerp(a.cx ?? 0, b.cx ?? 0, t),
        cz: lerp(a.cz ?? 0, b.cz ?? 0, t),
        a0: lerp(a.a0 ?? 0, b.a0 ?? 0, t),
        a1: lerp(a.a1 ?? TAU, b.a1 ?? TAU, t),
      };
    }
  }
  return at(rings, 0);
}

/** Point and outward normal on a ring surface at height y and angle phi. */
function surfaceFrame(
  rings: readonly Ring[],
  y: number,
  phi: number,
  pos: THREE.Vector3,
  nrm: THREE.Vector3,
): void {
  const r = ringAt(rings, y);
  ringPoint(r, phi, pos);
  const a = ringPoint(r, phi + 0.01, new THREE.Vector3()).sub(ringPoint(r, phi - 0.01, new THREE.Vector3()));
  const b = ringPoint(ringAt(rings, y + 0.01), phi, new THREE.Vector3()).sub(
    ringPoint(ringAt(rings, y - 0.01), phi, new THREE.Vector3()),
  );
  nrm.crossVectors(b, a).normalize();
}

function ringSurface(
  rings: readonly Ring[],
  segs: number,
  capTop = false,
  capBottom = false,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const closed = rings.every((r) => r.a0 === undefined && r.a1 === undefined);
  const p = new THREE.Vector3();
  const prev = new THREE.Vector3();
  for (const r of rings) {
    const a0 = r.a0 ?? 0;
    const a1 = r.a1 ?? TAU;
    let u = 0;
    for (let j = 0; j <= segs; j++) {
      ringPoint(r, a0 + (a1 - a0) * (j / segs), p);
      if (j > 0) u += p.distanceTo(prev);
      prev.copy(p);
      pos.push(p.x, p.y, p.z);
      uv.push(u, r.y);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * row + j;
      const b = a + 1;
      const d = a + row;
      const c = d + 1;
      idx.push(a, d, b, b, d, c);
    }
  }
  const cap = (ring: Ring, base: number, top: boolean): void => {
    const center = pos.length / 3;
    pos.push(ring.cx ?? 0, ring.y + (top ? 0.002 : -0.002), ring.cz ?? 0);
    uv.push(0, ring.y);
    for (let j = 0; j < segs; j++) {
      if (top) idx.push(base + j, center, base + j + 1);
      else idx.push(base + j, base + j + 1, center);
    }
  };
  if (capTop) cap(at(rings, rings.length - 1), (rings.length - 1) * row, true);
  if (capBottom) cap(at(rings, 0), 0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closed) {
    const n = g.getAttribute('normal');
    const t = new THREE.Vector3();
    for (let i = 0; i < rings.length; i++) {
      const a = i * row;
      const b = a + segs;
      t.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, t.x, t.y, t.z);
      n.setXYZ(b, t.x, t.y, t.z);
    }
  }
  return g;
}

/** Rings for a limb-like tube along Y: [y, radius] pairs from bottom to top. */
function tubeRings(
  profile: readonly (readonly [number, number])[],
  cx: number,
  cz: number,
  flat = 1,
): Ring[] {
  return profile.map(([y, r]) => ({ y, rx: r, rzf: r * flat, cx, cz }));
}

/** A rounded box made from a superellipsoid-deformed sphere. */
function roundedBox(w: number, h: number, d: number, e = 0.3, ws = 16, hs = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(
      i,
      sgnPow(p.getX(i), e) * w * 0.5,
      sgnPow(p.getY(i), e) * h * 0.5,
      sgnPow(p.getZ(i), e) * d * 0.5,
    );
  }
  g.computeVertexNormals();
  return g;
}

function deform(g: THREE.BufferGeometry, f: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    f(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Unit-sphere direction to the head surface (head-local metres, centred at the skull centre). */
function headShape(d: THREE.Vector3, out: THREE.Vector3, scale = 1): THREE.Vector3 {
  const { x, y, z } = d;
  let px = x * 0.074;
  const py = y > 0 ? y * 0.106 : y * 0.106;
  let pz = z < 0 ? z * 0.094 : z * 0.1;
  if (y < 0) {
    const t = -y;
    px *= 1 - 0.46 * Math.pow(t, 1.4);
    if (z > 0) pz *= 1 - 0.5 * t;
    else pz *= 1 - 0.08 * t;
  }
  if (z < 0) pz *= 1 - 0.2 * x * x;
  // Brow ridge and eye sockets.
  if (z < -0.6) {
    pz -= 0.005 * Math.exp(-Math.pow((y - 0.28) / 0.1, 2)) * (1 - x * x * 2);
    // Chin.
    pz -= 0.006 * Math.exp(-Math.pow((y + 0.9) / 0.12, 2) - Math.pow(x / 0.35, 2));
    const eye = Math.exp(-(Math.pow((Math.abs(x) - 0.36) / 0.13, 2) + Math.pow((y - 0.12) / 0.1, 2)));
    pz += 0.009 * eye;
    // Cheekbones.
    px *= 1 + 0.05 * Math.exp(-Math.pow((y + 0.05) / 0.2, 2));
  }
  return out.set(px * scale, py * scale, pz * scale);
}

// ---------------------------------------------------------------------------------------------
// Body proportions: ring profiles (model space, bind pose)

const JACKET: readonly Ring[] = (
  [
    [0.74, 0.203, 0.14, 0.158, 0.3],
    [0.8, 0.196, 0.134, 0.15, 0.28],
    [0.88, 0.193, 0.128, 0.145, 0.26],
    [0.96, 0.178, 0.12, 0.134, 0.26],
    [1.04, 0.165, 0.114, 0.124, 0.27],
    [1.12, 0.166, 0.121, 0.117, 0.29],
    [1.2, 0.173, 0.136, 0.12, 0.28],
    [1.27, 0.179, 0.139, 0.12, 0.3],
    [1.32, 0.184, 0.128, 0.117, 0.36],
    [1.36, 0.182, 0.112, 0.11, 0.48],
    [1.39, 0.162, 0.096, 0.097, 0.7],
    [1.415, 0.122, 0.08, 0.082, 0.95],
    [1.435, 0.078, 0.068, 0.07, 1.15],
  ] as const
).map(([y, rx, rzf, rzb, gap]) => ({ y, rx, rzf, rzb, a0: gap, a1: TAU - gap }));

const SHIRT: readonly Ring[] = (
  [
    [0.95, 0.163, 0.11, 0.12],
    [1.04, 0.15, 0.104, 0.11],
    [1.12, 0.154, 0.112, 0.11],
    [1.2, 0.161, 0.126, 0.11],
    [1.27, 0.167, 0.128, 0.11],
    [1.33, 0.17, 0.116, 0.11],
    [1.38, 0.15, 0.094, 0.09],
    [1.415, 0.1, 0.074, 0.075],
    [1.432, 0.074, 0.066, 0.068],
  ] as const
).map(([y, rx, rzf, rzb]) => ({ y, rx, rzf, rzb, a0: -1.25, a1: 1.25 }));

const SEAT: readonly Ring[] = (
  [
    [0.79, 0.05, 0.04, 0.05],
    [0.81, 0.13, 0.085, 0.11],
    [0.845, 0.163, 0.1, 0.13],
    [0.88, 0.174, 0.108, 0.134],
    [0.93, 0.166, 0.109, 0.124],
    [0.98, 0.154, 0.104, 0.114],
    [1.0, 0.151, 0.103, 0.111],
  ] as const
).map(([y, rx, rzf, rzb]) => ({ y, rx, rzf, rzb }));

// ---------------------------------------------------------------------------------------------
// Pose data

class Pose {
  readonly pos = new THREE.Vector3(0, HIPS_Y, 0);
  readonly q: THREE.Quaternion[] = Array.from({ length: JOINTS }, () => new THREE.Quaternion());
  /** Finger curl per hand [left, right], 0 = flat, 1 = fist. */
  readonly curl = [0.35, 0.35];

  copy(o: Pose): this {
    this.pos.copy(o.pos);
    for (let i = 0; i < JOINTS; i++) at(this.q, i).copy(at(o.q, i));
    this.curl[0] = o.curl[0] ?? 0;
    this.curl[1] = o.curl[1] ?? 0;
    return this;
  }

  blend(a: Pose, b: Pose, t: number): this {
    this.pos.lerpVectors(a.pos, b.pos, t);
    for (let i = 0; i < JOINTS; i++) at(this.q, i).slerpQuaternions(at(a.q, i), at(b.q, i), t);
    this.curl[0] = lerp(a.curl[0] ?? 0, b.curl[0] ?? 0, t);
    this.curl[1] = lerp(a.curl[1] ?? 0, b.curl[1] ?? 0, t);
    return this;
  }

  reset(): this {
    this.pos.set(0, HIPS_Y, 0);
    for (const q of this.q) q.identity();
    return this;
  }
}

interface Finger {
  base: THREE.Object3D;
  mid: THREE.Object3D;
  thumb: boolean;
}

interface StrapPoint {
  bone: THREE.Object3D;
  pos: THREE.Vector3;
  nrm: THREE.Vector3;
}

type Weights = [number, number][];

const PALETTE = {
  skin: '#b07c62',
  lips: '#a0604f',
  hair: '#2b1b12',
  jacket: '#8a8458',
  jacketEdge: '#6f6a45',
  shirt: '#e3dccb',
  trousers: '#6b4a2f',
  leather: '#7a4a2a',
  boot: '#4f3020',
  sole: '#211913',
  neckerchief: '#8e2f25',
  brass: '#a8874e',
  notebook: '#3f4637',
  paper: '#e6dcc2',
  pencil: '#cf9f3a',
  eyeWhite: '#cdbfae',
  iris: '#3b2416',
};

// Scratch objects for the per-frame math.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
/** The strap's cross-section: four faces (top, side +, bottom, side -), two vertices each. */
const STRAP_CORNERS: readonly (readonly [number, number])[] = [
  [-1, 1],
  [1, 1],
  [1, 1],
  [1, -1],
  [1, -1],
  [-1, -1],
  [-1, -1],
  [-1, 1],
];
const _e = new THREE.Euler();
const _ident = new THREE.Quaternion();

// ---------------------------------------------------------------------------------------------

export class NoraModel {
  readonly root = new THREE.Group();

  private readonly bones: THREE.Bone[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly fingers: Finger[][] = [[], []];
  private readonly live = new Pose();
  private readonly snap = new Pose();
  private readonly shown = new Pose();

  private mode: PlayerMode | null = null;
  private fade = 1;
  private time = 0;
  private phase = 0;
  private speed = 0;
  private prevSpeed = 0;
  private accel = 0;
  private lastAirVy = 0;
  private dipPos = 0;
  private dipVel = 0;
  private opacity = 1;

  // Aiming arms layer (spec §7: arms and torso follow the target, the legs keep running).
  private aimW = 0;
  private aimAiming = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private readonly aimQ = new Pose();

  // Satchel pendulum.
  private readonly bagPivot = new THREE.Group();
  private readonly bagAngle = new THREE.Vector2();
  private readonly bagVel = new THREE.Vector2();
  private readonly hipsPrev = new THREE.Vector3();
  private readonly hipsVel = new THREE.Vector3();
  private bagInit = false;

  // Cross-body strap, rebuilt every frame.
  private readonly strapPoints: StrapPoint[] = [];
  private readonly strapGeo = new THREE.BufferGeometry();
  private readonly strapCurve = new THREE.CatmullRomCurve3();
  private readonly strapSamples = 48;

  constructor() {
    this.root.name = 'Nora';
    this.buildSkeleton();
    this.buildBody();
    this.shown.reset();
    this.applyPose(this.shown);
    this.updateStrap();
  }

  // -------------------------------------------------------------------------------------------
  // Public API

  update(pose: NoraPose, dt: number): void {
    dt = clamp(dt, 0, 0.1);
    this.time += dt;

    if (pose.mode !== this.mode) {
      if (this.mode === 'air' && pose.mode === 'ground') {
        this.dipVel = -Math.min(2.4, Math.abs(Math.min(0, this.lastAirVy)) * 0.22);
      }
      if (this.mode !== null) {
        this.snap.copy(this.shown);
        this.fade = 0;
      }
      this.mode = pose.mode;
    }
    if (pose.mode === 'air') this.lastAirVy = pose.vy;

    // Smoothed speed and acceleration.
    this.speed += (pose.speed - this.speed) * (1 - Math.exp(-dt * 12));
    if (dt > 0) {
      const a = (this.speed - this.prevSpeed) / dt;
      this.accel += (a - this.accel) * (1 - Math.exp(-dt * 6));
    }
    this.prevSpeed = this.speed;

    // Landing dip: a damped spring on the hips height.
    const k = 140;
    const c = 2 * Math.sqrt(k) * 0.75;
    const steps = Math.ceil(dt * 120);
    const h = dt / Math.max(1, steps);
    for (let i = 0; i < steps; i++) {
      this.dipVel += (-k * this.dipPos - c * this.dipVel) * h;
      this.dipPos = clamp(this.dipPos + this.dipVel * h, -0.16, 0.05);
    }

    this.evaluate(pose, dt, this.live);
    this.applyAim(pose, dt, this.live);
    this.fade = Math.min(1, this.fade + dt / 0.15);
    if (this.fade < 1) this.shown.blend(this.snap, this.live, smoother(this.fade));
    else this.shown.copy(this.live);

    this.applyPose(this.shown);
    this.updateBag(dt);
    this.updateStrap();
  }

  /**
   * The displayed pose in model space, for retargeting onto another rig
   * (nora-scan.ts): each animated joint's rotation relative to its bind pose
   * (bind rotations are identity here) and the hips offset from bind.
   */
  modelPose(out: Map<RetargetJoint, THREE.Quaternion>, hipsOffset: THREE.Vector3): void {
    const world: THREE.Quaternion[] = [];
    for (let i = 0; i < JOINTS; i++) {
      const p = PARENT[i] ?? -1;
      const q = (world[i] = (p >= 0 ? at(world, p).clone() : new THREE.Quaternion()).multiply(
        at(this.shown.q, i),
      ));
      const name = RETARGET_NAMES[i];
      if (name) (out.get(name) ?? out.set(name, new THREE.Quaternion()).get(name))?.copy(q);
    }
    hipsOffset.copy(this.shown.pos).sub(at(BIND, HIPS));
  }

  /** A hand joint (0 = left, 1 = right): fingers along its -Y axis, palm facing its -Z axis. */
  hand(side: 0 | 1): THREE.Object3D {
    return this.bone(side === 0 ? HAND_L : HAND_R);
  }

  /** Hides the procedural body while it keeps animating (it drives the scanned model). */
  setVisible(visible: boolean): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.visible = visible;
    });
  }

  setOpacity(alpha: number): void {
    const a = clamp(alpha, 0, 1);
    if (Math.abs(a - this.opacity) < 1e-4) return;
    const wasTransparent = this.opacity < 1;
    this.opacity = a;
    for (const m of this.materials) {
      m.opacity = a;
      if (wasTransparent !== a < 1) {
        m.transparent = a < 1;
        m.needsUpdate = true;
      }
    }
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = a > 0.5;
    });
  }

  // -------------------------------------------------------------------------------------------
  // Skeleton

  private buildSkeleton(): void {
    for (let i = 0; i < BONES; i++) {
      const b = new THREE.Bone();
      b.position.copy(at(OFFSET, i));
      this.bones.push(b);
      const p = PARENT[i] ?? -1;
      if (p >= 0) at(this.bones, p).add(b);
      else this.root.add(b);
    }
    this.root.updateMatrixWorld(true);
  }

  private bone(i: number): THREE.Bone {
    return at(this.bones, i);
  }

  private applyPose(p: Pose): void {
    this.bone(HIPS).position.copy(p.pos);
    for (let i = 0; i < JOINTS; i++) this.bone(i).quaternion.copy(at(p.q, i));
    for (const sd of SIDES) {
      this.bone(sd.shoulderH).quaternion.slerpQuaternions(_ident, at(p.q, sd.upper), 0.5);
      this.bone(sd.elbowH).quaternion.slerpQuaternions(_ident, at(p.q, sd.fore), 0.5);
      this.bone(sd.hipH).quaternion.slerpQuaternions(_ident, at(p.q, sd.thigh), 0.5);
      this.bone(sd.kneeH).quaternion.slerpQuaternions(_ident, at(p.q, sd.shin), 0.5);
    }
    for (let h = 0; h < 2; h++) {
      const curl = p.curl[h] ?? 0;
      for (const f of at(this.fingers, h)) {
        if (f.thumb) {
          f.base.rotation.x = 0.35 + curl * 0.35;
          f.mid.rotation.x = curl * 0.7;
        } else {
          f.base.rotation.x = curl * 1.35;
          f.mid.rotation.x = 0.12 + curl * 1.45;
        }
      }
    }
    this.root.updateMatrixWorld(true);
  }

  // -------------------------------------------------------------------------------------------
  // Materials and meshes

  private mat<T extends THREE.MeshStandardMaterial>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private rigid(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    parent: THREE.Object3D,
    modelPos?: THREE.Vector3,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (modelPos) m.position.copy(modelPos);
    parent.add(m);
    return m;
  }

  /** A skinned mesh from bind-pose model-space geometry and a weight function. */
  private skinned(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    weigh: (p: THREE.Vector3) => Weights,
    skeleton: THREE.Skeleton,
  ): void {
    const pos = geo.getAttribute('position');
    const idx = new Uint16Array(pos.count * 4);
    const wts = new Float32Array(pos.count * 4);
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const w = weigh(p)
        .filter(([, x]) => x > 1e-4)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      const sum = w.reduce((s, [, x]) => s + x, 0) || 1;
      w.forEach(([b, x], k) => {
        idx[i * 4 + k] = b;
        wts[i * 4 + k] = x / sum;
      });
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    mesh.bind(skeleton);
  }

  private buildBody(): void {
    const P = PALETTE;
    const canvas = detailTextures(
      128,
      9,
      (u, v) => {
        const twill = 0.5 + 0.5 * Math.sin(TAU * (u * 40 + v * 40));
        const n = fbm(u, v, 4, 3);
        const fine = vnoise(u, v, 64, 9);
        return { h: twill * 0.6 + fine * 0.4, c: 0.84 + 0.1 * n + 0.05 * twill, r: 0.82 + 0.18 * fine };
      },
      2.2,
    );
    const cotton = detailTextures(
      64,
      10,
      (u, v) => {
        const weave = Math.sin(TAU * u * 24) * Math.sin(TAU * v * 24);
        return { h: 0.5 + 0.5 * weave, c: 0.94 + 0.05 * fbm(u, v, 4, 5), r: 0.95 };
      },
      1.2,
    );
    const leather = detailTextures(
      128,
      6,
      (u, v) => {
        const grain = vnoise(u, v, 48, 21);
        const wear = fbm(u, v, 3, 33);
        return { h: grain, c: 0.74 + 0.3 * wear, r: 0.55 + 0.4 * (1 - wear) };
      },
      0.5,
    );
    const hairTex = detailTextures(
      128,
      1,
      (u, v) => {
        const strand = vnoise(u, v * 0.125, 96, 41);
        const clump = vnoise(u, v * 0.125, 24, 43);
        return {
          h: strand * 0.8 + clump * 0.2,
          c: 0.72 + 0.28 * strand * (0.6 + 0.4 * clump),
          r: 0.8 + 0.2 * strand,
        };
      },
      1.5,
    );
    const skinTex = detailTextures(
      64,
      8,
      (u, v) => {
        const n = fbm(u, v, 8, 51);
        return { h: vnoise(u, v, 32, 53), c: 0.93 + 0.07 * n, r: 0.85 + 0.15 * n };
      },
      0.4,
    );

    const fabric = (
      color: string,
      t: Detail,
      sheen: string,
      roughness: number,
      extra: THREE.MeshPhysicalMaterialParameters = {},
    ): THREE.MeshPhysicalMaterial =>
      this.mat(
        new THREE.MeshPhysicalMaterial({
          color,
          map: t.map,
          roughnessMap: t.rough,
          normalMap: t.normal,
          normalScale: new THREE.Vector2(0.3, 0.3),
          roughness,
          sheen: 0.6,
          sheenRoughness: 0.7,
          sheenColor: new THREE.Color(sheen),
          ...extra,
        }),
      );

    const skin = this.mat(
      new THREE.MeshPhysicalMaterial({
        color: P.skin,
        map: skinTex.map,
        roughnessMap: skinTex.rough,
        roughness: 0.58,
        sheen: 0.35,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color('#e0907a'),
      }),
    );
    const jacket = fabric(P.jacket, canvas, '#c9c29a', 0.78, { side: THREE.DoubleSide });
    const jacketEdge = fabric(P.jacketEdge, canvas, '#b8b089', 0.8);
    const shirt = fabric(P.shirt, cotton, '#ffffff', 0.9);
    const trousers = fabric(P.trousers, canvas, '#b08a66', 0.88);
    const neckerchief = fabric(P.neckerchief, cotton, '#e07a66', 0.8);
    const bagLeather = this.mat(
      new THREE.MeshPhysicalMaterial({
        color: P.leather,
        map: leather.map,
        roughnessMap: leather.rough,
        normalMap: leather.normal,
        roughness: 0.62,
        clearcoat: 0.15,
        clearcoatRoughness: 0.6,
      }),
    );
    const bootLeather = this.mat(
      new THREE.MeshPhysicalMaterial({
        color: P.boot,
        map: leather.map,
        roughnessMap: leather.rough,
        normalMap: leather.normal,
        roughness: 0.5,
        clearcoat: 0.3,
        clearcoatRoughness: 0.45,
      }),
    );
    const sole = this.mat(new THREE.MeshStandardMaterial({ color: P.sole, roughness: 0.9 }));
    const hair = this.mat(
      new THREE.MeshPhysicalMaterial({
        color: P.hair,
        map: hairTex.map,
        roughnessMap: hairTex.rough,
        normalMap: hairTex.normal,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.7,
        sheen: 0.35,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color('#7a5236'),
      }),
    );
    const brass = this.mat(new THREE.MeshStandardMaterial({ color: P.brass, roughness: 0.38, metalness: 1 }));
    const lips = this.mat(new THREE.MeshStandardMaterial({ color: P.lips, roughness: 0.45 }));
    const eyeWhite = this.mat(new THREE.MeshStandardMaterial({ color: P.eyeWhite, roughness: 0.25 }));
    const iris = this.mat(new THREE.MeshStandardMaterial({ color: P.iris, roughness: 0.15 }));
    const pencil = this.mat(new THREE.MeshStandardMaterial({ color: P.pencil, roughness: 0.5 }));
    const wood = this.mat(new THREE.MeshStandardMaterial({ color: '#d8b98a', roughness: 0.7 }));
    const graphite = this.mat(
      new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.4, metalness: 0.3 }),
    );
    const eraser = this.mat(new THREE.MeshStandardMaterial({ color: '#b5645a', roughness: 0.8 }));
    const notebook = this.mat(new THREE.MeshStandardMaterial({ color: P.notebook, roughness: 0.75 }));
    const paper = this.mat(new THREE.MeshStandardMaterial({ color: P.paper, roughness: 0.95 }));
    const lace = this.mat(new THREE.MeshStandardMaterial({ color: '#2e2219', roughness: 0.9 }));

    const skeleton = new THREE.Skeleton(this.bones);
    const B = (i: number): THREE.Bone => this.bone(i);
    const local = (i: number, x: number, y: number, z: number): THREE.Vector3 =>
      new THREE.Vector3(x, y, z).sub(at(BIND, i));

    // --- Torso: trousers seat, belt, shirt, jacket --------------------------------------------
    const torsoW = (p: THREE.Vector3): Weights => {
      const a = smooth(0.95, 1.08, p.y);
      const b = smooth(1.1, 1.22, p.y);
      const wH = 1 - a;
      const wS = a * (1 - b);
      const wC = a * b;
      const sd = p.x >= 0 ? RIGHT : LEFT;
      const ax = Math.abs(p.x);
      const sh = smooth(0.07, 0.17, ax) * smooth(1.25, 1.37, p.y);
      const del = smooth(0.13, 0.19, ax) * smooth(1.28, 1.37, p.y) * 0.5;
      const th = smooth(0.95, 0.76, p.y) * smooth(0.02, 0.12, ax) * 0.85;
      return [
        [HIPS, wH * (1 - th)],
        [sd.hipH, wH * th],
        [SPINE, wS],
        [CHEST, wC * (1 - sh)],
        [sd.clav, wC * sh * (1 - del)],
        [sd.shoulderH, wC * sh * del],
      ];
    };
    this.skinned(ringSurface(SEAT, 26, true, true), trousers, torsoW, skeleton);
    this.skinned(
      ringSurface(
        tubeRings(
          [
            [0.953, 0.159],
            [0.958, 0.163],
            [0.987, 0.161],
            [0.992, 0.157],
          ],
          0,
          0,
          0.73,
        ),
        32,
      ),
      bagLeather,
      torsoW,
      skeleton,
    );
    this.skinned(ringSurface(SHIRT, 20), shirt, torsoW, skeleton);
    this.skinned(ringSurface(JACKET, 36), jacket, torsoW, skeleton);
    // Front edge and hem trims give the open jacket some thickness.
    for (const sgn of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let y = 0.745; y <= 1.43; y += 0.03) {
        const r = ringAt(JACKET, y);
        const p = ringPoint(r, sgn > 0 ? (r.a0 ?? 0) : (r.a1 ?? TAU), new THREE.Vector3());
        pts.push(p);
      }
      this.skinned(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.006, 4),
        jacketEdge,
        torsoW,
        skeleton,
      );
    }
    {
      const r = at(JACKET, 0);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++)
        pts.push(ringPoint({ ...r, y: 0.742 }, lerp(r.a0 ?? 0, r.a1 ?? TAU, i / 24), new THREE.Vector3()));
      this.skinned(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.006, 4),
        jacketEdge,
        torsoW,
        skeleton,
      );
    }
    // Collar around the back of the neck.
    this.rigid(
      ringSurface(
        [
          { y: 1.422, rx: 0.088, rzf: 0.074, rzb: 0.084, a0: 0.75, a1: TAU - 0.75 },
          { y: 1.452, rx: 0.083, rzf: 0.07, rzb: 0.082, a0: 0.85, a1: TAU - 0.85 },
          { y: 1.474, rx: 0.088, rzf: 0.074, rzb: 0.088, a0: 0.95, a1: TAU - 0.95 },
        ],
        22,
      ).translate(0, -at(BIND, CHEST).y, 0),
      jacket,
      B(CHEST),
    );
    // Pockets with flaps and buttons.
    const pocket = (bone: number, y: number, phi: number, w: number, h: number): void => {
      const p = new THREE.Vector3();
      const n = new THREE.Vector3();
      surfaceFrame(JACKET, y, phi, p, n);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), n);
      const body = this.rigid(
        roundedBox(w, h, 0.014, 0.25, 8, 4),
        jacket,
        B(bone),
        p.clone().addScaledVector(n, 0.003).sub(at(BIND, bone)),
      );
      body.quaternion.copy(q);
      surfaceFrame(JACKET, y + h * 0.45, phi, p, n);
      const flap = this.rigid(
        roundedBox(w * 1.08, h * 0.36, 0.012, 0.25, 8, 4),
        jacketEdge,
        B(bone),
        p.clone().addScaledVector(n, 0.009).sub(at(BIND, bone)),
      );
      flap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), n);
      this.rigid(
        new THREE.SphereGeometry(0.005, 6, 4),
        brass,
        B(bone),
        p.clone().addScaledVector(n, 0.016).sub(at(BIND, bone)),
      );
    };
    pocket(CHEST, 1.255, 0.62, 0.07, 0.07);
    pocket(CHEST, 1.255, -0.62, 0.07, 0.07);
    pocket(HIPS, 0.84, 0.95, 0.1, 0.1);
    pocket(HIPS, 0.84, -0.95, 0.1, 0.1);
    // Shirt buttons and belt buckle.
    for (const y of [1.2, 1.29, 1.37]) {
      const r = ringAt(SHIRT, y);
      this.rigid(new THREE.SphereGeometry(0.0045, 6, 4), paper, B(CHEST), local(CHEST, 0, y, -r.rzf - 0.002));
    }
    this.rigid(roundedBox(0.045, 0.034, 0.008, 0.3, 10, 6), brass, B(HIPS), local(HIPS, 0, 0.972, -0.121));

    // --- Neck, neckerchief and head ------------------------------------------------------------
    const neck = this.rigid(
      new THREE.CapsuleGeometry(0.044, 0.09, 3, 12),
      skin,
      B(NECK),
      new THREE.Vector3(0, 0.05, -0.005),
    );
    neck.rotation.x = -0.12;
    const kerchief = ringSurface(
      [
        { y: 0.0, rx: 0.056, rzf: 0.06 },
        { y: 0.012, rx: 0.064, rzf: 0.07 },
        { y: 0.036, rx: 0.062, rzf: 0.067 },
        { y: 0.054, rx: 0.054, rzf: 0.057 },
        { y: 0.062, rx: 0.046, rzf: 0.048 },
      ],
      20,
    );
    this.rigid(kerchief, neckerchief, B(NECK), new THREE.Vector3(0, 0, -0.004));
    const knot = this.rigid(
      roundedBox(0.034, 0.028, 0.024, 0.5, 8, 6),
      neckerchief,
      B(NECK),
      new THREE.Vector3(-0.022, 0.022, -0.068),
    );
    knot.rotation.set(0.1, 0.4, 0.2);
    for (const [x, rz] of [
      [-0.036, 0.25],
      [-0.02, -0.15],
    ] as const) {
      const tail = this.rigid(
        roundedBox(0.026, 0.06, 0.006, 0.4, 6, 6),
        neckerchief,
        B(NECK),
        new THREE.Vector3(x, -0.004, -0.074),
      );
      tail.rotation.set(0.3, 0.3, rz);
    }

    const head = B(HEAD);
    const hc = new THREE.Vector3(0, 0.075, -0.015);
    const skull = deform(new THREE.SphereGeometry(1, 26, 20), (p) => {
      headShape(p.clone().normalize(), p);
    });
    this.rigid(skull, skin, head, hc);
    const face = (x: number, y: number, z: number): THREE.Vector3 =>
      hc.clone().add(new THREE.Vector3(x, y, z));
    // Nose: narrow bridge, rounded tip.
    this.rigid(
      deform(new THREE.SphereGeometry(1, 10, 8), (p) => {
        const t = (1 - p.y) / 2; // 0 at the bridge, 1 at the tip
        p.set(p.x * lerp(0.0055, 0.0095, t), p.y * 0.021, p.z * lerp(0.006, 0.011, t) - 0.006 * t * t);
      }),
      skin,
      head,
      face(0, -0.017, -0.0885),
    );
    // Lips.
    for (const [y, r, zs] of [
      [-0.046, 0.0034, 0.5],
      [-0.052, 0.004, 0.55],
    ] as const) {
      const lip = this.rigid(new THREE.CapsuleGeometry(r, 0.014, 2, 6), lips, head, face(0, y, -0.0835));
      lip.rotation.z = Math.PI / 2;
      lip.scale.set(1, 1, zs);
    }
    for (const s of [-1, 1]) {
      this.rigid(new THREE.SphereGeometry(0.011, 10, 8), eyeWhite, head, face(s * 0.031, 0.008, -0.0685));
      const ir = this.rigid(
        new THREE.SphereGeometry(0.0068, 8, 6),
        iris,
        head,
        face(s * 0.0305, 0.008, -0.0785),
      );
      ir.scale.set(1, 1, 0.35);
      const brow = this.rigid(
        new THREE.CapsuleGeometry(0.0026, 0.024, 2, 5),
        hair,
        head,
        face(s * 0.033, 0.027, -0.083),
      );
      brow.rotation.set(0, s * 0.25, Math.PI / 2 - s * 0.1);
      brow.scale.set(1, 1, 0.55);
      const ear = this.rigid(new THREE.SphereGeometry(1, 8, 6), skin, head, face(s * 0.072, 0.0, 0.008));
      ear.scale.set(0.01, 0.025, 0.015);
    }

    // Hair: a shell whose strands converge on the low knot, the knot, a pencil and loose strands.
    const bunLocal = new THREE.Vector3(0, 0.02, 0.1);
    const shellRot = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0.62, 0.78).normalize(),
    );
    const shell = new THREE.SphereGeometry(1, 30, 18, 0, TAU, 0, (Math.PI * 118) / 180);
    const sp = shell.getAttribute('position');
    const d = new THREE.Vector3();
    for (let i = 0; i < sp.count; i++) {
      d.set(sp.getX(i), sp.getY(i), sp.getZ(i)).applyQuaternion(shellRot);
      const top = Math.max(0, d.y);
      headShape(d, _v1, 1.075 + 0.03 * top - 0.02 * Math.max(0, -d.z));
      sp.setXYZ(i, _v1.x, _v1.y, _v1.z);
    }
    shell.computeVertexNormals();
    this.rigid(shell, hair, head, hc);
    const knotG = new THREE.Group();
    knotG.position.copy(bunLocal);
    knotG.rotation.x = -0.35;
    head.add(knotG);
    this.rigid(new THREE.TorusGeometry(0.03, 0.02, 8, 14), hair, knotG);
    this.rigid(new THREE.SphereGeometry(0.03, 12, 8), hair, knotG, new THREE.Vector3(0, 0, 0.008)).scale.set(
      1,
      0.95,
      0.8,
    );
    const twist = this.rigid(
      new THREE.TorusGeometry(0.02, 0.012, 6, 10, Math.PI * 1.3),
      hair,
      knotG,
      new THREE.Vector3(0.006, 0.006, 0.02),
    );
    twist.rotation.set(0.2, 0.3, 0.8);
    // Pencil through the knot.
    const pen = new THREE.Group();
    pen.position.set(0, 0, 0.012);
    pen.rotation.set(0.15, 0.2, 1.05);
    knotG.add(pen);
    this.rigid(new THREE.CylinderGeometry(0.0045, 0.0045, 0.15, 6), pencil, pen);
    this.rigid(
      new THREE.CylinderGeometry(0.0045, 0.0045, 0.012, 8),
      brass,
      pen,
      new THREE.Vector3(0, 0.081, 0),
    );
    this.rigid(
      new THREE.CylinderGeometry(0.0043, 0.0043, 0.012, 8),
      eraser,
      pen,
      new THREE.Vector3(0, 0.093, 0),
    );
    this.rigid(
      new THREE.ConeGeometry(0.0045, 0.02, 6),
      wood,
      pen,
      new THREE.Vector3(0, -0.085, 0),
    ).rotation.x = Math.PI;
    this.rigid(
      new THREE.ConeGeometry(0.0016, 0.006, 6),
      graphite,
      pen,
      new THREE.Vector3(0, -0.097, 0),
    ).rotation.x = Math.PI;
    // --- Arms ----------------------------------------------------------------------------------
    for (const sd of SIDES) {
      const ux = at(BIND, sd.upper).x;
      const uz = at(BIND, sd.upper).z;
      const uy = at(BIND, sd.upper).y;
      const fy = at(BIND, sd.fore).y;
      const hy = at(BIND, sd.hand).y;
      const armW = (p: THREE.Vector3): Weights => {
        if (p.y > uy - 0.14) return zone(p.y, uy - 0.01, 0.07, sd.clav, sd.shoulderH, sd.upper);
        if (p.y > hy + 0.12) return zone(p.y, fy, 0.05, sd.upper, sd.elbowH, sd.fore);
        return zone(p.y, hy, 0.03, sd.fore, sd.fore, sd.hand);
      };
      // Jacket sleeve rolled above the elbow.
      const sleeve = tubeRings(
        [
          [fy + 0.02, 0.04],
          [fy + 0.028, 0.061],
          [fy + 0.042, 0.066],
          [fy + 0.058, 0.066],
          [fy + 0.07, 0.061],
          [fy + 0.075, 0.056],
          [fy + 0.1, 0.054],
          [fy + 0.16, 0.056],
          [uy - 0.06, 0.06],
          [uy - 0.01, 0.063],
          [uy + 0.02, 0.059],
          [uy + 0.042, 0.046],
          [uy + 0.054, 0.024],
        ],
        ux,
        uz,
        0.95,
      );
      this.skinned(ringSurface(sleeve, 16, true, false), jacket, armW, skeleton);
      // Shirt sleeve peeking out under the roll.
      this.skinned(
        ringSurface(
          tubeRings(
            [
              [fy + 0.008, 0.044],
              [fy + 0.014, 0.05],
              [fy + 0.03, 0.052],
            ],
            ux,
            uz,
          ),
          16,
        ),
        shirt,
        armW,
        skeleton,
      );
      // Forearm and wrist.
      const forearm = tubeRings(
        [
          [hy - 0.012, 0.018],
          [hy - 0.004, 0.024],
          [hy + 0.02, 0.027],
          [hy + 0.07, 0.033],
          [hy + 0.13, 0.039],
          [hy + 0.19, 0.042],
          [fy + 0.0, 0.042],
          [fy + 0.03, 0.04],
        ],
        ux,
        uz,
        0.82,
      );
      this.skinned(ringSurface(forearm, 16, false, true), skin, armW, skeleton);
      this.buildHand(sd, skin);
    }

    // --- Legs, boots ---------------------------------------------------------------------------
    for (const sd of SIDES) {
      const s = sd.s;
      const tx = at(BIND, sd.thigh).x;
      const legW = (p: THREE.Vector3): Weights => {
        if (p.y > 0.66) return zone(p.y, 0.86, 0.1, HIPS, sd.hipH, sd.thigh);
        if (p.y > 0.22) return zone(p.y, 0.46, 0.06, sd.thigh, sd.kneeH, sd.shin);
        return zone(p.y, 0.075, 0.04, sd.shin, sd.shin, sd.foot);
      };
      const leg: Ring[] = (
        [
          [0.186, 0.056, 0],
          [0.19, 0.064, 0],
          [0.21, 0.063, 0],
          [0.25, 0.06, 0.001],
          [0.3, 0.062, 0.002],
          [0.38, 0.063, 0.002],
          [0.46, 0.061, 0],
          [0.53, 0.066, 0],
          [0.62, 0.076, 0.003],
          [0.72, 0.086, 0.006],
          [0.8, 0.089, 0.002],
          [0.86, 0.084, -0.004],
          [0.92, 0.07, -0.008],
        ] as const
      ).map(([y, r, dx]) => ({ y, rx: r, rzf: r * 1.04, rzb: r * 1.06, cx: tx + s * dx, cz: 0 }));
      this.skinned(ringSurface(leg, 18, true, false), trousers, legW, skeleton);
      // Ankle-high boot shaft.
      const shaft: Ring[] = (
        [
          [0.03, 0.044, 0.05, 0.058],
          [0.07, 0.047, 0.05, 0.056],
          [0.11, 0.046, 0.049, 0.053],
          [0.15, 0.047, 0.05, 0.053],
          [0.19, 0.049, 0.051, 0.054],
          [0.2, 0.052, 0.054, 0.057],
          [0.204, 0.043, 0.045, 0.047],
        ] as const
      ).map(([y, rx, rzf, rzb]) => ({ y, rx, rzf, rzb, cx: tx, cz: 0.004 }));
      this.skinned(ringSurface(shaft, 16, true, false), bootLeather, legW, skeleton);
      this.buildBoot(sd, bootLeather, sole, lace);
    }

    // --- Satchel on the left hip -------------------------------------------------------------
    this.bagPivot.position.copy(local(HIPS, -0.232, 0.955, -0.015));
    B(HIPS).add(this.bagPivot);
    const bag = new THREE.Group();
    bag.position.set(0, -0.125, 0);
    bag.rotation.y = 1.2;
    this.bagPivot.add(bag);
    const bagBody = deform(roundedBox(0.25, 0.19, 0.068, 0.22, 16, 12), (p) => {
      p.z *= 1 - 0.25 * smooth(0.0, 0.095, p.y);
      p.x *= 1 + 0.03 * smooth(-0.095, 0.0, -p.y);
    });
    this.rigid(bagBody, bagLeather, bag);
    const flap = deform(roundedBox(0.258, 0.15, 0.012, 0.25, 14, 8), (p) => {
      p.z -= 0.012 * (1 - Math.pow((p.y + 0.075) / 0.15, 2));
    });
    const flapM = this.rigid(flap, bagLeather, bag, new THREE.Vector3(0, 0.022, -0.036));
    flapM.rotation.x = -0.04;
    for (const x of [-0.07, 0.07]) {
      this.rigid(
        roundedBox(0.018, 0.1, 0.005, 0.3, 6, 6),
        bootLeather,
        bag,
        new THREE.Vector3(x, -0.045, -0.046),
      );
      this.rigid(roundedBox(0.024, 0.016, 0.005, 0.3, 8, 6), brass, bag, new THREE.Vector3(x, -0.07, -0.05));
    }
    // Field notebook peeking out of the top.
    const book = new THREE.Group();
    book.position.set(-0.05, 0.1, 0.004);
    book.rotation.set(0.05, 0, -0.12);
    bag.add(book);
    this.rigid(roundedBox(0.1, 0.07, 0.016, 0.2, 10, 6), notebook, book);
    this.rigid(new THREE.BoxGeometry(0.094, 0.066, 0.012), paper, book, new THREE.Vector3(0, 0.002, 0));
    this.rigid(
      new THREE.BoxGeometry(0.004, 0.02, 0.003),
      eraser,
      book,
      new THREE.Vector3(0.03, 0.04, -0.002),
    );
    // Strap rings on the bag's top corners.
    for (const x of [-0.118, 0.118]) {
      const ring = this.rigid(
        new THREE.TorusGeometry(0.012, 0.0028, 6, 12),
        brass,
        bag,
        new THREE.Vector3(x, 0.09, 0),
      );
      ring.rotation.y = Math.PI / 2;
    }
    this.buildStrap(bag, bagLeather);
  }

  private buildHand(sd: Side, skin: THREE.Material): void {
    const s = sd.s;
    const hand = this.bone(sd.hand);
    const palm = deform(roundedBox(0.074, 0.088, 0.028, 0.35, 12, 8), (p) => {
      const t = (0.044 - p.y) / 0.088; // 0 at wrist, 1 at knuckles
      p.x *= lerp(0.84, 1, t);
      p.z *= lerp(1.05, 0.8, t);
      p.z += 0.004 * Math.max(0, p.z) * 0; // back of hand stays flat
    });
    this.rigid(palm, skin, hand, new THREE.Vector3(0.002 * s, -0.047, 0.002));
    const fingers = at(this.fingers, s < 0 ? 0 : 1);
    const spec: readonly [number, number, number, number, number][] = [
      // x, knuckle y, proximal length, distal length, radius
      [0.026, -0.086, 0.04, 0.034, 0.0085],
      [0.009, -0.09, 0.044, 0.038, 0.0088],
      [-0.009, -0.088, 0.041, 0.035, 0.0083],
      [-0.025, -0.082, 0.033, 0.028, 0.0074],
    ];
    spec.forEach(([x, ky, l1, l2, r], i) => {
      const base = new THREE.Group();
      base.position.set(x * s, ky, 0);
      base.rotation.z = s * (i - 1.5) * -0.05;
      hand.add(base);
      this.rigid(new THREE.CapsuleGeometry(r, l1 - r, 2, 5), skin, base, new THREE.Vector3(0, -l1 / 2, 0));
      const mid = new THREE.Group();
      mid.position.set(0, -l1, 0);
      base.add(mid);
      this.rigid(
        new THREE.CapsuleGeometry(r * 0.92, l2 - r, 2, 5),
        skin,
        mid,
        new THREE.Vector3(0, -l2 / 2, 0),
      );
      fingers.push({ base, mid, thumb: false });
    });
    const tb = new THREE.Group();
    tb.position.set(0.03 * s, -0.022, -0.01);
    const tbRoot = new THREE.Group();
    tbRoot.rotation.set(0, 0, s * 0.55);
    hand.add(tbRoot);
    tbRoot.add(tb);
    this.rigid(new THREE.CapsuleGeometry(0.0105, 0.03, 2, 5), skin, tb, new THREE.Vector3(0, -0.02, 0));
    const tm = new THREE.Group();
    tm.position.set(0, -0.04, 0);
    tb.add(tm);
    this.rigid(new THREE.CapsuleGeometry(0.0092, 0.022, 2, 5), skin, tm, new THREE.Vector3(0, -0.016, 0));
    fingers.push({ base: tb, mid: tm, thumb: true });
  }

  private buildBoot(
    sd: Side,
    leather: THREE.Material,
    soleMat: THREE.Material,
    laceMat: THREE.Material,
  ): void {
    const foot = this.bone(sd.foot);
    const top = (z: number): number => lerp(-0.014, 0.035, smooth(-0.2, -0.03, z));
    const width = (z: number): number =>
      z < -0.08 ? lerp(0.05, 0.036, smooth(-0.1, -0.2, z)) : lerp(0.05, 0.043, smooth(-0.06, 0.06, z));
    const shape = (p: THREE.Vector3, bottom: number, extraW: number, flatTop: number | null): void => {
      const z = lerp(0.068, -0.198, (1 - p.z) / 2) + 0 * p.z;
      const y01 = (p.y + 1) / 2;
      const t = flatTop ?? top(z);
      p.set(p.x * (width(z) + extraW), lerp(bottom, t, y01), z);
      if (flatTop === null) p.y += 0.008 * smooth(-0.15, -0.2, z) * y01;
      else p.y += 0.01 * smooth(-0.16, -0.205, z) * (1 - y01 * 0.5);
    };
    const upper = deform(new THREE.SphereGeometry(1, 16, 10), (p) => {
      const n = p.clone();
      p.set(sgnPow(n.x, 0.55), sgnPow(n.y, 0.5), sgnPow(n.z, 0.45));
      shape(p, -0.063, 0, null);
    });
    this.rigid(upper, leather, foot);
    const soleG = deform(new THREE.SphereGeometry(1, 16, 5), (p) => {
      const n = p.clone();
      p.set(sgnPow(n.x, 0.35), sgnPow(n.y, 0.3), sgnPow(n.z, 0.4));
      shape(p, -0.075, 0.004, -0.058);
      p.z += 0.004;
    });
    this.rigid(soleG, soleMat, foot);
    // Laces across the instep.
    for (let i = 0; i < 4; i++) {
      const z = -0.035 - i * 0.022;
      const l = this.rigid(
        new THREE.CylinderGeometry(0.0022, 0.0022, width(z) * 1.3, 4),
        laceMat,
        foot,
        new THREE.Vector3(0, top(z) + 0.003, z),
      );
      l.rotation.set(0, i % 2 ? 0.35 : -0.35, Math.PI / 2);
    }
    // Pull tab at the back of the shaft.
    const shin = this.bone(sd.shin);
    this.rigid(
      roundedBox(0.018, 0.028, 0.006, 0.3, 6, 6),
      leather,
      shin,
      new THREE.Vector3(0, 0.2 - at(BIND, sd.shin).y, 0.058),
    );
  }

  private buildStrap(bag: THREE.Object3D, mat: THREE.Material): void {
    const add = (bone: THREE.Object3D, pos: THREE.Vector3, nrm: THREE.Vector3): void => {
      this.strapPoints.push({ bone, pos, nrm });
    };
    const bind = (i: number): THREE.Vector3 => at(BIND, i);
    const onJacket = (x: number, y: number, front: boolean): void => {
      const r = ringAt(JACKET, y);
      const phi = front
        ? Math.asin(clamp(x / r.rx, -0.99, 0.99))
        : Math.PI - Math.asin(clamp(x / r.rx, -0.99, 0.99));
      const p = new THREE.Vector3();
      const n = new THREE.Vector3();
      surfaceFrame(JACKET, y, phi, p, n);
      p.addScaledVector(n, 0.012);
      const bone = y >= 1.13 ? CHEST : y >= 1.03 ? SPINE : HIPS;
      add(this.bone(bone), p.sub(bind(bone)), n);
    };
    add(bag, new THREE.Vector3(0.122, 0.1, 0), new THREE.Vector3(0, 0, -1));
    add(bag, new THREE.Vector3(0.114, 0.16, 0.004), new THREE.Vector3(0, 0, -1));
    const front: [number, number][] = [
      [-0.175, 0.985],
      [-0.13, 1.06],
      [-0.07, 1.14],
      [-0.01, 1.22],
      [0.045, 1.3],
      [0.085, 1.36],
      [0.1, 1.395],
    ];
    for (const [x, y] of front) onJacket(x, y, true);
    add(
      this.bone(CHEST),
      new THREE.Vector3(0.108, 1.432, -0.02).sub(bind(CHEST)),
      new THREE.Vector3(0.25, 1, -0.2).normalize(),
    );
    add(
      this.bone(CHEST),
      new THREE.Vector3(0.108, 1.426, 0.035).sub(bind(CHEST)),
      new THREE.Vector3(0.25, 1, 0.3).normalize(),
    );
    const back: [number, number][] = [
      [0.09, 1.38],
      [0.04, 1.3],
      [-0.03, 1.2],
      [-0.1, 1.1],
      [-0.155, 1.02],
    ];
    for (const [x, y] of back) onJacket(x, y, false);
    add(bag, new THREE.Vector3(-0.114, 0.16, 0.004), new THREE.Vector3(0, 0, -1));
    add(bag, new THREE.Vector3(-0.122, 0.1, 0), new THREE.Vector3(0, 0, -1));

    const sections = this.strapSamples;
    const count = sections * 8;
    this.strapGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.strapGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < sections; i++) {
      for (let k = 0; k < 8; k++) {
        uv[(i * 8 + k) * 2] = (k % 2) * 0.035;
        uv[(i * 8 + k) * 2 + 1] = i * 0.03;
      }
    }
    this.strapGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let i = 0; i < sections - 1; i++) {
      for (let f = 0; f < 4; f++) {
        const a = i * 8 + f * 2;
        const b = a + 1;
        const c = a + 8;
        const d = b + 8;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.strapGeo.setIndex(idx);
    const strap = new THREE.Mesh(this.strapGeo, mat);
    strap.castShadow = true;
    strap.receiveShadow = true;
    strap.frustumCulled = false;
    this.root.add(strap);
    this.strapCurve.points = this.strapPoints.map(() => new THREE.Vector3());
  }

  // -------------------------------------------------------------------------------------------
  // Secondary motion

  private updateBag(dt: number): void {
    // Hips world position from the root transform (the caller moves the root).
    const hips = this.bone(HIPS);
    _v1.copy(hips.position).applyQuaternion(this.root.quaternion).add(this.root.position);
    if (!this.bagInit || _v1.distanceTo(this.hipsPrev) > 1.5 || dt <= 0) {
      this.hipsPrev.copy(_v1);
      this.hipsVel.set(0, 0, 0);
      this.bagInit = true;
      return;
    }
    const vel = _v2.copy(_v1).sub(this.hipsPrev).divideScalar(dt);
    const acc = _v3.copy(vel).sub(this.hipsVel).divideScalar(dt);
    this.hipsVel.lerp(vel, 1 - Math.exp(-dt * 30));
    this.hipsPrev.copy(_v1);
    // Acceleration in the hips frame.
    _q1.copy(this.root.quaternion).multiply(hips.quaternion).invert();
    acc.applyQuaternion(_q1);
    acc.clampLength(0, 60);
    const L = 0.14;
    const k = 55;
    const damping = 5.5;
    // Pendulum: forward acceleration swings the bag back (rotation about X), sideways about Z.
    const steps = Math.ceil(dt * 120);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const ax = (acc.z / L) * 0.12 - k * this.bagAngle.x - damping * this.bagVel.x;
      const az = (-acc.x / L) * 0.12 - k * this.bagAngle.y - damping * this.bagVel.y;
      this.bagVel.x += ax * h;
      this.bagVel.y += az * h;
      this.bagAngle.x = clamp(this.bagAngle.x + this.bagVel.x * h, -0.7, 0.7);
      this.bagAngle.y = clamp(this.bagAngle.y + this.bagVel.y * h, -0.05, 0.5);
    }
    // Hips pitch is undone so the bag keeps hanging when the body bends.
    _e.setFromQuaternion(hips.quaternion, 'XYZ');
    this.bagPivot.rotation.set(this.bagAngle.x - _e.x * 0.7, 0, this.bagAngle.y - Math.min(0, _e.z) * 0.5);
    this.bagPivot.updateMatrixWorld(true);
  }

  /** Strap normals in Nora's space, reused every frame (the strap updates per frame). */
  private readonly strapNormals: THREE.Vector3[] = [];

  private updateStrap(): void {
    _m1.copy(this.root.matrixWorld).invert();
    const pts = this.strapCurve.points;
    const normals = this.strapNormals;
    _q2.setFromRotationMatrix(this.root.matrixWorld).invert();
    for (let i = 0; i < this.strapPoints.length; i++) {
      const sp = at(this.strapPoints, i);
      at(pts, i).copy(sp.pos).applyMatrix4(sp.bone.matrixWorld).applyMatrix4(_m1);
      _q1.setFromRotationMatrix(sp.bone.matrixWorld);
      const nv = (normals[i] ??= new THREE.Vector3());
      nv.copy(sp.nrm).applyQuaternion(_q1).applyQuaternion(_q2);
    }
    normals.length = this.strapPoints.length;
    const pos = this.strapGeo.getAttribute('position');
    const nrm = this.strapGeo.getAttribute('normal');
    const n = this.strapSamples;
    const w = 0.017;
    const th = 0.0035;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.strapCurve.getPoint(t, _v1);
      // The tangent by central difference (Curve.getTangent allocates two vectors per call).
      this.strapCurve.getPoint(Math.max(0, t - 1e-4), _t1);
      this.strapCurve.getPoint(Math.min(1, t + 1e-4), _t2);
      _v2.subVectors(_t2, _t1).normalize();
      const f = t * (normals.length - 1);
      const i0 = Math.floor(f);
      const nA = at(normals, i0);
      const nB = at(normals, Math.min(normals.length - 1, i0 + 1));
      _v3.lerpVectors(nA, nB, f - i0);
      const side = _v4.crossVectors(_v2, _v3).normalize();
      const up = _v5.crossVectors(side, _v2).normalize();
      for (let k = 0; k < STRAP_CORNERS.length; k++) {
        const corner = at(STRAP_CORNERS, k);
        const sx = corner[0];
        const sy = corner[1];
        const vi = i * 8 + k;
        pos.setXYZ(
          vi,
          _v1.x + side.x * sx * w + up.x * sy * th,
          _v1.y + side.y * sx * w + up.y * sy * th,
          _v1.z + side.z * sx * w + up.z * sy * th,
        );
        // Faces alternate top/bottom (up) and the sides (side); bottom and side - face away.
        const face = Math.floor(k / 2);
        const fn = face % 2 === 0 ? up : side;
        const sg = face === 2 || face === 3 ? -1 : 1;
        nrm.setXYZ(vi, fn.x * sg, fn.y * sg, fn.z * sg);
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }

  // -------------------------------------------------------------------------------------------
  // Pose evaluation

  private evaluate(pose: NoraPose, dt: number, out: Pose): void {
    out.reset();
    out.curl[0] = out.curl[1] = 0.35;
    switch (pose.mode) {
      case 'ground':
        this.evalGround(pose, dt, out);
        break;
      case 'air':
        this.evalAir(pose, out);
        break;
      case 'hang':
        this.evalHang(pose, out);
        break;
      case 'climb':
        this.evalClimb(pose, out);
        break;
      case 'block':
      case 'push':
      case 'pull':
        this.evalBlock(pose, out);
        break;
      case 'lever':
        this.evalLever(pose, out);
        break;
      case 'pickup':
        this.evalPickup(pose, out);
        break;
      case 'dead':
        this.evalDead(pose, out);
        break;
    }
  }

  /**
   * Aiming layer over the mode's pose: the torso twists towards the aim and
   * both arms reach along it (two-bone IK), pistols gripped. Holding them
   * ready, the arms point low ahead. Legs and hips are left untouched.
   */
  private applyAim(pose: NoraPose, dt: number, p: Pose): void {
    const armed = pose.mode === 'ground' || pose.mode === 'air' ? pose.weapons : 0;
    this.aimW += (armed - this.aimW) * (1 - Math.exp(-dt * 14));
    this.aimAiming += (pose.aiming - this.aimAiming) * (1 - Math.exp(-dt * 12));
    const k = 1 - Math.exp(-dt * 16);
    this.aimYaw += (pose.aimYaw - this.aimYaw) * k;
    this.aimPitch += (pose.aimPitch - this.aimPitch) * k;
    const w = this.aimW;
    if (w < 1e-3) return;

    const a = this.aimAiming;
    const yaw = this.aimYaw * a;
    const pitch = lerp(-0.75, clamp(this.aimPitch, -1, 0.9), a);
    const q = this.aimQ.copy(p);
    // Torso: a twist of up to ~1 rad shared by spine and chest; the arms cover the rest.
    const twist = clamp(yaw, -1.0, 1.0);
    at(q.q, SPINE).multiply(_q1.setFromAxisAngle(_v1.set(0, 1, 0), twist * 0.35));
    at(q.q, CHEST).multiply(_q1.setFromAxisAngle(_v1.set(0, 1, 0), twist * 0.65));
    at(q.q, CHEST).multiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0), pitch * 0.25 * a));
    const dir = _v2.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const aimDir = dir.clone();
    const up = new THREE.Vector3(0, 1, 0);
    for (const sd of SIDES) {
      const s = sd.s;
      this.rot(q, sd.clav, 0, s * 0.12 * a, s * 0.04);
      this.fk(q, sd.upper, _v3, _q2);
      // Arms nearly straight when aiming, each from its own shoulder so the two
      // pistols stay side by side (converging, the hands met and the pistols
      // overlapped); bent and a little toed in holding them ready.
      const reach = lerp(0.38, 0.505, a);
      const inward = new THREE.Vector3().crossVectors(up, aimDir).multiplyScalar(s).normalize();
      const wrist = _v3
        .clone()
        .addScaledVector(aimDir, reach)
        .addScaledVector(inward, lerp(0.05, 0.012, a));
      const fingers = aimDir.clone().addScaledVector(up, -0.3).normalize();
      this.armIK(q, sd, wrist, new THREE.Vector3(s * 0.9, -0.6, 0.2), fingers, inward);
      q.curl[s < 0 ? 0 : 1] = 0.95;
    }
    for (const j of AIM_JOINTS) at(p.q, j).slerp(at(q.q, j), w);
    p.curl[0] = lerp(p.curl[0] ?? 0, q.curl[0] ?? 0, w);
    p.curl[1] = lerp(p.curl[1] ?? 0, q.curl[1] ?? 0, w);
  }

  // --- Pose building blocks --------------------------------------------------------------------

  private rot(p: Pose, j: number, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): void {
    at(p.q, j).setFromEuler(_e.set(x, y, z, order));
  }

  private armFK(p: Pose, sd: Side, flex: number, abd: number, elbow: number, twist = 0, wrist = 0): void {
    const s = sd.s;
    this.rot(p, sd.upper, flex, s * twist, s * abd);
    this.rot(p, sd.fore, elbow, 0, 0);
    this.rot(p, sd.hand, wrist, s * (Math.PI / 2), 0, 'YXZ');
  }

  private legFK(p: Pose, sd: Side, flex: number, abd: number, knee: number, foot: number, twist = 0): void {
    const s = sd.s;
    this.rot(p, sd.thigh, flex, s * twist, s * abd);
    this.rot(p, sd.shin, -knee, 0, 0);
    this.rot(p, sd.foot, foot, 0, 0);
  }

  private clav(p: Pose, sd: Side, shrug: number, protract: number): void {
    this.rot(p, sd.clav, 0, sd.s * protract, sd.s * shrug);
  }

  /** Model-space position and rotation of a joint for pose p. */
  private fk(p: Pose, j: number, pos: THREE.Vector3, q: THREE.Quaternion): void {
    const chain = at(CHAIN, j);
    pos.copy(p.pos);
    q.copy(at(p.q, HIPS));
    for (let i = 1; i < chain.length; i++) {
      const k = at(chain, i);
      pos.add(_v5.copy(at(OFFSET, k)).applyQuaternion(q));
      q.multiply(at(p.q, k));
    }
  }

  /**
   * Analytic two-bone IK. `bend` is +1 for arms (elbow flexes about +X) and -1 for legs.
   * The pole is the model-space direction the middle joint should point to.
   */
  private twoBone(
    p: Pose,
    upper: number,
    target: THREE.Vector3,
    pole: THREE.Vector3,
    bend: number,
    a: number,
    b: number,
  ): void {
    const parent = PARENT[upper] ?? HIPS;
    const S = _v1;
    const pq = _q1;
    this.fk(p, parent, S, pq);
    S.add(_v2.copy(at(OFFSET, upper)).applyQuaternion(pq));
    const d = _v2.copy(target).sub(S);
    let dist = d.length();
    const u = dist > 1e-6 ? d.divideScalar(dist) : d.set(0, -1, 0);
    const max = (a + b) * 0.999;
    const soft = max * 0.965;
    if (dist > soft) dist = soft + (max - soft) * (1 - Math.exp(-(dist - soft) / (max - soft)));
    dist = Math.max(dist, Math.abs(a - b) + 1e-3);
    const pp = _v3.copy(pole).addScaledVector(u, -pole.dot(u));
    if (pp.lengthSq() < 1e-8) pp.set(0, 0, 1).addScaledVector(u, -u.z);
    pp.normalize();
    const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const d1 = _v4.copy(u).multiplyScalar(cosA).addScaledVector(pp, sinA);
    // End point minus elbow, divided by b, is the lower bone direction.
    const d2 = new THREE.Vector3().copy(u).multiplyScalar(dist).addScaledVector(d1, -a).divideScalar(b);
    const yl = new THREE.Vector3().copy(d1).negate();
    const zl = new THREE.Vector3().copy(pp).addScaledVector(d1, -pp.dot(d1)).normalize().multiplyScalar(bend);
    const xl = new THREE.Vector3().crossVectors(yl, zl);
    _m1.makeBasis(xl, yl, zl);
    const qm = _q2.setFromRotationMatrix(_m1);
    at(p.q, upper).copy(pq).invert().multiply(qm);
    const flex = Math.acos(clamp(d1.dot(d2), -1, 1));
    at(p.q, upper + 1).setFromAxisAngle(_v5.set(1, 0, 0), bend * flex);
  }

  /** Orients joint j so its -Y axis follows `along` and its -Z axis faces `facing` (model space). */
  private orient(p: Pose, j: number, along: THREE.Vector3, facing: THREE.Vector3): void {
    const parent = PARENT[j] ?? HIPS;
    this.fk(p, parent, _v1, _q1);
    const yl = _v2.copy(along).normalize().negate();
    const zl = _v3.copy(facing).negate();
    zl.addScaledVector(yl, -zl.dot(yl)).normalize();
    const xl = _v4.crossVectors(yl, zl);
    _m1.makeBasis(xl, yl, zl);
    _q2.setFromRotationMatrix(_m1);
    at(p.q, j).copy(_q1).invert().multiply(_q2);
  }

  private armIK(
    p: Pose,
    sd: Side,
    wrist: THREE.Vector3,
    pole: THREE.Vector3,
    fingers: THREE.Vector3,
    palm: THREE.Vector3,
  ): void {
    this.twoBone(p, sd.upper, wrist, pole, 1, UPPER_LEN, FORE_LEN);
    this.orient(p, sd.hand, fingers, palm);
  }

  private legIK(
    p: Pose,
    sd: Side,
    ankle: THREE.Vector3,
    pitch: number,
    yaw: number,
    pole?: THREE.Vector3,
  ): void {
    const pl = pole ?? _v5.set(sd.s * 0.12, 0, -1).applyQuaternion(at(p.q, HIPS));
    pl.y = Math.min(pl.y, 0.2);
    this.twoBone(p, sd.thigh, ankle, pl.clone(), -1, THIGH_LEN, SHIN_LEN);
    // Foot: yaw then pitch in model space.
    this.fk(p, sd.shin, _v1, _q1);
    _q2.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    at(p.q, sd.foot).copy(_q1).invert().multiply(_q2);
  }

  /** Stance-leg ankle position for a foot planted at flat ankle z `zf`, rolled by pitch. */
  private rolledAnkle(zf: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(pitch);
    const sn = Math.sin(pitch);
    if (pitch >= 0) {
      // Rolling on the heel (toes up).
      const hz = zf + 0.065;
      return out.set(out.x, 0.075 * c + 0.065 * sn, hz + 0.075 * sn - 0.065 * c);
    }
    const bz = zf - 0.135;
    return out.set(out.x, 0.075 * c - 0.135 * sn, bz + 0.075 * sn + 0.135 * c);
  }

  /**
   * Gait foot target: phase 0..1 (0 = heel strike), stance fraction `duty`, stance travel D
   * (positive = moving forward), `back` shifts the stance range behind the hips.
   */
  private gaitFoot(
    ph: number,
    duty: number,
    D: number,
    back: number,
    lift: number,
    run: number,
    roll: number,
    out: THREE.Vector3,
  ): number {
    const heel = 0.28 * roll;
    const toe = -0.6 * roll;
    const stance = (sv: number, o: THREE.Vector3): number => {
      const zf = -D / 2 + D * sv + back;
      let pitch = 0;
      if (sv < 0.22) pitch = lerp(heel, 0, ease(sv / 0.22));
      else if (sv > 0.55) pitch = toe * ease((sv - 0.55) / 0.45);
      this.rolledAnkle(zf, pitch, o);
      return pitch;
    };
    if (ph < duty) return stance(ph / duty, out);
    const sw = (ph - duty) / (1 - duty);
    const a = _v4.copy(out);
    const b = _v5.copy(out);
    const pa = stance(1, a);
    const pb = stance(0, b);
    // Walking swing: a low arc between toe-off and heel strike.
    const wy = lerp(a.y, b.y, sw) + lift * Math.sin(Math.PI * sw);
    const wz = lerp(a.z, b.z, smoother(sw));
    // Running swing: heel kicks up behind, knee drives forward, the foot reaches and lands.
    const st = Math.min(1, Math.abs(D) / 0.9);
    const ry = keys(
      [
        [0, a.y],
        [0.3, 0.4 * st + a.y * (1 - st)],
        [0.58, 0.34 * st + 0.1],
        [0.82, 0.16],
        [1, b.y],
      ],
      sw,
    );
    const rz = keys(
      [
        [0, a.z],
        [0.3, a.z - 0.12 * st],
        [0.58, 0.02 * st],
        [0.82, b.z - 0.06 * st],
        [1, b.z],
      ],
      sw,
    );
    out.set(out.x, lerp(wy, ry, run), lerp(wz, rz, run));
    return (
      lerp(pa, pb, sw) +
      0.25 * roll * Math.sin(Math.PI * sw) -
      0.5 * run * Math.sin(Math.PI * Math.min(1, sw * 1.4))
    );
  }

  private idleLook(): { yaw: number; pitch: number } {
    const t = this.time;
    const s = Math.sin(t * 0.21) * 0.7 + Math.sin(t * 0.53 + 1.3) * 0.3;
    const yaw = 0.55 * Math.sign(s) * smooth(0.35, 0.85, Math.abs(s));
    const pitch = 0.07 * Math.sin(t * 0.37 + 0.4) - 0.03;
    return { yaw, pitch };
  }

  // --- Modes -----------------------------------------------------------------------------------

  private evalGround(pose: NoraPose, dt: number, p: Pose): void {
    const v = this.speed;
    const t = this.time;
    const w = smooth(0.05, 1.0, v);
    const r = smooth(2.5, 5.0, v);
    const cadence = v < 2.2 ? lerp(1.5, 2.35, v / 2.2) : lerp(2.35, 3.0, clamp((v - 2.2) / 3.2, 0, 1));
    const cyc = cadence / 2;
    this.phase = frac(this.phase + dt * cyc);
    const ph = this.phase;
    const duty = lerp(0.6, 0.3, r);
    const D = Math.min(lerp(1.0, 0.9, r), (v * duty) / cyc);
    const back = lerp(0.03, 0.07, r);
    const low = smooth(35, 10, pose.health);

    // Breathing and idle weight shift.
    const breath = Math.sin((t * TAU) / 4.2);
    const shift = 0.022 * Math.sin((t * TAU) / 7.5) + 0.006 * Math.sin(t * 1.3);

    // Hips.
    const midSt = Math.cos(2 * TAU * (ph - duty / 2));
    const bob = lerp(0.018, -0.03, r) * midSt;
    const hipsY =
      HIPS_Y +
      w * (-lerp(0.02, 0.04, r) + bob) +
      (1 - w) * (-0.008 + 0.003 * breath) +
      this.dipPos -
      low * 0.04;
    const hipsX = lerp(shift, lerp(0.02, 0.008, r) * Math.cos(TAU * (ph - duty / 2)), w);
    p.pos.set(hipsX, hipsY, lerp(0.005, -0.02 * r, w));
    const hipYaw = w * lerp(0.12, 0.09, r) * Math.cos(TAU * ph);
    const hipRoll = lerp(shift * 2.2, lerp(0.06, 0.03, r) * Math.sin(TAU * ph), w);
    const hipPitch = -w * lerp(0.03, 0.1, r);
    this.rot(p, HIPS, hipPitch, hipYaw, hipRoll);

    const accLean = clamp(-this.accel * 0.012, -0.12, 0.12);
    const spinePitch = -w * lerp(0.03, 0.07, r) + accLean * 0.6 - low * 0.08 + (1 - w) * 0.01 * breath;
    const chestPitch = -w * lerp(0.02, 0.06, r) + accLean * 0.4 + 0.02 * breath * (1 - w * 0.5) - low * 0.1;
    this.rot(p, SPINE, spinePitch, -hipYaw * 0.5, -hipRoll * 0.6);
    this.rot(p, CHEST, chestPitch, -hipYaw * 0.9, -hipRoll * 0.3);
    const lean = hipPitch + spinePitch + chestPitch;
    const look = this.idleLook();
    const idleW = 1 - w;
    this.rot(p, NECK, -lean * 0.35 + look.pitch * 0.4 * idleW, look.yaw * 0.4 * idleW + hipYaw * 0.3, 0);
    this.rot(
      p,
      HEAD,
      -lean * 0.45 + look.pitch * 0.6 * idleW + low * 0.1,
      look.yaw * 0.6 * idleW + hipYaw * 0.3,
      -hipRoll * 0.3,
    );

    // Arms.
    const swing = w * lerp(0.38, 0.72, r);
    const baseFlex = w * lerp(0.04, 0.28, r);
    for (const sd of SIDES) {
      const s = sd.s;
      const c = Math.cos(TAU * ph) * s;
      const flex = -swing * c + baseFlex + (1 - w) * 0.01 * breath;
      const elbow = lerp(
        0.14 + 0.02 * breath,
        lerp(0.3, 1.45, r) + Math.max(0, flex) * lerp(0.35, 0.3, r),
        w,
      );
      const abd =
        lerp(0.1 + (s < 0 ? 0.07 : 0) + 0.01 * breath, lerp(0.14, 0.2, r) + (s < 0 ? 0.06 : 0), w) +
        low * 0.05;
      this.armFK(p, sd, flex, abd, elbow, -0.15 * r * w, -0.1 * r);
      this.clav(p, sd, 0.02 * breath * (1 - w) - 0.03 * r, 0.06 * r * w * -c);
      p.curl[s < 0 ? 0 : 1] = lerp(0.38, lerp(0.35, 0.95, r), w);
    }

    // Legs: planted idle feet blended with gait targets.
    const yawQ = at(p.q, HIPS);
    for (const sd of SIDES) {
      const s = sd.s;
      const fph = frac(ph + (s > 0 ? 0 : 0.5));
      const gait = _v1.set(s * lerp(0.095, 0.075, r), 0, 0);
      const pitchG = this.gaitFoot(fph, duty, D, back, lerp(0.07, 0.1, r), r, smooth(0, 0.6, D), gait);
      const idle = _v2.set(s > 0 ? 0.105 : -0.1, 0.075, s > 0 ? 0.02 : -0.045);
      const target = new THREE.Vector3().lerpVectors(idle, gait, w);
      const pitch = pitchG * w;
      _e.setFromQuaternion(yawQ, 'YXZ');
      this.legIK(p, sd, target, pitch, s * 0.1 + _e.y * 0.3);
    }
  }

  private evalAir(pose: NoraPose, p: Pose): void {
    const t = pose.modeTime;
    const vy = pose.vy;
    const up = smooth(-1.5, 2.0, vy);
    const fl = smooth(-8, -11, vy);
    const hz = smooth(0.8, 3.0, pose.speed);
    const tuck = smooth(0.0, 0.22, t);
    p.pos.set(0, HIPS_Y + 0.02, 0);
    this.rot(p, HIPS, lerp(0.04, lerp(-0.12, -0.2, hz), up), 0, 0.03 * Math.sin(t * 2));
    this.rot(p, SPINE, lerp(0.02, -0.08, up), 0, 0);
    this.rot(p, CHEST, lerp(0.04, -0.04, up) + fl * 0.1 * Math.sin(t * 7), 0, 0);
    this.rot(p, NECK, lerp(-0.1, 0.08, up), 0, 0);
    this.rot(p, HEAD, lerp(-0.18, 0.12, up), 0, 0);

    for (const sd of SIDES) {
      const s = sd.s;
      const R = s > 0;
      // Rising: reach forward-up, tuck legs (running jump: stride split).
      let aFlex = lerp(2.3, 1.9, hz) * tuck + 0.3 * (1 - tuck);
      let aAbd = 0.25;
      let aElb = lerp(0.35, 0.25, hz);
      let tFlex = lerp(R ? 0.95 : 0.55, R ? 0.95 : -0.3, hz) * tuck - 0.05 * (1 - tuck);
      let knee = lerp(R ? 1.4 : 1.05, R ? 0.7 : 1.35, hz) * tuck + 0.1 * (1 - tuck);
      let foot = lerp(-0.2, -0.5, 1 - tuck);
      // Falling: arms out, legs loose.
      const wave = Math.sin(t * 3 + (R ? 0 : 1.5));
      const fFlex = 0.55 + 0.1 * wave;
      const fAbd = 1.25 + 0.12 * wave;
      aFlex = lerp(fFlex, aFlex, up);
      aAbd = lerp(fAbd, aAbd, up);
      aElb = lerp(0.45, aElb, up);
      tFlex = lerp(R ? 0.4 : 0.08, tFlex, up);
      knee = lerp(R ? 0.65 : 0.3, knee, up);
      foot = lerp(-0.35, foot, up);
      // Long fall: flailing.
      const ft = t * 10 + (R ? 0 : Math.PI);
      aFlex = lerp(aFlex, 1.5 + 1.3 * Math.sin(ft), fl);
      aAbd = lerp(aAbd, 1.0 + 0.5 * Math.cos(ft), fl);
      aElb = lerp(aElb, 0.6 + 0.4 * Math.sin(ft + 1), fl);
      tFlex = lerp(tFlex, 0.45 + 0.55 * Math.sin(ft * 0.8), fl);
      knee = lerp(knee, 0.8 + 0.5 * Math.sin(ft * 0.8 + 1.2), fl);
      this.armFK(p, sd, aFlex, aAbd, aElb, 0, 0);
      this.clav(p, sd, 0.08 * up + 0.1 * fl, 0.05);
      this.legFK(p, sd, tFlex, 0.06 + 0.1 * fl, knee, foot);
      p.curl[R ? 1 : 0] = lerp(0.2, 0.35, fl);
    }
  }

  private evalHang(pose: NoraPose, p: Pose): void {
    const t = pose.modeTime;
    const amp = 0.06 * Math.exp(-1.6 * t) + 0.015;
    const sway = amp * Math.sin(2.6 * t);
    p.pos.set(0, HIPS_Y + 0.09, -0.04 - sway * 0.3);
    this.rot(p, HIPS, 0.04 + sway, 0, 0.01 * Math.sin(t * 1.1));
    this.rot(p, SPINE, -0.05 - sway * 0.5, 0, 0);
    this.rot(p, CHEST, -0.04 - sway * 0.3, 0, 0);
    this.rot(p, NECK, 0.1, 0, 0);
    this.rot(p, HEAD, 0.22, 0.04 * Math.sin(t * 0.5), 0);
    for (const sd of SIDES) {
      const s = sd.s;
      this.clav(p, sd, 0.24, 0.02);
      this.armIK(
        p,
        sd,
        _v1.set(s * 0.18, 1.925, -0.285).clone(),
        new THREE.Vector3(s * 0.8, -0.25, 0.6),
        new THREE.Vector3(0, 1, -0.3),
        new THREE.Vector3(0, 0.15, -1),
      );
      p.curl[s < 0 ? 0 : 1] = 1.05;
      const ls = Math.sin(t * 1.3 + (s > 0 ? 0 : 1.7));
      this.legFK(p, sd, (s > 0 ? 0.12 : -0.02) + 0.04 * ls - sway * 0.5, 0.04, s > 0 ? 0.38 : 0.2, -0.45);
    }
  }

  private evalClimb(pose: NoraPose, p: Pose): void {
    const t = clamp(pose.climbT, 0, 1);
    // Root motion replicated from the simulation's climb (lift 0..0.6, forward 0.45..1).
    const H = 2.0;
    const L = 0.84;
    const dy = H * ease(Math.min(1, t / 0.6));
    const fw = L * ease(Math.max(0, (t - 0.45) / 0.55));
    const ledgeY = H - dy;
    const edgeZ = -0.34 + fw;
    const toModel = (x: number, y: number, z: number, o: THREE.Vector3): THREE.Vector3 =>
      o.set(x, y - dy, z + fw);

    p.pos.set(
      0,
      HIPS_Y +
        keys(
          [
            [0, 0.09],
            [0.2, 0.06],
            [0.35, 0.0],
            [0.5, -0.06],
            [0.65, -0.12],
            [0.85, -0.03],
            [1, 0],
          ],
          t,
        ),
      keys(
        [
          [0, -0.04],
          [0.3, -0.1],
          [0.45, -0.17],
          [0.6, -0.12],
          [0.8, -0.03],
          [1, 0],
        ],
        t,
      ),
    );
    this.rot(
      p,
      HIPS,
      keys(
        [
          [0, 0.04],
          [0.25, -0.1],
          [0.4, -0.42],
          [0.55, -0.5],
          [0.7, -0.3],
          [0.85, -0.1],
          [1, 0],
        ],
        t,
      ),
      0,
      0,
    );
    this.rot(
      p,
      SPINE,
      keys(
        [
          [0, -0.05],
          [0.25, -0.15],
          [0.4, -0.25],
          [0.55, -0.2],
          [0.7, -0.1],
          [1, 0],
        ],
        t,
      ),
      0,
      0,
    );
    this.rot(
      p,
      CHEST,
      keys(
        [
          [0, -0.04],
          [0.25, -0.12],
          [0.45, -0.2],
          [0.7, -0.08],
          [1, 0],
        ],
        t,
      ),
      0,
      0,
    );
    this.rot(
      p,
      NECK,
      keys(
        [
          [0, 0.1],
          [0.4, 0.25],
          [0.7, 0.1],
          [1, 0],
        ],
        t,
      ),
      0,
      0,
    );
    this.rot(
      p,
      HEAD,
      keys(
        [
          [0, 0.22],
          [0.3, 0.3],
          [0.6, 0.2],
          [1, 0],
        ],
        t,
      ),
      0,
      0,
    );

    const press = smooth(0.12, 0.3, t);
    const release = smooth(0.52, 0.85, t);
    for (const sd of SIDES) {
      const s = sd.s;
      this.clav(p, sd, lerp(0.24, 0.05, press) * (1 - release), 0.06 * press * (1 - release));
      // Hands on the ledge (world-fixed), then back to the sides.
      const grip = new THREE.Vector3(s * 0.18, ledgeY - 0.075, edgeZ + 0.055);
      const flat = new THREE.Vector3(s * 0.21, ledgeY + 0.03, edgeZ - 0.08);
      const rest = new THREE.Vector3(s * 0.22, 0.86, 0.0);
      const wrist = grip.lerp(flat, press).lerp(rest, release);
      const fingers = new THREE.Vector3(0, 1, -0.3)
        .lerp(new THREE.Vector3(s * 0.2, 0, -1), press)
        .lerp(new THREE.Vector3(0, -1, 0), release);
      const palm = new THREE.Vector3(0, 0.15, -1)
        .lerp(new THREE.Vector3(0, -1, 0), press)
        .lerp(new THREE.Vector3(-s, 0, 0), release);
      const pole = new THREE.Vector3(s * 0.8, -0.25, 0.6)
        .lerp(new THREE.Vector3(s * 0.4, 0.3, 1), press)
        .lerp(new THREE.Vector3(s * 0.3, 0, 1), release);
      this.armIK(p, sd, wrist, pole, fingers, palm);
      p.curl[s < 0 ? 0 : 1] = lerp(lerp(1.05, 0.15, press), 0.38, release);
    }
    // Legs: the right knee comes up onto the ledge first, the left leg follows.
    const dangleR = new THREE.Vector3(0.09, 0.035, 0.03);
    const dangleL = new THREE.Vector3(-0.09, 0.05, 0.0);
    const plantR = toModel(0.1, H + 0.075, -0.46, new THREE.Vector3());
    const finalR = toModel(0.105, H + 0.075, -L + 0.02, new THREE.Vector3());
    const finalL = toModel(-0.1, H + 0.075, -L - 0.045, new THREE.Vector3());
    const upR = ease((t - 0.28) / 0.2);
    const stepR = ease((t - 0.7) / 0.2);
    const r = dangleR.clone().lerp(plantR, upR);
    r.y += 0.14 * Math.sin(Math.PI * clamp((t - 0.28) / 0.2, 0, 1));
    r.lerp(finalR, stepR);
    r.y += 0.07 * Math.sin(Math.PI * clamp((t - 0.7) / 0.2, 0, 1));
    const upL = ease((t - 0.5) / 0.35);
    const l = dangleL.clone().lerp(finalL, upL);
    l.y += 0.22 * Math.sin(Math.PI * clamp((t - 0.5) / 0.35, 0, 1));
    this.legIK(
      p,
      RIGHT,
      r,
      lerp(-0.4, 0, smooth(0.3, 0.45, t)),
      0.1,
      new THREE.Vector3(0.1, 0, -1).applyQuaternion(at(p.q, HIPS)),
    );
    this.legIK(
      p,
      LEFT,
      l,
      lerp(-0.4, 0, smooth(0.6, 0.85, t)),
      -0.1,
      new THREE.Vector3(-0.1, 0, -1).applyQuaternion(at(p.q, HIPS)),
    );
  }

  private evalBlock(pose: NoraPose, p: Pose): void {
    const t = this.time;
    const push = pose.mode === 'push' ? 1 : 0;
    const pull = pose.mode === 'pull' ? 1 : 0;
    const breath = Math.sin((t * TAU) / 3.2);
    const effort = Math.sin(pose.modeTime * 9) * 0.01 * (push + pull);
    p.pos.set(0, HIPS_Y - 0.06 - 0.05 * push - 0.07 * pull + 0.004 * breath, 0.06 + 0.1 * push + 0.05 * pull);
    this.rot(p, HIPS, -0.12 - 0.2 * push + 0.2 * pull, 0, 0);
    this.rot(p, SPINE, -0.1 - 0.16 * push + 0.12 * pull + effort, 0, 0);
    this.rot(p, CHEST, -0.05 - 0.08 * push + 0.06 * pull + 0.015 * breath, 0, 0);
    this.rot(p, NECK, 0.08 + 0.12 * push - 0.05 * pull, 0, 0);
    this.rot(p, HEAD, 0.05 + 0.18 * push - 0.05 * pull, 0, 0);
    for (const sd of SIDES) {
      const s = sd.s;
      this.clav(p, sd, 0.03, 0.12 + 0.06 * push);
      const wrist = new THREE.Vector3(s * 0.19, 1.12 - 0.05 * push - 0.08 * pull, -0.345 - 0.03 * push);
      const fingers = new THREE.Vector3(s * 0.3, 1, 0);
      const palm = new THREE.Vector3(0, 0, -1);
      if (pull) {
        fingers.set(s * 0.2, 0.2, -1);
        palm.set(-s * 0.6, 0, -0.4);
      }
      this.armIK(p, sd, wrist, new THREE.Vector3(s * 0.8, -1, 0.35), fingers, palm);
      p.curl[s < 0 ? 0 : 1] = pull ? 0.9 : 0.12;
    }
    // Feet: braced split stance, stepping driven by climbT while moving the block.
    const moving = push + pull;
    const ph = pose.climbT * 2; // two full cycles for one 2 m block
    for (const sd of SIDES) {
      const s = sd.s;
      const brace = new THREE.Vector3(s * 0.12, 0.075, s > 0 ? -0.1 : 0.16);
      if (moving) {
        const g = new THREE.Vector3(s * 0.11, 0, 0);
        const dir = push ? 1 : -1;
        const pitch = this.gaitFoot(
          frac(ph + (s > 0 ? 0 : 0.5)),
          0.62,
          0.62 * dir,
          push ? 0.16 : -0.02,
          0.08,
          0,
          0.35,
          g,
        );
        const w = smooth(0, 0.08, pose.climbT) * (1 - smooth(0.92, 1, pose.climbT));
        brace.lerp(g, w);
        this.legIK(p, sd, brace, pitch * w, s * 0.08);
      } else {
        this.legIK(p, sd, brace, 0, s * 0.12);
      }
    }
  }

  private evalLever(pose: NoraPose, p: Pose): void {
    const t = pose.modeTime;
    const reach = smooth(0, 0.3, t);
    const pull = smooth(0.3, 0.75, t);
    const back = smooth(0.8, 1.05, t);
    p.pos.set(0, HIPS_Y - 0.08 * pull * (1 - back) + 0.02 * reach * (1 - pull), 0.02);
    this.rot(p, HIPS, -0.1 * pull * (1 - back), 0, 0);
    this.rot(p, SPINE, (0.06 * reach - 0.2 * pull) * (1 - back), 0, 0);
    this.rot(p, CHEST, (0.04 * reach - 0.15 * pull) * (1 - back), 0, 0);
    this.rot(p, HEAD, (0.35 * reach - 0.45 * pull) * (1 - back), 0, 0);
    for (const sd of SIDES) {
      const s = sd.s;
      const R = s > 0;
      const rest = new THREE.Vector3(s * 0.21, 0.86, 0.01);
      const top = new THREE.Vector3(R ? 0.07 : -0.03, 1.56, -0.42);
      const bottom = new THREE.Vector3(R ? 0.07 : -0.03, 1.02, -0.32);
      const wrist = rest.clone().lerp(top, reach).lerp(bottom, pull).lerp(rest, back);
      const hold = reach * (1 - back);
      const fingers = new THREE.Vector3(0, -1, 0).lerp(new THREE.Vector3(-s * 0.3, 0.2, -1), hold);
      const palm = new THREE.Vector3(-s, 0, 0).lerp(new THREE.Vector3(0, -1, 0.2), hold);
      this.clav(p, sd, 0.1 * reach * (1 - pull), 0.08 * hold);
      this.armIK(p, sd, wrist, new THREE.Vector3(s * 0.8, -0.6, 0.4), fingers, palm);
      p.curl[R ? 1 : 0] = lerp(0.38, 1.0, smooth(0.2, 0.32, t) * (1 - back));
      const foot = new THREE.Vector3(s * 0.11, 0.075, R ? -0.06 : 0.1);
      this.legIK(p, sd, foot, 0, s * 0.1);
    }
  }

  private evalPickup(pose: NoraPose, p: Pose): void {
    const t = pose.modeTime / 0.8;
    const c = smooth(0, 0.42, t) * (1 - smooth(0.55, 1, t));
    const reach = smooth(0.1, 0.42, t) * (1 - smooth(0.5, 0.85, t));
    p.pos.set(0.01 * c, HIPS_Y - 0.46 * c, 0.13 * c);
    this.rot(p, HIPS, -0.5 * c, 0, 0.04 * c);
    this.rot(p, SPINE, -0.32 * c, 0, 0);
    this.rot(p, CHEST, -0.2 * c, 0.12 * c, 0);
    this.rot(p, NECK, -0.1 * c, 0, 0);
    this.rot(p, HEAD, -0.2 * c, 0, 0);
    // Right hand to the floor, left forearm resting on the knee.
    const rest = new THREE.Vector3(0.21, 0.86, 0.01);
    const floor = new THREE.Vector3(0.12, 0.1, -0.3);
    this.armIK(
      p,
      RIGHT,
      rest.lerp(floor, reach),
      new THREE.Vector3(0.8, 0, 0.5),
      new THREE.Vector3(0, -1, 0).lerp(new THREE.Vector3(0, -1, -0.6), reach),
      new THREE.Vector3(-1, 0, 0).lerp(new THREE.Vector3(0, 0, 1), reach),
    );
    p.curl[1] = lerp(0.38, 0.9, smooth(0.35, 0.5, t));
    this.armFK(p, LEFT, 0.75 * c, 0.15, 0.2 + 0.9 * c, 0.1 * c);
    this.clav(p, LEFT, 0, 0.1 * c);
    this.legIK(p, RIGHT, new THREE.Vector3(0.11, 0.075, -0.08), 0, 0.1);
    this.legIK(p, LEFT, new THREE.Vector3(-0.12, 0.075 + 0.05 * c, 0.14), -0.5 * c, -0.1);
  }

  private evalDead(pose: NoraPose, p: Pose): void {
    const t = pose.modeTime;
    // Knees buckle (0..0.3 s), then the body topples forward onto the ground (0.3..0.6 s).
    const k = smooth(0, 0.3, t);
    const fall = clamp((t - 0.22) / 0.38, 0, 1);
    const f = fall * fall;
    const bounce = t > 0.6 ? 0.05 * Math.exp(-(t - 0.6) * 9) * Math.sin((t - 0.6) * 26) : 0;
    p.pos.set(
      0.02 * f,
      lerp(lerp(HIPS_Y, 0.56, k), 0.15, f) + bounce * 0.3,
      lerp(lerp(0, 0.06, k), -0.22, f),
    );
    this.rot(p, HIPS, lerp(-0.2 * k, -1.45, f) + bounce, 0.1 * f, 0.2 * f);
    this.rot(p, SPINE, -0.15 * k * (1 - f) - 0.05 * f, 0, 0.05 * f);
    this.rot(p, CHEST, -0.12 * k * (1 - f) + 0.05 * f, 0.1 * f, 0);
    this.rot(p, NECK, 0.1 * f, 0.5 * f, 0);
    this.rot(p, HEAD, 0.25 * f - 0.25 * k * (1 - f), 0.75 * f, 0.1 * f);
    this.armFK(p, RIGHT, lerp(lerp(0.1, 1.1, k), 2.5, f), lerp(0.12, 0.55, f), lerp(0.2, 1.0, f), 0.2 * f);
    this.armFK(p, LEFT, lerp(lerp(0.1, 0.9, k), 0.6, f), lerp(0.18, 0.45, f), lerp(0.2, 0.35, f));
    this.clav(p, RIGHT, 0.15 * f, 0);
    this.clav(p, LEFT, 0, 0);
    p.curl[0] = p.curl[1] = 0.5;
    // Feet stay on the floor: they slide back as the knees drop, then trail behind the body.
    for (const sd of SIDES) {
      const s = sd.s;
      const ankle = new THREE.Vector3(
        s * lerp(0.1, s > 0 ? 0.15 : 0.08, f),
        lerp(lerp(0.075, 0.1, k), 0.085, f),
        lerp(lerp(0, 0.3, k), s > 0 ? 0.5 : 0.56, f),
      );
      this.legIK(p, sd, ankle, lerp(-0.9 * k, -1.35, f), s * 0.2);
    }
  }
}

/** Three-way skin blend across a joint at height yJ: parent above, helper at the joint, child below. */
function zone(y: number, yJ: number, band: number, parent: number, helper: number, child: number): Weights {
  const t = (y - yJ) / band;
  if (t >= 1) return [[parent, 1]];
  if (t <= -1) return [[child, 1]];
  if (t >= 0) {
    const wp = smooth(0, 1, t);
    return [
      [parent, wp],
      [helper, 1 - wp],
    ];
  }
  const wc = smooth(0, 1, -t);
  return [
    [child, wc],
    [helper, 1 - wc],
  ];
}

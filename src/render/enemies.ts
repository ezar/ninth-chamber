/**
 * Enemy views (spec §7 and §11). Each jackal is drawn by a JackalView driven
 * by its simulation state; views only read the state.
 *
 * Two implementations:
 * - SkinnedJackal: a skinned glTF (public/models/jackal.glb) driven by named
 *   clips through an AnimationMixer, cross-faded from the sim state.
 * - ProceduralJackal: the fallback, a lean desert jackal built from shaped
 *   primitives on a small bone hierarchy, animated procedurally (idle, trot,
 *   gallop, bite, flinch, death). About 4k triangles.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ktx2 } from './ktx2';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TICK_DT } from '../core/loop';
import type { EnemyState } from '../sim/state';
import type { World } from '../sim/world';
import { ClayView, TAMRIT_BONES } from './clay';
import { DrivenSkeleton, loadSkinnedAsset, type SkinnedAsset } from './driven-skeleton';
import { AUTOMATON_BONES, AutomatonView } from './automaton';
import { ScorpionView } from './scorpion';
import { BirdView } from './bird';

export interface JackalView {
  readonly root: THREE.Object3D;
  /**
   * Poses the view for this frame. The root is already placed and turned;
   * `look` is the model-space point its attention is on (Nora), or null.
   */
  update(e: EnemyState, dt: number, look: THREE.Vector3 | null): void;
  /** A hit landed: a short flinch over the current animation. */
  flinch(): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const frac = (v: number): number => v - Math.floor(v);
const wrap = (a: number): number => a - TAU * Math.floor((a + Math.PI) / TAU);

// ─────────────────────────────── Procedural jackal ───────────────────────────────

/** Golden jackal coat: tan flanks, black-and-grey saddle, cream throat and belly, rufous legs and ears. */
const C = {
  tan: new THREE.Color('#946839'),
  saddle: new THREE.Color('#211a15'),
  grizzle: new THREE.Color('#5c544a'),
  cream: new THREE.Color('#cbb998'),
  rufous: new THREE.Color('#8a4c22'),
  muzzle: new THREE.Color('#5c432d'),
  black: new THREE.Color('#110e0c'),
  earInner: new THREE.Color('#d2c3a6'),
};

/** Paints a vertex from its bind position, normal and `v` (0..1 along its tube). */
type Paint = (p: THREE.Vector3, n: THREE.Vector3, v: number, out: THREE.Color) => void;

interface Ring {
  /** Centre (m) in the tube's space. */
  c: THREE.Vector3;
  /** Half-width along X and half-height across the path (m). */
  w: number;
  h: number;
}

const ring = (y: number, z: number, w: number, h: number, x = 0): Ring => ({
  c: new THREE.Vector3(x, y, z),
  w,
  h,
});

/**
 * A closed tube through elliptical rings centred on a path. Widths run along
 * X and heights along the path's normal (the path must not run along X).
 * The seam sits underneath; both ends close on their centres.
 */
function tube(rings: readonly Ring[], seg: number, paint: Paint): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const X = new THREE.Vector3(1, 0, 0);
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const lengths = [0];
  for (let k = 1; k < rings.length; k++)
    lengths.push((lengths[k - 1] ?? 0) + (rings[k] as Ring).c.distanceTo((rings[k - 1] as Ring).c));
  const total = Math.max(1e-6, lengths[lengths.length - 1] ?? 1);
  rings.forEach((r, k) => {
    const a = rings[Math.max(0, k - 1)] as Ring;
    const b = rings[Math.min(rings.length - 1, k + 1)] as Ring;
    T.subVectors(b.c, a.c).normalize();
    N.crossVectors(X, T).normalize();
    for (let i = 0; i < seg; i++) {
      const ang = -Math.PI / 2 + (i / seg) * TAU;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      pos.push(r.c.x + X.x * r.w * cs + N.x * r.h * sn, r.c.y + N.y * r.h * sn, r.c.z + N.z * r.h * sn);
      uv.push(i / seg, (lengths[k] ?? 0) / total);
    }
  });
  const n = rings.length * seg;
  const first = (rings[0] as Ring).c;
  const last = (rings[rings.length - 1] as Ring).c;
  pos.push(first.x, first.y, first.z, last.x, last.y, last.z);
  uv.push(0.5, 0, 0.5, 1);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i;
      const b = k * seg + ((i + 1) % seg);
      index.push(a, a + seg, b, b, a + seg, b + seg);
    }
  }
  const lastRing = (rings.length - 1) * seg;
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    index.push(n, i, j, n + 1, lastRing + j, lastRing + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  colorize(g, paint);
  return g;
}

function colorize(g: THREE.BufferGeometry, paint: Paint): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const uvs = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const col = new Float32Array(p.count * 3);
  const vp = new THREE.Vector3();
  const vn = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    vp.fromBufferAttribute(p, i);
    vn.fromBufferAttribute(n, i);
    paint(vp, vn, uvs ? uvs.getY(i) : 0, c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Skin weights from `v` along the tube: `weights(v)` gives up to two [bone, weight] pairs. */
function skin(g: THREE.BufferGeometry, weights: (v: number) => [number, number][]): void {
  const uvs = g.getAttribute('uv') as THREE.BufferAttribute;
  const idx = new Uint16Array(uvs.count * 4);
  const wt = new Float32Array(uvs.count * 4);
  for (let i = 0; i < uvs.count; i++) {
    weights(uvs.getY(i)).forEach(([b, w], k) => {
      idx[i * 4 + k] = b;
      wt[i * 4 + k] = w;
    });
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
}

/** Linear blend between bone a (below t0) and bone b (above t1). */
const blend = (v: number, t0: number, t1: number, a: number, b: number): [number, number][] => {
  const k = smooth(t0, t1, v);
  return k <= 0
    ? [[a, 1]]
    : k >= 1
      ? [[b, 1]]
      : [
          [a, 1 - k],
          [b, k],
        ];
};

/** Cheap deterministic grizzle: hash noise on position. */
function grain(p: THREE.Vector3, scale = 1): number {
  const s = Math.sin(p.x * 431.7 * scale + p.y * 917.3 * scale + p.z * 613.1 * scale) * 43758.5453;
  return s - Math.floor(s);
}

let sharedMaterials: {
  fur: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  nose: THREE.MeshStandardMaterial;
} | null = null;

function materials(): NonNullable<typeof sharedMaterials> {
  sharedMaterials ??= {
    fur: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    eye: new THREE.MeshStandardMaterial({ color: '#2e1c0e', roughness: 0.12 }),
    nose: new THREE.MeshStandardMaterial({ color: '#141010', roughness: 0.42 }),
  };
  return sharedMaterials;
}

/** Torso and neck: saddle on the back, tan flanks, cream underneath and down the throat. */
const paintBody: Paint = (p, n, _v, out) => {
  const g = grain(p);
  out.copy(C.tan).lerp(C.rufous, 0.15 * g);
  const onNeck = smooth(-0.27, -0.33, p.z);
  const saddle = smooth(-0.05, 0.55, n.y) * (1 - onNeck * 0.6) * smooth(0.36, 0.3, p.z);
  out.lerp(C.saddle, saddle * (0.75 + 0.25 * g));
  out.lerp(C.grizzle, saddle * 0.35 * grain(p, 2.3));
  out.lerp(C.cream, smooth(-0.1, -0.6, n.y) * 0.95);
  out.lerp(C.cream, onNeck * smooth(0.2, -0.6, n.z) * 0.9);
};

const paintLeg =
  (s: number, lower: boolean): Paint =>
  (_p, n, v, out) => {
    out.copy(C.rufous).lerp(C.tan, 0.25);
    out.lerp(C.cream, smooth(0.0, 0.8, -n.x * s) * 0.5);
    if (lower) out.lerp(C.tan, 0.3 + 0.3 * v).lerp(C.cream, 0.15);
  };

const paintHead: Paint = (p, n, _v, out) => {
  out.copy(C.rufous).lerp(C.tan, 0.35);
  out.lerp(C.muzzle, smooth(0.3, 0.8, n.y) * smooth(0.0, -0.05, p.z) * 0.8);
  out.lerp(C.grizzle, smooth(0.5, 0.9, n.y) * smooth(-0.02, 0.04, p.z) * 0.45);
  out.lerp(C.cream, smooth(-0.15, -0.55, n.y) * 0.95);
  out.lerp(C.cream, smooth(0.02, 0.0, p.z) * smooth(0.5, 0.9, Math.abs(n.x)) * smooth(0.0, -0.3, n.y) * 0.6);
  out.lerp(C.black, smooth(-0.145, -0.16, p.z) * 0.85);
};

const paintJaw: Paint = (p, _n, _v, out) => {
  out.copy(C.cream).lerp(C.black, smooth(-0.105, -0.125, p.z) * 0.7);
};

const paintEar: Paint = (p, n, _v, out) => {
  // Back of the ear rufous with a dark rim, the opening (facing forward) pale.
  out.copy(C.rufous).lerp(C.saddle, 0.25 + smooth(0.06, 0.1, p.y) * 0.5);
  out.lerp(C.earInner, smooth(0.15, -0.6, n.z) * (1 - smooth(0.07, 0.1, p.y)));
};

/** `v` runs from the root (0) to the tip (1). */
const paintTail: Paint = (p, n, v, out) => {
  out.copy(C.tan).lerp(C.grizzle, 0.35 * grain(p));
  out.lerp(C.saddle, smooth(0.0, 0.7, -n.z) * 0.45);
  out.lerp(C.cream, smooth(0.0, 0.7, n.z) * smooth(-0.1, -0.5, n.y) * 0.35);
  out.lerp(C.black, smooth(0.66, 0.76, v));
};

interface Leg {
  front: boolean;
  s: number;
  /** Bones from the body down: upper, lower, foot, paw. */
  j: THREE.Object3D[];
  /** Rest rotations (x) of each bone. */
  rest: number[];
}

function bone(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Bone {
  const b = new THREE.Bone();
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

function rigid(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

/** A limb segment along -Y: tapered, deeper than wide, with rounded ends that overlap the joints. */
function limb(len: number, r0: number, r1: number, depth: number, paint: Paint): THREE.BufferGeometry {
  const rings: Ring[] = [
    ring(r0 * 0.7, 0, r0 * 0.25, r0 * 0.25 * depth),
    ring(r0 * 0.45, 0, r0 * 0.8, r0 * 0.8 * depth),
  ];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const r = lerp(r0, r1, t) * (1 + 0.1 * Math.sin(Math.PI * t));
    rings.push(ring(-len * t, 0, r, r * depth));
  }
  rings.push(
    ring(-len - r1 * 0.45, 0, r1 * 0.8, r1 * 0.8 * depth),
    ring(-len - r1 * 0.7, 0, r1 * 0.25, r1 * 0.25),
  );
  return tube(rings, 8, paint);
}

/** Rest-pose bone positions in body space (model faces -Z, feet at y = 0 before the ground fit). */
const REST = {
  pelvis: new THREE.Vector3(0, 0.45, 0.18),
  chest: new THREE.Vector3(0, 0.46, -0.16),
  neck: new THREE.Vector3(0, 0.51, -0.285),
  head: new THREE.Vector3(0, 0.625, -0.37),
};

/** Tail path, root to tip, hanging in its rest pose (y, z). */
const TAIL: readonly [number, number, number][] = [
  [0.475, 0.315, 0.012],
  [0.468, 0.33, 0.024],
  [0.43, 0.365, 0.036],
  [0.385, 0.395, 0.046],
  [0.335, 0.42, 0.05],
  [0.285, 0.44, 0.047],
  [0.245, 0.452, 0.036],
  [0.215, 0.46, 0.018],
  [0.2, 0.463, 0.004],
];

export class ProceduralJackal implements JackalView {
  readonly root = new THREE.Group();
  /** Whole-body pose: lifted to stand on its paws, rolled over when dead. */
  private readonly body = new THREE.Group();
  private readonly pelvis: THREE.Bone;
  private readonly chest: THREE.Bone;
  private readonly neck: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly jaw: THREE.Object3D;
  private readonly ears: THREE.Object3D[] = [];
  private readonly tail: THREE.Bone[] = [];
  private readonly legs: Leg[] = [];
  private readonly ground: number;
  private readonly seed: number;

  private phase = 0;
  private speed = 0;
  private gallop = 0;
  private time = 0;
  private flinchT = 0;
  private flinchSide = 1;
  private lookYaw = 0;
  private lookPitch = 0;
  private strike = 0;
  private lastBiteIn = 0;
  private sinceBite = 9;
  private deadT = 0;

  constructor(seed = 0) {
    this.seed = seed;
    const m = materials();
    this.root.add(this.body);
    this.pelvis = bone(this.body, REST.pelvis.x, REST.pelvis.y, REST.pelvis.z);
    const rel = (a: THREE.Vector3, b: THREE.Vector3): [number, number, number] => [
      b.x - a.x,
      b.y - a.y,
      b.z - a.z,
    ];
    this.chest = bone(this.pelvis, ...rel(REST.pelvis, REST.chest));
    this.neck = bone(this.chest, ...rel(REST.chest, REST.neck));
    this.head = bone(this.neck, ...rel(REST.neck, REST.head));
    this.jaw = new THREE.Object3D();
    this.jaw.position.set(0, -0.026, -0.005);
    this.head.add(this.jaw);

    // Tail bones along its path.
    const tp = (i: number): THREE.Vector3 => {
      const [y, z] = TAIL[i] as [number, number, number];
      return new THREE.Vector3(0, y, z);
    };
    let prevPos = REST.pelvis;
    let parent: THREE.Object3D = this.pelvis;
    for (const i of [0, 3, 5]) {
      const b = bone(parent, ...rel(prevPos, tp(i)));
      this.tail.push(b);
      parent = b;
      prevPos = tp(i);
    }

    // Torso and neck: one skinned tube from the rump to the back of the head.
    const bodyRings = [
      ring(0.47, 0.34, 0.012, 0.012),
      ring(0.468, 0.327, 0.044, 0.048),
      ring(0.461, 0.3, 0.072, 0.08),
      ring(0.454, 0.25, 0.086, 0.1),
      ring(0.45, 0.18, 0.088, 0.104),
      ring(0.456, 0.1, 0.077, 0.09),
      ring(0.462, 0.03, 0.07, 0.083),
      ring(0.452, -0.04, 0.078, 0.104),
      ring(0.44, -0.11, 0.086, 0.128),
      ring(0.44, -0.18, 0.088, 0.132),
      ring(0.458, -0.24, 0.08, 0.114),
      ring(0.5, -0.29, 0.066, 0.086),
      ring(0.55, -0.325, 0.056, 0.07),
      ring(0.595, -0.35, 0.05, 0.06),
      ring(0.63, -0.37, 0.045, 0.052),
      ring(0.65, -0.38, 0.02, 0.024),
    ];
    const bodyGeo = tube(bodyRings, 22, paintBody);
    // Bones: 0 pelvis, 1 chest, 2 neck. The waist bends between rings 5 and 7, the neck above ring 10.
    const len = (k: number): number => (bodyGeo.getAttribute('uv') as THREE.BufferAttribute).getY(k * 22);
    const waist0 = len(5);
    const waist1 = len(7);
    const neck0 = len(10);
    const neck1 = len(12);
    skin(bodyGeo, (v) => (v < neck0 ? blend(v, waist0, waist1, 0, 1) : blend(v, neck0, neck1, 1, 2)));
    const tailGeo = tube(
      TAIL.map(([y, z, r]) => ring(y, z, r, r * 1.05)),
      12,
      paintTail,
    );
    skin(tailGeo, (v) => (v < 0.5 ? blend(v, 0.28, 0.42, 0, 1) : blend(v, 0.6, 0.72, 1, 2)));

    // Head: skull to a long narrow muzzle, in head-bone space.
    rigid(
      tube(
        [
          ring(0.004, 0.074, 0.014, 0.014),
          ring(0.006, 0.06, 0.04, 0.038),
          ring(0.007, 0.03, 0.056, 0.051),
          ring(0.002, -0.01, 0.056, 0.049),
          ring(-0.006, -0.045, 0.04, 0.035),
          ring(-0.014, -0.08, 0.028, 0.026),
          ring(-0.02, -0.12, 0.02, 0.019),
          ring(-0.022, -0.148, 0.014, 0.014),
          ring(-0.022, -0.16, 0.005, 0.005),
        ],
        16,
        paintHead,
      ),
      m.fur,
      this.head,
    );
    rigid(
      tube(
        [
          ring(0, 0.01, 0.01, 0.006),
          ring(0, -0.01, 0.028, 0.011),
          ring(-0.004, -0.06, 0.022, 0.01),
          ring(-0.006, -0.1, 0.015, 0.008),
          ring(-0.006, -0.122, 0.005, 0.004),
        ],
        10,
        paintJaw,
      ),
      m.fur,
      this.jaw,
    );
    const nose = rigid(new THREE.SphereGeometry(0.013, 8, 6), m.nose, this.head);
    nose.position.set(0, -0.017, -0.158);
    nose.scale.set(1.15, 0.8, 0.95);
    for (const s of [-1, 1]) {
      const eye = rigid(new THREE.SphereGeometry(0.0085, 8, 6), m.eye, this.head);
      eye.position.set(s * 0.032, 0.012, -0.045);
      eye.scale.set(0.8, 0.75, 1);
      // Big pointed ears, set high and wide.
      const ear = new THREE.Object3D();
      ear.position.set(s * 0.03, 0.036, 0.014);
      this.head.add(ear);
      const earGeo = new THREE.ConeGeometry(0.038, 0.11, 7, 3, true);
      earGeo.translate(0, 0.0525, 0);
      earGeo.scale(1, 1, 0.42);
      colorize(earGeo, paintEar);
      const earMesh = rigid(earGeo, m.fur, ear);
      earMesh.material = m.fur;
      this.ears.push(ear);
    }

    // Legs: forelegs from the chest, hind legs from the hips.
    for (const s of [-1, 1]) this.legs.push(this.buildLeg(true, s), this.buildLeg(false, s));
    for (const leg of this.legs) leg.j.forEach((b, i) => b.rotation.set(leg.rest[i] ?? 0, 0, 0));

    // Bind the skinned parts in the rest pose.
    this.root.updateMatrixWorld(true);
    const skinned = (geo: THREE.BufferGeometry, bones: THREE.Bone[]): void => {
      const sm = new THREE.SkinnedMesh(geo, m.fur);
      sm.castShadow = true;
      sm.receiveShadow = true;
      sm.frustumCulled = false;
      this.body.add(sm);
      sm.updateMatrixWorld(true);
      sm.bind(new THREE.Skeleton(bones));
    };
    skinned(bodyGeo, [this.pelvis, this.chest, this.neck]);
    skinned(tailGeo, this.tail);

    // Stand on the paws.
    let low = Infinity;
    const v = new THREE.Vector3();
    for (const leg of this.legs)
      low = Math.min(low, (leg.j[3] as THREE.Object3D).getWorldPosition(v).y - 0.013);
    this.ground = -low;
    this.body.position.y = this.ground;
  }

  private buildLeg(front: boolean, s: number): Leg {
    const m = materials();
    const base = front
      ? bone(this.chest, s * 0.05, -0.075, -0.005)
      : bone(this.pelvis, s * 0.05, -0.02, 0.02);
    const lens = front ? [0.12, 0.17, 0.055] : [0.15, 0.18, 0.1];
    const radii: [number, number, number][] = front
      ? [
          [0.036, 0.024, 1.3],
          [0.02, 0.014, 1.2],
          [0.013, 0.012, 1.1],
        ]
      : [
          [0.046, 0.028, 1.5],
          [0.026, 0.014, 1.3],
          [0.014, 0.012, 1.2],
        ];
    const rest = front ? [-0.3, 0.3, 0.25, -0.25] : [0.5, -1.05, 0.62, -0.07];
    const j: THREE.Object3D[] = [];
    let at: THREE.Object3D = base;
    for (let i = 0; i < 3; i++) {
      const b = i === 0 ? base : bone(at, 0, -(lens[i - 1] ?? 0), 0);
      const [r0, r1, depth] = radii[i] as [number, number, number];
      rigid(limb(lens[i] ?? 0.1, r0, r1, depth, paintLeg(s, i > 0)), m.fur, b);
      j.push(b);
      at = b;
    }
    // Paw: a compact pad with the toes forward.
    const paw = bone(at, 0, -(lens[2] ?? 0), 0);
    const pawGeo = new THREE.SphereGeometry(0.02, 8, 6);
    pawGeo.scale(0.95, 0.6, 1.5);
    pawGeo.translate(0, -0.004, -0.014);
    colorize(pawGeo, (_p, n, _v, out) =>
      out
        .copy(C.tan)
        .lerp(C.saddle, 0.3)
        .lerp(C.black, smooth(-0.3, -0.9, n.y)),
    );
    rigid(pawGeo, m.fur, paw);
    j.push(paw);
    return { front, s, j, rest };
  }

  flinch(): void {
    this.flinchT = 1;
    this.flinchSide = Math.random() < 0.5 ? -1 : 1;
  }

  update(e: EnemyState, dt: number, look: THREE.Vector3 | null): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const t = this.time + this.seed * 3.7;
    this.speed += (Math.hypot(e.vel.x, e.vel.z) - this.speed) * (1 - Math.exp(-dt * 10));
    const v = this.speed;
    this.deadT = e.mode === 'dead' ? this.deadT + dt : 0;

    // Gait: a trot below ~2.5 m/s, a rotary gallop above.
    this.gallop += (smooth(2.3, 3.4, v) - this.gallop) * (1 - Math.exp(-dt * 6));
    const g = this.gallop;
    const stride = lerp(0.85, 1.55, g);
    this.phase = frac(this.phase + (v / stride) * dt);
    const move = smooth(0.08, 0.6, v);
    const amp = lerp(0.34, 0.62, g) * move;

    this.flinchT = Math.max(0, this.flinchT - dt / 0.28);
    const fl = this.flinchT > 0 ? Math.sin(Math.PI * this.flinchT) : 0;

    // Bite timing: the strike winds up as the next bite nears and snaps with it.
    const attacking = e.mode === 'attack';
    if (attacking && e.biteIn > this.lastBiteIn + 0.2) this.sinceBite = 0;
    this.lastBiteIn = e.biteIn;
    this.sinceBite += dt;
    const windup = attacking ? smooth(0.3, 0.06, e.biteIn) : 0;
    const snap = this.sinceBite < 0.5 ? Math.exp(-this.sinceBite * 9) : 0;
    this.strike += ((attacking ? Math.max(windup * 0.4, snap) : 0) - this.strike) * (1 - Math.exp(-dt * 30));
    const jawOpen = attacking ? clamp(windup * 1.3 - snap * 0.9, 0, 1) : e.mode === 'alert' ? 0.2 : 0;

    // Attention: the head turns towards Nora while aware.
    const aware = e.mode === 'alert' || e.mode === 'chase' || e.mode === 'attack' || e.mode === 'hurt';
    let wantYaw = 0;
    let wantPitch = 0;
    if (look && aware) {
      wantYaw = clamp(Math.atan2(-look.x, -look.z), -0.9, 0.9);
      wantPitch = clamp(Math.atan2(look.y - 0.65, Math.hypot(look.x, look.z)), -0.5, 0.6);
    }
    const sniff =
      e.mode === 'idle' ? smooth(0.55, 0.9, Math.sin(t * 0.37) * 0.5 + Math.sin(t * 0.23 + 1) * 0.5) : 0;
    const k = 1 - Math.exp(-dt * 8);
    this.lookYaw += (wantYaw - this.lookYaw) * k;
    this.lookPitch += (wantPitch - this.lookPitch) * k;

    // Rotation signs: +X pitches a bone's -Z end up and swings its -Y end forward.
    const breath = Math.sin(t * 2.6) * 0.004;
    const bob = move * lerp(0.012, 0.03, g) * Math.cos(TAU * this.phase * (g > 0.5 ? 1 : 2));
    const crouch = e.mode === 'alert' ? 0.03 : attacking ? 0.02 + 0.03 * windup : 0;
    this.pelvis.position.set(0, REST.pelvis.y + bob - crouch + breath, REST.pelvis.z - 0.07 * this.strike);
    const rock = g * move * 0.07 * Math.sin(TAU * this.phase);
    this.pelvis.rotation.set(rock, 0, fl * 0.12 * this.flinchSide);
    this.chest.rotation.set(-rock * 1.3 - crouch - 0.06 * this.strike, this.lookYaw * 0.15, 0);
    // Neck and head: carried forward when running, low when threatening or sniffing.
    const low = attacking ? 0.3 : e.mode === 'alert' ? 0.2 : 0;
    this.neck.rotation.set(
      -0.2 * move - low - 0.75 * sniff - 0.35 * this.strike + rock * 0.8 + fl * 0.3,
      this.lookYaw * 0.45,
      0,
    );
    this.head.rotation.set(
      this.lookPitch * 0.6 + 0.2 * move + low * 0.7 + 0.25 * sniff + 0.2 * this.strike + fl * 0.2,
      this.lookYaw * 0.4,
      0,
    );
    this.jaw.rotation.x = -(jawOpen * 0.6 + 0.05 * sniff * Math.max(0, Math.sin(t * 9)));

    // Ears: pricked when alert, pinned back when attacking or hurt, twitching at rest.
    const back = attacking ? 0.9 : e.mode === 'hurt' || e.mode === 'flee' ? 0.6 : 0;
    const perk = e.mode === 'alert' || e.mode === 'chase' ? 1 : 0;
    this.ears.forEach((ear, i) => {
      const s = i === 0 ? -1 : 1;
      const twitch = e.mode === 'idle' ? smooth(0.93, 1, Math.sin(t * 1.3 + i * 2.1)) * 0.5 : 0;
      ear.rotation.set(
        0.12 + back * 0.9 - perk * 0.2 + twitch * 0.4 + fl * 0.5,
        s * (0.2 - back * 0.25),
        -s * (0.2 + back * 0.3),
      );
    });

    // Tail: hanging at rest, streaming when running, tucked when leaving or hurt.
    const tuck = e.mode === 'flee' || e.mode === 'hurt' ? 1 : 0;
    const sway = Math.sin(t * (e.mode === 'idle' ? 1.1 : 4)) * lerp(0.12, 0.05, move);
    const lift = move * (1 - tuck);
    const raise = [0.55, 0.25, 0.1];
    const tucks = [0.3, 0.2, 0.1];
    this.tail.forEach((b, i) => {
      const wave = move * 0.1 * Math.sin(TAU * this.phase * 2 - i * 0.9);
      b.rotation.set(-lift * (raise[i] ?? 0) + tuck * (tucks[i] ?? 0) + wave, sway * (i + 1) * 0.5, 0);
    });

    for (const leg of this.legs) this.animateLeg(leg, g, amp, move);

    // Death: the legs buckle, then it rolls onto its flank.
    const buckle = smooth(0, 0.25, this.deadT);
    const d = smooth(0.12, 0.6, this.deadT);
    const side = this.seed % 2 === 0 ? 1 : -1;
    this.body.rotation.z = d * 1.42 * side;
    this.body.position.set(
      side * d * REST.pelvis.y * 0.97,
      lerp(this.ground, 0.03, d) - buckle * (1 - d) * 0.12,
      0,
    );
    if (buckle > 0) {
      this.neck.rotation.x = lerp(this.neck.rotation.x, 0.1, d);
      this.head.rotation.x = lerp(this.head.rotation.x, 0.1, d);
      this.jaw.rotation.x = lerp(this.jaw.rotation.x, -0.12, d);
      for (const b of this.tail) b.rotation.x = lerp(b.rotation.x, -0.9 / 3, d);
      for (const leg of this.legs) {
        leg.j.forEach((b, i) => {
          const limp = (leg.rest[i] ?? 0) * 0.6 + (i === 0 ? (leg.front ? 0.35 : -0.2) : 0);
          b.rotation.x = lerp(b.rotation.x, limp, buckle);
        });
      }
    }
  }

  private animateLeg(leg: Leg, g: number, amp: number, move: number): void {
    // Phase offsets: trot in diagonal pairs; rotary gallop LH, RH, RF, LF.
    const trot = leg.front ? (leg.s < 0 ? 0 : 0.5) : leg.s < 0 ? 0.5 : 0;
    const gal = leg.front ? (leg.s > 0 ? 0.45 : 0.57) : leg.s < 0 ? 0 : 0.12;
    const ph = frac(this.phase + lerp(trot, gal, g));
    const duty = lerp(0.52, 0.36, g);
    let swing: number;
    let lift: number;
    if (ph < duty) {
      swing = lerp(1, -1, ph / duty);
      lift = 0;
    } else {
      const u = (ph - duty) / (1 - duty);
      swing = lerp(-1, 1, u * u * (3 - 2 * u));
      lift = Math.sin(Math.PI * u);
    }
    const [upper, lower, foot, paw] = leg.j as [
      THREE.Object3D,
      THREE.Object3D,
      THREE.Object3D,
      THREE.Object3D,
    ];
    const [r0, r1, r2, r3] = leg.rest as [number, number, number, number];
    const a = swing * amp;
    const l = lift * move;
    if (leg.front) {
      upper.rotation.set(r0 + a * 0.9, 0, 0);
      lower.rotation.set(r1 - l * 0.55 + a * 0.2, 0, 0);
      foot.rotation.set(r2 - l * 1.5, 0, 0);
      paw.rotation.set(r3 + l * 0.6 - a * 0.4, 0, 0);
    } else {
      upper.rotation.set(r0 + a, 0, 0);
      lower.rotation.set(r1 - l * 0.6 - a * 0.25, 0, 0);
      foot.rotation.set(r2 + l * 0.7 + a * 0.2, 0, 0);
      paw.rotation.set(r3 - a * 0.3 + l * 0.3, 0, 0);
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

// ─────────────────────────────── Skinned glTF jackal ───────────────────────────────

/** Sim state → clip name (Quaternius quadruped naming). */
const CLIPS = {
  idle: 'Idle',
  sniff: 'Idle_2_HeadLow',
  walk: 'Walk',
  run: 'Gallop',
  attack: 'Attack',
  hurt: 'Idle_HitReact1',
  death: 'Death',
} as const;

/** Ground speed (m/s) at which the walk and gallop clips play at their natural rate. */
const CLIP_SPEED = { walk: 1.4, run: 4.1 };

export interface JackalAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Scale and yaw that fit the model to the game's jackal (faces -Z, ~1.1 m long). */
  scale: number;
  yaw: number;
}

export class SkinnedJackal implements JackalView {
  readonly root = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = '';
  private lastBiteIn = 0;
  private lastMode = '';
  private flinchAction: THREE.AnimationAction | null = null;

  constructor(asset: JackalAsset) {
    this.model = SkeletonUtils.clone(asset.scene);
    this.model.scale.setScalar(asset.scale);
    this.model.rotation.y = asset.yaw;
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of asset.clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    const hit = this.actions.get(CLIPS.hurt);
    if (hit) {
      hit.setLoop(THREE.LoopOnce, 1);
      hit.clampWhenFinished = false;
    }
    const death = this.actions.get(CLIPS.death);
    if (death) {
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true;
    }
    this.flinchAction = hit ?? null;
    this.play(CLIPS.idle, 0);
  }

  private play(name: string, fade: number, restart = false): THREE.AnimationAction | null {
    const next = this.actions.get(name) ?? this.actions.get(CLIPS.idle) ?? null;
    if (!next) return null;
    if (next === this.current && !restart) return next;
    next.enabled = true;
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.currentName = name;
    return next;
  }

  flinch(): void {
    // A hit reaction layered over locomotion would need an additive clip; restart it only when idle-ish.
    if (this.currentName === CLIPS.idle && this.flinchAction) this.play(CLIPS.hurt, 0.08, true);
  }

  update(e: EnemyState, dt: number): void {
    const speed = Math.hypot(e.vel.x, e.vel.z);
    let name: string = CLIPS.idle;
    let rate = 1;
    switch (e.mode) {
      case 'dead':
        name = CLIPS.death;
        break;
      case 'hurt':
        name = CLIPS.hurt;
        break;
      case 'attack':
        name = CLIPS.attack;
        break;
      case 'idle':
      case 'alert':
        name = speed > 0.3 ? CLIPS.walk : CLIPS.idle;
        rate = speed > 0.3 ? Math.max(0.5, speed / CLIP_SPEED.walk) : 1;
        break;
      case 'chase':
      case 'flee':
        if (speed > 2.4) {
          name = CLIPS.run;
          rate = clamp(speed / CLIP_SPEED.run, 0.6, 1.4);
        } else if (speed > 0.2) {
          name = CLIPS.walk;
          rate = clamp(speed / CLIP_SPEED.walk, 0.5, 1.6);
        }
        break;
    }
    // Each bite restarts the attack clip.
    const newBite = e.mode === 'attack' && e.biteIn > this.lastBiteIn + 0.2;
    this.lastBiteIn = e.biteIn;
    const fade = e.mode === 'dead' ? 0.15 : 0.22;
    const action = this.play(name, fade, newBite || (e.mode !== this.lastMode && name === CLIPS.hurt));
    if (action && name !== CLIPS.death && name !== CLIPS.hurt) action.timeScale = rate;
    this.lastMode = e.mode;
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}

/** Loads models/jackal.glb and fits it to the game's jackal; null when missing or unusable. */
export async function loadJackalAsset(url: string): Promise<JackalAsset | null> {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const k = ktx2();
    if (k) loader.setKTX2Loader(k);
    const gltf: GLTF = await loader.loadAsync(url);
    const names = new Set(gltf.animations.map((a) => a.name));
    if (!names.has(CLIPS.idle) || !names.has(CLIPS.run))
      throw new Error('jackal.glb lacks the Idle and Gallop clips');
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    // Longest horizontal extent is nose to tail tip: fit it to ~1.15 m. Models face +Z in glTF.
    const length = Math.max(size.x, size.z);
    return { scene: gltf.scene, clips: gltf.animations, scale: 1.15 / Math.max(1e-6, length), yaw: Math.PI };
  } catch (err) {
    console.info('No skinned jackal (models/jackal.glb); using the procedural one.', err);
    return null;
  }
}

// ─────────────────────────────── Views per enemy ───────────────────────────────

interface Slot {
  view: JackalView;
  /** Displayed position and yaw, smoothed between ticks. */
  pos: THREE.Vector3;
  yaw: number;
  /** A skinned model (jackal or Tamrit), or a view no model replaces. */
  skinned: boolean;
  /** Body centre above the feet, for markers (m). */
  height: number;
}

const _look = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/** Enemy types whose stand-in a Meshy model can replace, and the bones each view drives. */
const MODELLED = ['clay', 'automaton'] as const;
export type ModelledType = (typeof MODELLED)[number];
const MODEL_BONES: Record<ModelledType, readonly string[]> = {
  clay: TAMRIT_BONES,
  automaton: AUTOMATON_BONES,
};
const isModelled = (t: string): t is ModelledType => (MODELLED as readonly string[]).includes(t);

/** One view per enemy in the world, created on demand and removed when the enemy is gone. */
export class EnemyViews {
  readonly group = new THREE.Group();
  private readonly slots = new Map<string, Slot>();
  private asset: JackalAsset | null = null;
  /** The guardians' Meshy models (Tamrit, the automatons), once loaded with every bone their views drive. */
  private readonly models: Partial<Record<ModelledType, SkinnedAsset>> = {};

  constructor(
    private readonly url: string | null,
    private readonly modelUrls: Partial<Record<ModelledType, string>> = {},
  ) {}

  /**
   * Starts loading the skinned models (call once KTX2 is set up, after the renderer has
   * started). Enemies show their stand-ins until a model arrives, then swap to it.
   */
  load(): void {
    const { url } = this;
    if (url)
      void loadJackalAsset(url).then((a) => {
        this.asset = a;
      });
    for (const type of MODELLED) {
      const at = this.modelUrls[type];
      if (!at) continue;
      void loadSkinnedAsset(at).then((a) => {
        if (!a) return;
        const missing = DrivenSkeleton.missing(a.scene, MODEL_BONES[type]);
        if (missing.length) console.info(`${at} lacks the bones ${missing.join(', ')}; using the stand-in.`);
        else this.models[type] = a;
      });
    }
  }

  /** Displayed position of an enemy's body centre (for markers and effects). */
  center(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const s = this.slots.get(id);
    if (!s) return null;
    return out.copy(s.pos).setY(s.pos.y + s.height);
  }

  flinch(id: string): void {
    this.slots.get(id)?.view.flinch();
  }

  /** Shows only the jackals `shown` accepts (those in rooms being drawn). */
  cull(shown: (x: number, z: number) => boolean): void {
    for (const s of this.slots.values()) s.view.root.visible = shown(s.pos.x, s.pos.z);
  }

  private readonly seen = new Set<string>();

  update(world: World, alpha: number, dt: number): void {
    const seen = this.seen;
    seen.clear();
    const p = world.state.player.pos;
    world.state.enemies.forEach((e, i) => {
      seen.add(e.id);
      let slot = this.slots.get(e.id);
      const modelled = e.type === 'jackal' ? !!this.asset : isModelled(e.type) && !!this.models[e.type];
      if (slot && modelled && !slot.skinned) {
        // The skinned model arrived: swap the procedural view out.
        this.group.remove(slot.view.root);
        slot.view.dispose();
        slot = undefined;
      }
      if (!slot) {
        const view: JackalView =
          e.type === 'clay'
            ? new ClayView(this.models.clay)
            : e.type === 'automaton'
              ? new AutomatonView(this.models.automaton)
              : e.type === 'bird'
                ? new BirdView()
                : e.type === 'scorpion'
                  ? new ScorpionView()
                  : this.asset
                    ? new SkinnedJackal(this.asset)
                    : new ProceduralJackal(i);
        slot = {
          view,
          pos: new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z),
          yaw: e.yaw,
          skinned: e.type === 'jackal' ? !!this.asset : isModelled(e.type) ? !!this.models[e.type] : true,
          height:
            e.type === 'clay'
              ? 1.3
              : e.type === 'automaton'
                ? 1.2
                : e.type === 'bird'
                  ? 0.25
                  : e.type === 'scorpion'
                    ? 0.15
                    : 0.42,
        };
        this.group.add(view.root);
        this.slots.set(e.id, slot);
      }
      // Render interpolation: back along the velocity for the part of the tick not yet shown.
      const back = TICK_DT * (1 - alpha);
      const tx = e.mode === 'dead' ? e.pos.x : e.pos.x - e.vel.x * back;
      const tz = e.mode === 'dead' ? e.pos.z : e.pos.z - e.vel.z * back;
      if (Math.hypot(tx - slot.pos.x, tz - slot.pos.z) > 2) slot.pos.set(tx, e.pos.y, tz);
      slot.pos.x = tx;
      slot.pos.z = tz;
      slot.pos.y += (e.pos.y - slot.pos.y) * (1 - Math.exp(-dt * 18));
      slot.yaw += wrap(e.yaw - slot.yaw) * (1 - Math.exp(-dt * 16));
      const root = slot.view.root;
      root.position.copy(slot.pos);
      root.rotation.y = slot.yaw;
      root.updateMatrixWorld(true);
      const look = _look.set(p.x, p.y + 1.2, p.z).applyMatrix4(_inv.copy(root.matrixWorld).invert());
      slot.view.update(e, dt, look);
    });
    for (const [id, slot] of this.slots) {
      if (seen.has(id)) continue;
      this.group.remove(slot.view.root);
      slot.view.dispose();
      this.slots.delete(id);
    }
  }
}

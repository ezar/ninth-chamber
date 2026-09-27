/**
 * The stone guardian's body (spec §7, §11): a hulking carved figure built
 * from primitives — heavy legs, a broad chest carved with a sun, long arms
 * ending in fists that reach the floor, a small head sunk between the
 * shoulders with amber eyes, and the amber core set in its upper back where
 * a blow from above can break it. Every motion is procedural and follows
 * the simulation's mode: the heavy walk, the wind-up with arms raised and
 * the core flaring, the slam and its shockwave, the hunched recovery with
 * the core bared (the hit window), the reel after a blow, the fall, the
 * climb out of the pit and the collapse. The wind-up is telegraphed by a
 * glowing ring on the floor where the fists will land; slams, falls and
 * the collapse throw up dust, and when it falls apart its pieces tumble
 * away from the body. It only reads the simulation, and its per-frame
 * update allocates nothing (scratch poses, fixed particle pools).
 */
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { GuardianState } from '../sim/actors/guardian-types';
import { guardianTuning as G } from '../sim/player/tuning';
import type { World } from '../sim/world';
import { mergeStatic } from './merge';
import { PuffPool } from './puffs';
import { surfaceParams, type SurfaceSet } from './materials';

/** Dust puffs per guardian (slams, falls, the collapse). */
const DUST = 48;

interface Joints {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  shoulders: [THREE.Group, THREE.Group];
  elbows: [THREE.Group, THREE.Group];
  thighs: [THREE.Group, THREE.Group];
  knees: [THREE.Group, THREE.Group];
}

/** Joint angles of one pose (radians; x pitches forward, z rolls outwards). */
interface Pose {
  y: number;
  pitch: number;
  roll: number;
  torsoPitch: number;
  torsoYaw: number;
  headPitch: number;
  shoulder: [number, number];
  shoulderOut: [number, number];
  elbow: [number, number];
  thigh: [number, number];
  knee: [number, number];
}

const REST: Pose = {
  y: 0,
  pitch: 0,
  roll: 0,
  torsoPitch: 0.12,
  torsoYaw: 0,
  headPitch: 0.1,
  shoulder: [0.15, 0.15],
  shoulderOut: [0.12, 0.12],
  elbow: [-0.35, -0.35],
  thigh: [0, 0],
  knee: [0, 0],
};

const clonePose = (p: Pose): Pose => ({
  ...p,
  shoulder: [...p.shoulder],
  shoulderOut: [...p.shoulderOut],
  elbow: [...p.elbow],
  thigh: [...p.thigh],
  knee: [...p.knee],
});

function blendPose(out: Pose, to: Pose, k: number): void {
  const n = (a: number, b: number): number => a + (b - a) * k;
  out.y = n(out.y, to.y);
  out.pitch = n(out.pitch, to.pitch);
  out.roll = n(out.roll, to.roll);
  out.torsoPitch = n(out.torsoPitch, to.torsoPitch);
  out.torsoYaw = n(out.torsoYaw, to.torsoYaw);
  out.headPitch = n(out.headPitch, to.headPitch);
  for (let i = 0; i < 2; i++) {
    out.shoulder[i] = n(out.shoulder[i] ?? 0, to.shoulder[i] ?? 0);
    out.shoulderOut[i] = n(out.shoulderOut[i] ?? 0, to.shoulderOut[i] ?? 0);
    out.elbow[i] = n(out.elbow[i] ?? 0, to.elbow[i] ?? 0);
    out.thigh[i] = n(out.thigh[i] ?? 0, to.thigh[i] ?? 0);
    out.knee[i] = n(out.knee[i] ?? 0, to.knee[i] ?? 0);
  }
}

/** Resets `out` to `from` in place (no allocation). */
function copyPose(out: Pose, from: Pose): void {
  out.y = from.y;
  out.pitch = from.pitch;
  out.roll = from.roll;
  out.torsoPitch = from.torsoPitch;
  out.torsoYaw = from.torsoYaw;
  out.headPitch = from.headPitch;
  for (let i = 0; i < 2; i++) {
    out.shoulder[i] = from.shoulder[i] ?? 0;
    out.shoulderOut[i] = from.shoulderOut[i] ?? 0;
    out.elbow[i] = from.elbow[i] ?? 0;
    out.thigh[i] = from.thigh[i] ?? 0;
    out.knee[i] = from.knee[i] ?? 0;
  }
}

const set2 = (a: [number, number], x: number, y: number): void => {
  a[0] = x;
  a[1] = y;
};

interface Body {
  id: string;
  joints: Joints;
  pose: Pose;
  /** Scratch target pose, reused every frame. */
  target: Pose;
  walk: number;
  last: THREE.Vector3;
  core: THREE.MeshStandardMaterial;
  eyes: THREE.MeshStandardMaterial;
  cracks: THREE.MeshStandardMaterial;
  coreLight: THREE.PointLight;
  coreGlow: THREE.Sprite;
  wave: THREE.Mesh;
  waveAge: number;
  lastMode: string;
  rubble: THREE.Group;
  /** Where each rubble piece comes to rest (x, y, z) and its tumble. */
  rubbleRest: Float32Array;
  rubbleAge: number;
  /** The wind-up's telegraph on the floor. */
  tell: THREE.Mesh;
  tellMat: THREE.MeshBasicMaterial;
  dust: PuffPool;
}

export class GuardianView {
  readonly group = new THREE.Group();
  private readonly bodies: Body[] = [];
  private readonly glowTex: THREE.Texture;

  constructor(
    world: World,
    private readonly stone: SurfaceSet,
  ) {
    this.group.name = 'guardians';
    this.glowTex = glowTexture();
    for (const g of world.state.guardians) this.bodies.push(this.build(g));
  }

  private build(g: GuardianState): Body {
    const rock = new THREE.MeshStandardMaterial({ ...surfaceParams(this.stone), color: '#b99c77' });
    const dark = new THREE.MeshStandardMaterial({ ...surfaceParams(this.stone), color: '#6f5a44' });
    const bronze = new THREE.MeshStandardMaterial({ color: '#8c6a3c', metalness: 0.85, roughness: 0.45 });
    const core = new THREE.MeshStandardMaterial({
      color: '#ffb347',
      emissive: '#ff9a2a',
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    const eyes = new THREE.MeshStandardMaterial({
      color: '#2a1606',
      emissive: '#ffae3a',
      emissiveIntensity: 0.2,
    });
    const cracks = new THREE.MeshStandardMaterial({
      color: '#2a1608',
      emissive: '#ff8a20',
      emissiveIntensity: 0,
      roughness: 1,
    });
    const box = (w: number, h: number, d: number, mat: THREE.Material, r = 0.08): THREE.Mesh =>
      new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat);

    const root = new THREE.Group();
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    root.add(hips);
    const pelvis = box(1.2, 0.45, 0.85, rock);
    hips.add(pelvis);
    const belt = box(1.3, 0.14, 0.92, bronze, 0.03);
    belt.position.y = 0.16;
    hips.add(belt);

    // Torso: a broad, forward-hunched mass.
    const torso = new THREE.Group();
    torso.position.y = 0.2;
    hips.add(torso);
    const waist = box(1.15, 0.5, 0.8, rock);
    waist.position.y = 0.3;
    torso.add(waist);
    const chest = box(1.9, 0.85, 1.05, rock, 0.12);
    chest.position.set(0, 0.95, 0.02);
    torso.add(chest);
    // A carved sun on the chest (front is -Z).
    const sun = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.06, 24), dark);
    sun.rotation.x = Math.PI / 2;
    sun.position.set(0, 0.95, -0.54);
    torso.add(sun);
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      const ray = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.05), dark);
      ray.position.set(Math.sin(a) * 0.4, 0.95 + Math.cos(a) * 0.4, -0.54);
      ray.rotation.z = -a;
      torso.add(ray);
    }
    // Shoulder blocks and a bronze collar.
    for (const s of [-1, 1]) {
      const pauldron = box(0.62, 0.5, 0.95, rock, 0.12);
      pauldron.position.set(s * 0.98, 1.22, 0);
      pauldron.rotation.z = s * -0.18;
      torso.add(pauldron);
    }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 20), bronze);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 1.4, 0);
    torso.add(collar);
    // The core in the upper back, ringed in bronze.
    const coreGem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), core);
    coreGem.position.set(0, 1.12, 0.52);
    coreGem.scale.set(1, 1, 0.6);
    torso.add(coreGem);
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.05, 8, 24), bronze);
    coreRing.position.set(0, 1.12, 0.55);
    torso.add(coreRing);
    const coreGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: '#ffb050',
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    coreGlow.position.set(0, 1.12, 0.7);
    coreGlow.scale.setScalar(1.2);
    torso.add(coreGlow);
    const coreLight = new THREE.PointLight('#ff9a3a', 0, 7, 2);
    coreLight.position.set(0, 1.2, 1);
    torso.add(coreLight);
    // Glowing cracks that open as it is hurt.
    for (const [x, y, z, rz, h] of [
      [0.35, 0.8, -0.55, 0.5, 0.6],
      [-0.5, 1.05, -0.55, -0.3, 0.5],
      [0.2, 1.3, 0.54, -0.6, 0.45],
      [-0.3, 0.75, 0.54, 0.4, 0.55],
      [0.7, 1.15, 0.2, 0.2, 0.5],
    ] as const) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.02), cracks);
      c.position.set(x, y, z);
      c.rotation.z = rz;
      torso.add(c);
    }

    // Head: small, sunk between the shoulders.
    const head = new THREE.Group();
    head.position.set(0, 1.45, -0.18);
    torso.add(head);
    const skull = box(0.55, 0.5, 0.55, rock, 0.1);
    skull.position.y = 0.2;
    head.add(skull);
    const brow = box(0.62, 0.12, 0.2, dark, 0.03);
    brow.position.set(0, 0.32, -0.24);
    head.add(brow);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.02), eyes);
      eye.position.set(s * 0.13, 0.22, -0.28);
      head.add(eye);
    }
    // A crest of sun rays fanned over the head: the temple's keeper.
    for (let r = -3; r <= 3; r++) {
      const a = r * 0.32;
      const ray = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42 - Math.abs(r) * 0.04, 4), bronze);
      ray.position.set(Math.sin(a) * 0.36, 0.3 + Math.cos(a) * 0.36, 0.02);
      ray.rotation.z = -a;
      head.add(ray);
    }
    const band = box(0.6, 0.08, 0.6, bronze, 0.02);
    band.position.y = 0.42;
    head.add(band);

    // Arms: long, ending in heavy fists that almost touch the floor.
    const shoulders: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
    const elbows: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
    ([-1, 1] as const).forEach((s, i) => {
      const sh = shoulders[i] as THREE.Group;
      sh.position.set(s * 1.05, 1.1, 0);
      torso.add(sh);
      const upper = box(0.48, 0.95, 0.5, rock);
      upper.position.y = -0.45;
      sh.add(upper);
      const el = elbows[i] as THREE.Group;
      el.position.y = -0.92;
      sh.add(el);
      const fore = box(0.55, 0.85, 0.55, rock);
      fore.position.y = -0.4;
      el.add(fore);
      const cuff = box(0.62, 0.16, 0.62, bronze, 0.03);
      cuff.position.y = -0.62;
      el.add(cuff);
      const fist = box(0.72, 0.62, 0.72, rock, 0.12);
      fist.position.y = -1.02;
      el.add(fist);
      // Bronze studs across the knuckles.
      for (const k of [-0.22, 0, 0.22]) {
        const stud = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bronze);
        stud.position.set(k, -1.2, -0.34);
        el.add(stud);
      }
    });

    // Legs: short pillars.
    const thighs: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
    const knees: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
    ([-1, 1] as const).forEach((s, i) => {
      const th = thighs[i] as THREE.Group;
      th.position.set(s * 0.42, 0, 0);
      hips.add(th);
      const thigh = box(0.55, 0.55, 0.6, rock);
      thigh.position.y = -0.25;
      th.add(thigh);
      const kn = knees[i] as THREE.Group;
      kn.position.y = -0.48;
      th.add(kn);
      const shin = box(0.6, 0.42, 0.66, rock);
      shin.position.y = -0.2;
      kn.add(shin);
      const foot = box(0.7, 0.16, 0.9, dark, 0.05);
      foot.position.set(0, -0.4, -0.08);
      kn.add(foot);
    });

    // Each joint's parts become one mesh per material (a few dozen draws down to about twenty).
    coreGlow.userData.keep = true;
    for (const j of [hips, torso, head, ...shoulders, ...elbows, ...thighs, ...knees]) {
      for (const c of j.children) if (c instanceof THREE.Group) c.userData.keep = true;
      mergeStatic(j);
      for (const c of j.children) if (c instanceof THREE.Group) c.userData.keep = false;
    }
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    coreGlow.castShadow = false;

    // The tell: a ring on the floor where the fists will land, filling in as it winds up.
    const tellMat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      color: '#ff8a2a',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const tell = new THREE.Mesh(new THREE.CircleGeometry(1, 32), tellMat);
    tell.rotation.x = -Math.PI / 2;
    tell.visible = false;
    this.group.add(tell);

    // Dust puffs.
    const dust = new PuffPool(DUST, '#7d6a54', 1.6, 2);
    this.group.add(dust.mesh);

    // Shockwave ring for the slam.
    const wave = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 48),
      new THREE.MeshBasicMaterial({
        color: '#e8cfa0',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    wave.rotation.x = -Math.PI / 2;
    this.group.add(wave);

    // Broken pieces shown once it falls apart.
    const rubble = new THREE.Group();
    const RUBBLE = 12;
    const rubbleRest = new Float32Array(RUBBLE * 3);
    for (let i = 0; i < RUBBLE; i++) {
      const piece = box(0.3 + (i % 3) * 0.14, 0.25 + (i % 2) * 0.12, 0.38, i % 4 === 0 ? dark : rock, 0.05);
      const a = i * 2.39;
      const r = 0.7 + (i % 3) * 0.45;
      rubbleRest[i * 3] = Math.cos(a) * r;
      rubbleRest[i * 3 + 1] = 0.12;
      rubbleRest[i * 3 + 2] = Math.sin(a) * r;
      piece.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      piece.castShadow = true;
      rubble.add(piece);
    }
    rubble.visible = false;
    this.group.add(rubble);

    this.group.add(root);
    return {
      id: g.id,
      joints: { root, hips, torso, head, shoulders, elbows, thighs, knees },
      pose: clonePose(REST),
      target: clonePose(REST),
      walk: 0,
      last: new THREE.Vector3(g.pos.x, g.pos.y, g.pos.z),
      core,
      eyes,
      cracks,
      coreLight,
      coreGlow,
      wave,
      waveAge: Infinity,
      lastMode: g.mode,
      rubble,
      rubbleRest,
      rubbleAge: 0,
      tell,
      tellMat,
      dust,
    };
  }

  update(world: World, time: number, dt: number, eye: { x: number; y: number; z: number }): void {
    for (const b of this.bodies) {
      for (const g of world.state.guardians) if (g.id === b.id) this.animate(b, g, time, dt);
      b.dust.update(dt, eye);
    }
  }

  private animate(b: Body, g: GuardianState, time: number, dt: number): void {
    const J = b.joints;
    const ph = g.phase - 1;
    const t = g.modeTime;
    const target = b.target;
    copyPose(target, REST);
    // Walk cycle driven by the distance walked.
    const moved = Math.hypot(g.pos.x - b.last.x, g.pos.z - b.last.z);
    b.last.set(g.pos.x, g.pos.y, g.pos.z);
    b.walk += moved * (Math.PI / G.stride);
    const speed = Math.hypot(g.vel.x, g.vel.z);
    let core = g.phase === 2 ? 1.4 : 0.7;
    let eyes = 1;

    switch (g.mode) {
      case 'dormant':
        target.headPitch = 0.45;
        target.torsoPitch = 0.2;
        set2(target.shoulder, 0.3, 0.3);
        core = 0.25;
        eyes = 0.1;
        break;
      case 'chase': {
        const k = Math.min(1, speed / 1.2);
        const s = Math.sin(b.walk);
        set2(target.thigh, s * 0.45 * k, -s * 0.45 * k);
        set2(target.knee, Math.max(0, -Math.cos(b.walk)) * 0.5 * k, Math.max(0, Math.cos(b.walk)) * 0.5 * k);
        set2(target.shoulder, 0.15 - s * 0.35 * k, 0.15 + s * 0.35 * k);
        target.roll = s * 0.06 * k;
        target.y = -Math.abs(Math.cos(b.walk)) * 0.06 * k;
        target.torsoPitch = 0.22 + 0.1 * k;
        target.torsoYaw = s * 0.08 * k;
        break;
      }
      case 'windup': {
        // Arms up and back, leaning back, the core flaring: the tell.
        const k = Math.min(1, t / ((G.windup[ph] ?? 1) * 0.8));
        set2(target.shoulder, 0.15 - 2.9 * k, 0.15 - 2.9 * k);
        set2(target.shoulderOut, 0.25 * k, 0.25 * k);
        set2(target.elbow, -0.35 - 0.5 * k, -0.35 - 0.5 * k);
        target.torsoPitch = 0.12 - 0.35 * k;
        target.headPitch = -0.25 * k;
        set2(target.knee, 0.25 * k, 0.25 * k);
        target.y = -0.12 * k;
        core = 1.2 + 3.5 * k * (0.8 + 0.2 * Math.sin(time * 30));
        eyes = 1 + 2 * k;
        break;
      }
      case 'slam':
      case 'recover': {
        // The blow lands in the first instant, then it stays hunched, fists buried, core bared.
        const hit = Math.min(1, t / 0.12);
        set2(target.shoulder, 0.15 + 0.9 * hit, 0.15 + 0.9 * hit);
        set2(target.shoulderOut, 0.05, 0.05);
        set2(target.elbow, -0.1, -0.1);
        target.torsoPitch = 0.12 + 0.78 * hit;
        target.headPitch = 0.3;
        set2(target.knee, 0.45, 0.45);
        set2(target.thigh, -0.35, -0.35);
        target.y = -0.35 * hit;
        core = 2.5 + 1.5 * Math.sin(time * 9);
        eyes = 0.6;
        break;
      }
      case 'stunned':
        target.torsoPitch = 0.3 + Math.sin(time * 7) * 0.15;
        target.roll = Math.sin(time * 5) * 0.18;
        target.headPitch = 0.6;
        set2(target.shoulder, 0.4, -0.1);
        set2(target.knee, 0.3, 0.1);
        core = Math.sin(time * 37) > 0.35 ? 0.3 : 3;
        eyes = 0.3;
        break;
      case 'falling':
        target.pitch = -0.6;
        set2(target.shoulder, -2.4, -2.2);
        set2(target.thigh, 0.6, -0.3);
        core = 2;
        break;
      case 'fallen':
        target.pitch = -1.35;
        target.y = 0.4;
        set2(target.shoulder, -2.8, -2.6);
        core = 1 + Math.sin(time * 3) * 0.5;
        eyes = 0.2;
        break;
      case 'climbing':
        target.pitch = -0.35;
        set2(target.shoulder, -2.9 + Math.sin(time * 4) * 0.4, -2.9 - Math.sin(time * 4) * 0.4);
        set2(target.elbow, -0.6, -0.6);
        set2(target.knee, 0.7, 0.2);
        core = 1.6;
        break;
      case 'defeated':
        target.pitch = 1.35;
        target.y = -0.55;
        target.torsoPitch = 0.4;
        set2(target.shoulder, 1.4, 0.9);
        set2(target.shoulderOut, 0.7, 0.6);
        set2(target.knee, 1.2, 1.1);
        set2(target.thigh, -1, -0.9);
        target.headPitch = 0.9;
        core = 0;
        eyes = 0;
        break;
    }

    const k = 1 - Math.exp(-dt * (g.mode === 'recover' || g.mode === 'slam' ? 30 : 9));
    blendPose(b.pose, target, k);
    const p = b.pose;
    J.root.position.set(g.pos.x, g.pos.y + p.y, g.pos.z);
    J.root.rotation.set(0, 0, 0);
    J.root.rotation.y = g.yaw;
    // Body pitch about the feet, in the direction it faces.
    J.hips.rotation.x = -p.pitch;
    J.hips.rotation.z = p.roll;
    J.torso.rotation.x = -p.torsoPitch;
    J.torso.rotation.y = p.torsoYaw;
    J.head.rotation.x = -p.headPitch;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const sh = J.shoulders[i as 0 | 1];
      // Positive swings the arm forward (the front is -Z).
      sh.rotation.x = p.shoulder[i] ?? 0;
      sh.rotation.z = side * (p.shoulderOut[i] ?? 0);
      J.elbows[i as 0 | 1].rotation.x = -(p.elbow[i] ?? 0);
      J.thighs[i as 0 | 1].rotation.x = -(p.thigh[i] ?? 0);
      J.knees[i as 0 | 1].rotation.x = -(p.knee[i] ?? 0);
    }

    // Light and glow.
    b.core.emissiveIntensity += (core - b.core.emissiveIntensity) * Math.min(1, dt * 10);
    b.eyes.emissiveIntensity += (eyes * 2.5 - b.eyes.emissiveIntensity) * Math.min(1, dt * 6);
    b.cracks.emissiveIntensity = g.phase === 2 ? 1.2 + Math.sin(time * 4) * 0.4 : 0;
    b.coreLight.intensity = b.core.emissiveIntensity * 5;
    const glow = b.coreGlow.material as THREE.SpriteMaterial;
    glow.opacity = Math.min(1, b.core.emissiveIntensity / 3);
    b.coreGlow.scale.setScalar(0.9 + b.core.emissiveIntensity * 0.35);

    // Where the fists land: in front of it.
    const fx = g.pos.x - Math.sin(g.yaw) * 1.2;
    const fz = g.pos.z - Math.cos(g.yaw) * 1.2;

    // The tell: during the wind-up a ring fills in on the floor under the coming blow.
    if (g.mode === 'windup') {
      const k = Math.min(1, t / (G.windup[ph] ?? 1));
      b.tell.visible = true;
      b.tell.position.set(fx, g.pos.y + 0.03, fz);
      b.tell.scale.setScalar(G.slamRadius * (1.15 - 0.35 * k));
      b.tellMat.opacity = (0.25 + 0.6 * k) * (0.75 + 0.25 * Math.sin(time * (14 + 20 * k)));
    } else if (b.tell.visible) {
      b.tellMat.opacity = Math.max(0, b.tellMat.opacity - dt * 3);
      b.tell.visible = b.tellMat.opacity > 0;
    }

    // Shockwave and dust when the blow lands; dust when it hits the pit floor or falls apart.
    const entered = g.mode !== b.lastMode;
    if (entered && (g.mode === 'slam' || (g.mode === 'recover' && b.lastMode === 'windup'))) {
      b.waveAge = 0;
      b.wave.position.set(fx, g.pos.y + 0.05, fz);
      this.puff(b, fx, g.pos.y + 0.2, fz, 16, 3.2);
    }
    if (entered && g.mode === 'fallen') this.puff(b, g.pos.x, g.pos.y + 0.3, g.pos.z, 14, 2.6);
    if (entered && g.mode === 'defeated') {
      b.rubbleAge = 0;
      this.puff(b, g.pos.x, g.pos.y + 0.6, g.pos.z, 20, 2.2);
    }
    b.lastMode = g.mode;
    b.waveAge += dt;
    const wm = b.wave.material as THREE.MeshBasicMaterial;
    if (b.waveAge < 0.6) {
      b.wave.scale.setScalar(0.5 + b.waveAge * (G.slamRadius / 0.6));
      wm.opacity = 0.6 * (1 - b.waveAge / 0.6);
    } else {
      wm.opacity = 0;
    }
    // Hidden, not just transparent: no pass (depth, AO, shadows) sees a spent ring.
    b.wave.visible = wm.opacity > 0.001;

    // Once defeated its pieces tumble away from the body and settle round it.
    b.rubble.visible = g.mode === 'defeated';
    if (b.rubble.visible) {
      b.rubbleAge += dt;
      b.rubble.position.set(g.pos.x, g.pos.y, g.pos.z);
      const k = Math.min(1, b.rubbleAge / 0.7);
      const pieces = b.rubble.children;
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        if (!piece) continue;
        const rx = b.rubbleRest[i * 3] ?? 0;
        const rz = b.rubbleRest[i * 3 + 2] ?? 0;
        // From chest height out along a low arc, landing at k = 1.
        const arc = 4 * k * (1 - k) * (0.6 + (i % 3) * 0.3);
        piece.position.set(rx * k, (b.rubbleRest[i * 3 + 1] ?? 0) + (1 - k) * 1.4 + arc, rz * k);
        piece.rotation.set(i * 0.7 + (1 - k) * 4, i * 1.3 + (1 - k) * 3, i * 0.4);
      }
    }
  }

  /** Throws `n` dust puffs out from a point, in a ring. */
  private puff(b: Body, x: number, y: number, z: number, n: number, speed: number): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + k * 0.37;
      const v = speed * (0.6 + ((k * 7) % 5) * 0.1);
      b.dust.spawn(x, y, z, Math.cos(a) * v, 0.5 + ((k * 3) % 4) * 0.25, Math.sin(a) * v);
    }
  }
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.3, 'rgba(255,200,120,0.6)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

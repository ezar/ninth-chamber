/**
 * The Forge's bronze automatons (spec §19): a heavy figure of cast plates on
 * a small joint hierarchy, a furnace glow behind the slits of its face and
 * chest, a mallet arm. Procedural animation follows the simulation: the
 * slow, stiff walk, the raised mallet before a blow, and its end: quenched
 * (the glow dies, it locks and keels over) or melted (it sinks into the
 * bronze).
 *
 * With the Meshy model (public/models/automaton.glb) the joint hierarchy
 * stays as hidden drivers of its bones (driven-skeleton.ts) and the furnace
 * glow lights the model's own painted furnace. Without it, the plates built here stand in.
 */
import * as THREE from 'three/webgpu';
import type { EnemyState } from '../sim/state';
import { enemyTypes } from '../sim/player/tuning';
import type { JackalView } from './enemies';
import {
  DrivenSkeleton,
  disposeMounted,
  mountSkinned,
  type HangRest,
  type SkinnedAsset,
} from './driven-skeleton';

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const smooth = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** The automaton's height (docs/art/models-brief.md); the model is scaled to it. */
const HEIGHT = 2.2;
/** The bones the view needs: those its joints drive, and the forearms the arms hang towards. */
export const AUTOMATON_BONES = [
  'Hips',
  'Spine02',
  'Head',
  'RightUpLeg',
  'LeftUpLeg',
  'RightArm',
  'LeftArm',
  'RightForeArm',
  'LeftForeArm',
] as const;
/** The model is rigged in an A pose; the stand-in's arms hang straight. */
const HANG: HangRest[] = [
  { bone: 'LeftArm', toward: 'LeftForeArm', dir: new THREE.Vector3(0.18, -1, 0.04) },
  { bone: 'RightArm', toward: 'RightForeArm', dir: new THREE.Vector3(-0.18, -1, 0.04) },
];

interface Limb {
  pivot: THREE.Group;
  restZ: number;
}

export class AutomatonView implements JackalView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: [Limb, Limb];
  private readonly arms: [Limb, Limb];
  private readonly plate = new THREE.MeshStandardMaterial({
    color: '#7d5b33',
    metalness: 0.9,
    roughness: 0.4,
  });
  private readonly dark = new THREE.MeshStandardMaterial({
    color: '#3a2a19',
    metalness: 0.8,
    roughness: 0.6,
  });
  private readonly glow = new THREE.MeshStandardMaterial({
    color: '#3a1404',
    emissive: new THREE.Color('#ff6a1a'),
    emissiveIntensity: 1.8,
    roughness: 0.5,
  });
  private readonly geometries: THREE.BufferGeometry[] = [];
  private stride = 0;
  private flinchT = 0;
  /** 0 standing … 1 keeled over (quenched). */
  private fall = 0;
  /** 0 … 1 sunk into the bronze (melted). */
  private sink = 0;
  /** The Meshy model, what drives it, and its materials (their painted furnace glows). */
  private readonly model: THREE.Object3D | null = null;
  private readonly skeleton: DrivenSkeleton | null = null;
  private readonly modelMats: THREE.MeshStandardMaterial[] = [];

  constructor(asset: SkinnedAsset | null = null) {
    const piece = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      this.geometries.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const box = (w: number, h: number, d: number): THREE.BoxGeometry => new THREE.BoxGeometry(w, h, d);
    const cyl = (r: number, h: number): THREE.CylinderGeometry => new THREE.CylinderGeometry(r, r, h, 10);

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.98;
    piece(box(0.7, 0.3, 0.45), this.dark, this.hips, 0, 0, 0);

    const leg = (side: 1 | -1): Limb => {
      const pivot = new THREE.Group();
      pivot.position.set(0.22 * side, -0.08, 0);
      this.hips.add(pivot);
      piece(cyl(0.12, 0.5), this.dark, pivot, 0, -0.25, 0);
      piece(box(0.28, 0.42, 0.3), this.plate, pivot, 0, -0.6, 0.02);
      piece(box(0.32, 0.12, 0.46), this.plate, pivot, 0, -0.86, -0.06);
      return { pivot, restZ: 0 };
    };
    this.legs = [leg(1), leg(-1)];

    this.hips.add(this.torso);
    this.torso.position.y = 0.15;
    piece(box(0.9, 0.75, 0.55), this.plate, this.torso, 0, 0.42, 0);
    // The furnace behind the chest slits.
    for (let i = 0; i < 3; i++)
      piece(box(0.42, 0.04, 0.02), this.glow, this.torso, 0, 0.36 + i * 0.09, -0.285);
    // Shoulder plates.
    for (const side of [1, -1]) piece(box(0.34, 0.16, 0.6), this.dark, this.torso, 0.5 * side, 0.82, 0);

    this.torso.add(this.head);
    this.head.position.y = 0.88;
    piece(box(0.38, 0.42, 0.4), this.plate, this.head, 0, 0.18, 0);
    piece(box(0.28, 0.05, 0.02), this.glow, this.head, 0, 0.22, -0.205);

    const arm = (side: 1 | -1): Limb => {
      const pivot = new THREE.Group();
      pivot.position.set(0.58 * side, 0.74, 0);
      this.torso.add(pivot);
      piece(cyl(0.1, 0.55), this.dark, pivot, 0, -0.3, 0);
      piece(box(0.26, 0.5, 0.26), this.plate, pivot, 0, -0.78, 0);
      if (side === 1) {
        // The mallet.
        piece(cyl(0.05, 0.5), this.dark, pivot, 0, -1.08, 0);
        const head = piece(box(0.46, 0.24, 0.24), this.plate, pivot, 0, -1.34, 0);
        head.rotation.y = Math.PI / 2;
      } else {
        piece(box(0.3, 0.2, 0.3), this.dark, pivot, 0, -1.1, 0);
      }
      return { pivot, restZ: 0.06 * side };
    };
    this.arms = [arm(1), arm(-1)];

    if (asset) {
      // The model rides the body (it keels over and sinks with it); the plates become hidden drivers.
      this.body.traverse((o) => {
        if (o instanceof THREE.Mesh) o.visible = false;
      });
      const model = mountSkinned(asset, this.body, HEIGHT, { metalness: 0.6 });
      this.model = model;
      const [rLeg, lLeg] = this.legs;
      const [rArm, lArm] = this.arms;
      this.skeleton = new DrivenSkeleton(
        model,
        this.body,
        {
          Hips: this.hips,
          Spine02: this.torso,
          Head: this.head,
          RightUpLeg: rLeg.pivot,
          LeftUpLeg: lLeg.pivot,
          RightArm: rArm.pivot,
          LeftArm: lArm.pivot,
        },
        HANG,
      );
      // The furnace is painted in the texture: lit by its own colour it glows where it is bright
      // orange and barely on the dark bronze, and goes out with the glow when quenched.
      model.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
          o.material.emissive.set('#ff6a1a');
          o.material.emissiveMap = o.material.map;
          this.modelMats.push(o.material);
        }
      });
    }
  }

  flinch(): void {
    this.flinchT = 0.2;
  }

  update(e: EnemyState, dt: number, look: THREE.Vector3 | null): void {
    const s = enemyTypes.automaton;
    const speed = Math.hypot(e.vel.x, e.vel.z);
    this.stride += (speed / 1.0) * dt * Math.PI;
    this.flinchT = Math.max(0, this.flinchT - dt);
    const gone = e.mode === 'dead';
    // Molten bronze over it: it sinks; anything else that ends it (quench water) keels it over.
    const melted = gone && e.fate === 'melted';
    this.sink = melted ? Math.min(1, this.sink + dt / 2) : 0;
    this.fall = gone && !melted ? Math.min(1, this.fall + dt / 1.2) : 0;

    // Stiff walk: short swings, the body rocks side to side.
    const swing = Math.sin(this.stride) * clamp(speed / s.runSpeed, 0, 1) * 0.4;
    this.legs[0].pivot.rotation.x = swing;
    this.legs[1].pivot.rotation.x = -swing;
    this.body.rotation.z = Math.sin(this.stride) * 0.05 * clamp(speed, 0, 1);
    // The mallet rises during the wind-up and falls on the blow.
    const wind = e.mode === 'attack' ? smooth(1 - e.biteIn / Math.max(0.01, s.bite.interval)) : 0;
    this.arms[0].pivot.rotation.set(-swing * 0.5 - wind * 2.6, 0, this.arms[0].restZ);
    this.arms[1].pivot.rotation.set(swing * 0.5, 0, this.arms[1].restZ);
    if (look && !gone) {
      const yaw = Math.atan2(-look.x, -look.z);
      this.head.rotation.y += (clamp(yaw, -0.5, 0.5) - this.head.rotation.y) * (1 - Math.exp(-dt * 3));
    }
    this.torso.rotation.x = (this.flinchT > 0 ? 0.15 : 0) + this.fall * 0.2;

    // Keeling over, or sinking into the melt.
    this.body.rotation.x = -smooth(this.fall) * (Math.PI / 2 - 0.15);
    this.body.position.y = this.fall * 0.3 - this.sink * 2.2;
    this.root.visible = this.sink < 1;

    // The furnace glow: steady while it works, flickering when hit, dark once quenched.
    const target = gone ? (melted ? 3 : 0) : this.flinchT > 0 ? 3 : 1.8;
    this.glow.emissiveIntensity += (target - this.glow.emissiveIntensity) * (1 - Math.exp(-dt * 4));
    for (const m of this.modelMats) m.emissiveIntensity = this.glow.emissiveIntensity * 0.2;
    this.skeleton?.apply();
  }

  dispose(): void {
    if (this.model) disposeMounted(this.model);
    for (const g of this.geometries) g.dispose();
    this.plate.dispose();
    this.dark.dispose();
    this.glow.dispose();
  }
}

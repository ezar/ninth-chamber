/**
 * The Root Halls' scorpions (spec §19, chamber V), stand-ins until the
 * owner's models (docs/art/models-brief.md): a dark amber scorpion about
 * half a metre long, with eight legs, two pincers and a tail arched over its
 * back. Procedural animation follows the simulation: legs ripple with its
 * speed, the pincers open as it closes in, the tail strikes with each sting,
 * and it rolls over when killed.
 */
import * as THREE from 'three/webgpu';
import type { EnemyState } from '../sim/state';
import type { JackalView } from './enemies';

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export class ScorpionView implements JackalView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly claws: THREE.Group[] = [];
  private readonly tail: THREE.Group[] = [];
  private readonly shell = new THREE.MeshStandardMaterial({
    color: '#4a3220',
    roughness: 0.45,
    metalness: 0.1,
  });
  private readonly limb = new THREE.MeshStandardMaterial({ color: '#6b4a2a', roughness: 0.55 });
  private readonly sting = new THREE.MeshStandardMaterial({ color: '#1c140e', roughness: 0.35 });
  private readonly geometries: THREE.BufferGeometry[] = [];
  private gait = 0;
  private strike = 0;
  private flinchT = 0;
  private roll = 0;
  private lastBite = 0;

  constructor() {
    const piece = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh => {
      this.geometries.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.root.add(this.body);
    this.body.position.y = 0.09;
    // Body: a flat segmented shell (it faces -Z).
    const thorax = piece(new THREE.SphereGeometry(0.09, 12, 8), this.shell, this.body);
    thorax.scale.set(1, 0.45, 1.5);
    const head = piece(new THREE.SphereGeometry(0.06, 10, 6), this.shell, this.body);
    head.scale.set(1.1, 0.5, 0.9);
    head.position.z = -0.13;
    // Legs: four a side, each a thigh and a shin on a hip pivot.
    for (let i = 0; i < 4; i++)
      for (const side of [1, -1]) {
        const hip = new THREE.Group();
        hip.position.set(0.06 * side, 0, -0.06 + i * 0.045);
        this.body.add(hip);
        const thigh = piece(new THREE.CylinderGeometry(0.008, 0.01, 0.1, 5), this.limb, hip);
        thigh.rotation.z = (side * Math.PI) / 2.6;
        thigh.position.set(0.04 * side, 0.02, 0);
        const shin = piece(new THREE.CylinderGeometry(0.005, 0.008, 0.1, 5), this.limb, hip);
        shin.rotation.z = (-side * Math.PI) / 5;
        shin.position.set(0.1 * side, -0.02, 0);
        hip.userData.side = side;
        hip.userData.i = i;
        this.legs.push(hip);
      }
    // Pincers on arms, ahead.
    for (const side of [1, -1]) {
      const arm = new THREE.Group();
      arm.position.set(0.05 * side, 0, -0.15);
      this.body.add(arm);
      const fore = piece(new THREE.CylinderGeometry(0.012, 0.014, 0.12, 6), this.limb, arm);
      fore.rotation.x = Math.PI / 2;
      fore.rotation.z = side * 0.5;
      fore.position.set(0.03 * side, 0, -0.05);
      const claw = new THREE.Group();
      claw.position.set(0.06 * side, 0, -0.11);
      arm.add(claw);
      const palm = piece(new THREE.SphereGeometry(0.03, 8, 6), this.shell, claw);
      palm.scale.set(0.8, 0.6, 1.4);
      const finger = piece(new THREE.ConeGeometry(0.012, 0.06, 5), this.shell, claw);
      finger.rotation.x = -Math.PI / 2;
      finger.position.set(-0.012 * side, 0, -0.05);
      claw.userData.finger = finger;
      claw.userData.side = side;
      this.claws.push(claw);
    }
    // Tail: five segments arching up over the back, the sting at the end.
    let parent: THREE.Object3D = this.body;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.01 : 0.055, i === 0 ? 0.13 : 0);
      parent.add(seg);
      const ball = piece(new THREE.SphereGeometry(0.03 - i * 0.003, 8, 6), this.shell, seg);
      ball.scale.set(1, 0.9, 1.3);
      this.tail.push(seg);
      parent = seg;
    }
    const tip = piece(new THREE.ConeGeometry(0.012, 0.06, 6), this.sting, parent);
    tip.position.set(0, 0.04, -0.01);
    tip.rotation.x = -0.6;
  }

  flinch(): void {
    this.flinchT = 0.2;
  }

  update(e: EnemyState, dt: number, look: THREE.Vector3 | null): void {
    this.flinchT = Math.max(0, this.flinchT - dt);
    const dead = e.mode === 'dead';
    const speed = Math.hypot(e.vel.x, e.vel.z);
    this.gait += dt * (dead ? 0 : 6 + speed * 9);
    // Legs ripple front to back, alternate sides.
    for (const hip of this.legs) {
      const side = hip.userData.side as number;
      const i = hip.userData.i as number;
      const ph = this.gait + i * 1.1 + (side > 0 ? 0 : Math.PI);
      const k = clamp(speed / 2, 0.15, 1);
      hip.rotation.set(0, Math.sin(ph) * 0.35 * k, side * Math.max(0, Math.cos(ph)) * 0.25 * k);
    }
    // A sting: the tail whips forward; each new bite starts a strike.
    const bite = e.biteIn;
    if (e.mode === 'attack' && bite > this.lastBite + 0.2) this.strike = 1;
    this.lastBite = bite;
    this.strike = Math.max(0, this.strike - dt * 3.5);
    const s = Math.sin(this.strike * Math.PI);
    this.tail.forEach((seg, i) => {
      seg.rotation.x = -(i === 0 ? 0.9 : 0.55) - s * (i === 0 ? 0.2 : 0.3);
    });
    // Pincers open as it closes in.
    const open = e.mode === 'attack' || e.mode === 'chase' ? 0.5 + 0.3 * Math.sin(this.gait * 0.7) : 0.1;
    for (const claw of this.claws) {
      const side = claw.userData.side as number;
      claw.rotation.y = side * (0.25 + (look ? 0.1 : 0));
      (claw.userData.finger as THREE.Object3D).rotation.y = side * open;
    }
    this.roll = dead ? Math.min(Math.PI, this.roll + dt * 8) : 0;
    this.body.rotation.set(this.flinchT > 0 ? -0.2 : 0, 0, this.roll);
    this.body.position.y = 0.09 + (dead ? 0.03 : 0);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.shell.dispose();
    this.limb.dispose();
    this.sting.dispose();
  }
}

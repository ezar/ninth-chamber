/**
 * The Wind Stair's rock birds (spec §19, chamber VII), stand-ins until the
 * owner's models (docs/art/models-brief.md): a grey-brown bird the colour of
 * the shaft's stone, with long wings on shoulder pivots. Procedural
 * animation follows the simulation: folded on the nest, quick beats as it
 * rises and dives, a glide while it climbs away, a tumble when shot down.
 */
import * as THREE from 'three/webgpu';
import type { EnemyState } from '../sim/state';
import type { JackalView } from './enemies';

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export class BirdView implements JackalView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly wings: [THREE.Group, THREE.Group];
  private readonly tips: [THREE.Group, THREE.Group];
  private readonly feather = new THREE.MeshStandardMaterial({ color: '#6f675d', roughness: 0.9 });
  private readonly pale = new THREE.MeshStandardMaterial({ color: '#a59c8c', roughness: 0.85 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: '#2c2824', roughness: 0.6 });
  private readonly geometries: THREE.BufferGeometry[] = [];
  private beat = 0;
  private flinchT = 0;
  private tumble = 0;

  constructor() {
    const piece = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh => {
      this.geometries.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    // Rock birds are big enough to read against the shaft: a wingspan of about 1.4 m.
    this.root.add(this.body);
    this.body.scale.setScalar(1.4);
    this.body.position.y = 0.22;
    // Body: a stretched sphere, pale underneath.
    const torso = piece(new THREE.SphereGeometry(0.14, 12, 8), this.feather, this.body);
    torso.scale.set(1, 0.9, 1.9);
    const belly = piece(new THREE.SphereGeometry(0.12, 10, 6), this.pale, this.body);
    belly.scale.set(0.9, 0.7, 1.6);
    belly.position.set(0, -0.04, 0);
    // Tail fan behind (+Z: the bird faces -Z).
    const tail = piece(new THREE.ConeGeometry(0.1, 0.28, 4, 1, true), this.feather, this.body);
    tail.rotation.x = -Math.PI / 2;
    tail.scale.set(1.4, 1, 0.3);
    tail.position.set(0, 0.01, 0.34);
    // Head and hooked beak.
    this.body.add(this.head);
    this.head.position.set(0, 0.07, -0.25);
    piece(new THREE.SphereGeometry(0.075, 10, 8), this.feather, this.head);
    const beak = piece(new THREE.ConeGeometry(0.025, 0.09, 6), this.dark, this.head);
    beak.rotation.x = -Math.PI / 2 - 0.25;
    beak.position.set(0, -0.01, -0.1);
    for (const side of [1, -1]) {
      const eye = piece(new THREE.SphereGeometry(0.013, 6, 4), this.dark, this.head);
      eye.position.set(0.05 * side, 0.02, -0.04);
    }
    // Wings: an inner and an outer panel on shoulder pivots, so they can fold.
    const wing = (side: 1 | -1): [THREE.Group, THREE.Group] => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.1 * side, 0.05, -0.03);
      this.body.add(shoulder);
      const inner = piece(new THREE.BoxGeometry(0.34, 0.02, 0.2), this.feather, shoulder);
      inner.position.x = 0.17 * side;
      const tip = new THREE.Group();
      tip.position.x = 0.34 * side;
      shoulder.add(tip);
      const outer = piece(new THREE.BoxGeometry(0.32, 0.015, 0.14), this.feather, tip);
      outer.position.set(0.15 * side, 0, 0.03);
      const edge = piece(new THREE.BoxGeometry(0.3, 0.012, 0.04), this.dark, tip);
      edge.position.set(0.16 * side, 0, 0.11);
      return [shoulder, tip];
    };
    const r = wing(1);
    const l = wing(-1);
    this.wings = [r[0], l[0]];
    this.tips = [r[1], l[1]];
  }

  flinch(): void {
    this.flinchT = 0.25;
  }

  update(e: EnemyState, dt: number, look: THREE.Vector3 | null): void {
    this.flinchT = Math.max(0, this.flinchT - dt);
    const perched = e.mode === 'idle';
    const dead = e.mode === 'dead';
    const gliding = e.mode === 'attack';
    const speed = Math.hypot(e.vel.x, e.vel.z, e.vy ?? 0);
    // Quick beats rising and diving, slow ones gliding away.
    const rate = perched || dead ? 0 : gliding ? 4 : 9 + speed * 0.6;
    this.beat += rate * dt;
    const flap = Math.sin(this.beat * Math.PI * 2);
    // Wing spread: folded on the nest, out in the air.
    const fold = perched ? 1 : 0;
    const lift = perched ? 0 : gliding ? 0.15 + flap * 0.15 : flap * 0.9;
    this.wings.forEach((w, i) => {
      const side = i === 0 ? 1 : -1;
      w.rotation.set(0, -fold * side * 1.3, side * (lift + fold * 0.2));
    });
    this.tips.forEach((t, i) => {
      const side = i === 0 ? 1 : -1;
      t.rotation.set(0, -fold * side * 0.4, side * (perched ? 0 : flap * 0.5 - 0.1));
    });
    // Pitched along its flight: nose down in a dive.
    const vy = e.vy ?? 0;
    const h = Math.hypot(e.vel.x, e.vel.z);
    const pitch = perched ? 0 : clamp(Math.atan2(-vy, Math.max(0.5, h)), -0.9, 0.9);
    this.tumble = dead ? this.tumble + dt * 9 : 0;
    this.body.rotation.set(dead ? this.tumble : -pitch * 0.8, 0, dead ? this.tumble * 0.4 : flap * 0.05);
    this.body.position.y = perched ? 0.12 : 0.22;
    if (look && !dead) {
      const yaw = Math.atan2(-look.x, -look.z);
      this.head.rotation.y += (clamp(yaw, -0.8, 0.8) - this.head.rotation.y) * (1 - Math.exp(-dt * 6));
    }
    this.head.rotation.x = this.flinchT > 0 ? 0.4 : 0;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.feather.dispose();
    this.pale.dispose();
    this.dark.dispose();
  }
}

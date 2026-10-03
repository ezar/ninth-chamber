/**
 * Tamrit's body (spec §19), the stand-in until the owner's model arrives
 * (docs/art/models-brief.md, tamrit.glb): a tall figure of wet, cracked clay
 * built from rounded pieces on a small joint hierarchy, with a stylus in its
 * right hand and an ember-red core in its chest. Procedural animation follows
 * the simulation: the slow walk, the raised arm before a strike, the slump
 * into a heap when shot to pieces (and rising out of it again), and sinking
 * away for good when the water dissolves it.
 */
import * as THREE from 'three/webgpu';
import type { EnemyState } from '../sim/state';
import { clayGuardian, enemyTypes } from '../sim/player/tuning';
import type { JackalView } from './enemies';

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const smooth = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Wet clay: dark at the bottom where it is wettest, ochre and burnt red above. */
function clayMaterial(): THREE.MeshStandardMaterial {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  // A cheap crackle: value noise with sharp dark seams.
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const cells = Array.from({ length: 24 }, () => [rnd() * size, rnd() * size] as const);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      for (const [cx, cy] of cells) {
        const dx = Math.min(Math.abs(x - cx), size - Math.abs(x - cx));
        const dy = Math.min(Math.abs(y - cy), size - Math.abs(y - cy));
        const d = Math.hypot(dx, dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) d2 = d;
      }
      const seam = clamp((d2 - d1) / 3, 0, 1);
      const shade = 0.55 + 0.45 * seam + (rnd() - 0.5) * 0.06;
      const i = (y * size + x) * 4;
      data[i] = Math.round(150 * shade);
      data[i + 1] = Math.round(84 * shade);
      data[i + 2] = Math.round(52 * shade);
      data[i + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0 });
}

interface Limb {
  pivot: THREE.Group;
  rest: THREE.Euler;
}

export class ClayView implements JackalView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: [Limb, Limb];
  private readonly arms: [Limb, Limb];
  private readonly forearms: [THREE.Group, THREE.Group];
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.MeshStandardMaterial;
  private readonly material = clayMaterial();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private stride = 0;
  private flinchT = 0;
  /** Eased 0 (standing) … 1 (a heap). */
  private heap = 0;
  private sink = 0;

  constructor() {
    const piece = (
      geo: THREE.BufferGeometry,
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      this.geometries.push(geo);
      const m = new THREE.Mesh(geo, this.material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const capsule = (r: number, len: number): THREE.CapsuleGeometry =>
      new THREE.CapsuleGeometry(r, len, 4, 10);

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 1.05;
    piece(new THREE.SphereGeometry(0.3, 12, 8), this.hips, 0, 0, 0).scale.set(1.15, 0.7, 0.85);

    const leg = (side: 1 | -1): Limb => {
      const pivot = new THREE.Group();
      pivot.position.set(0.17 * side, -0.05, 0);
      this.hips.add(pivot);
      piece(capsule(0.13, 0.55), pivot, 0, -0.42, 0);
      piece(new THREE.BoxGeometry(0.24, 0.12, 0.36), pivot, 0, -0.96, -0.06);
      return { pivot, rest: new THREE.Euler() };
    };
    this.legs = [leg(1), leg(-1)];

    this.hips.add(this.torso);
    this.torso.position.y = 0.12;
    piece(capsule(0.3, 0.42), this.torso, 0, 0.36, 0).scale.set(1.2, 1, 0.8);
    this.coreMat = new THREE.MeshStandardMaterial({
      color: '#5a1a0c',
      emissive: new THREE.Color('#ff4a1a'),
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });
    const coreGeo = new THREE.IcosahedronGeometry(0.09, 1);
    this.geometries.push(coreGeo);
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.position.set(0, 0.46, -0.24);
    this.torso.add(this.core);

    this.torso.add(this.head);
    this.head.position.y = 0.9;
    piece(new THREE.SphereGeometry(0.17, 12, 10), this.head, 0, 0.1, 0).scale.set(0.9, 1.15, 0.95);
    // A scribe's tall cap of clay.
    piece(new THREE.CylinderGeometry(0.1, 0.15, 0.24, 10), this.head, 0, 0.36, 0.02);

    const arm = (side: 1 | -1): [Limb, THREE.Group] => {
      const pivot = new THREE.Group();
      pivot.position.set(0.42 * side, 0.68, 0);
      this.torso.add(pivot);
      piece(capsule(0.09, 0.36), pivot, 0, -0.26, 0);
      const fore = new THREE.Group();
      fore.position.y = -0.52;
      pivot.add(fore);
      piece(capsule(0.08, 0.32), fore, 0, -0.22, 0);
      piece(new THREE.SphereGeometry(0.1, 10, 8), fore, 0, -0.48, 0);
      if (side === 1) {
        // The stylus.
        const stylus = piece(new THREE.CylinderGeometry(0.012, 0.025, 0.42, 6), fore, 0, -0.52, -0.16);
        stylus.rotation.x = Math.PI / 2.4;
      }
      return [{ pivot, rest: new THREE.Euler(0, 0, 0.08 * side) }, fore];
    };
    const [ra, rf] = arm(1);
    const [la, lf] = arm(-1);
    this.arms = [ra, la];
    this.forearms = [rf, lf];
  }

  flinch(): void {
    this.flinchT = 0.25;
  }

  update(e: EnemyState, dt: number, look: THREE.Vector3 | null): void {
    const s = enemyTypes.clay;
    const speed = Math.hypot(e.vel.x, e.vel.z);
    this.stride += (speed / 1.1) * dt * Math.PI;
    this.flinchT = Math.max(0, this.flinchT - dt);

    // Heap: slump when crumbled; rise over the last second before reforming.
    const crumbled = e.mode === 'dead' && !e.dissolved;
    let heapTarget = 0;
    if (crumbled) heapTarget = e.modeTime < clayGuardian.reform - 1 ? 1 : clayGuardian.reform - e.modeTime;
    if (e.dissolved) heapTarget = 1;
    this.heap += (clamp(heapTarget, 0, 1) - this.heap) * (1 - Math.exp(-dt * (crumbled ? 6 : 3)));
    this.sink = e.dissolved ? Math.min(1, this.sink + dt / 2.5) : 0;
    const h = smooth(this.heap);

    // Walk: legs swing, arms counter-swing, the body bobs.
    const swing = Math.sin(this.stride) * clamp(speed / s.runSpeed, 0, 1) * 0.55;
    this.legs[0].pivot.rotation.x = swing;
    this.legs[1].pivot.rotation.x = -swing;
    // Strike: the stylus arm rises during the wind-up and comes down on the bite.
    const attacking = e.mode === 'attack';
    const wind = attacking ? smooth(1 - e.biteIn / Math.max(0.01, s.bite.interval)) : 0;
    this.arms[0].pivot.rotation.set(-swing * 0.6 - wind * 2.4, 0, this.arms[0].rest.z);
    this.forearms[0].rotation.x = -wind * 0.6;
    this.arms[1].pivot.rotation.set(swing * 0.6, 0, this.arms[1].rest.z);
    this.forearms[1].rotation.x = -0.2;
    this.body.position.y = Math.abs(Math.cos(this.stride)) * 0.04 * clamp(speed, 0, 1);

    // Look at Nora with the head, a little.
    if (look) {
      const yaw = Math.atan2(-look.x, -look.z);
      this.head.rotation.y += (clamp(yaw, -0.7, 0.7) - this.head.rotation.y) * (1 - Math.exp(-dt * 4));
    }
    this.torso.rotation.x = 0.06 + (this.flinchT > 0 ? 0.25 : 0) + h * 0.9;

    // The heap: everything sinks and spreads into a mound of clay.
    this.hips.position.y = 1.05 * (1 - h * 0.85);
    this.body.scale.set(1 + h * 0.5, 1 - h * 0.55, 1 + h * 0.5);
    this.root.position.y -= this.sink * 1.2;
    this.root.scale.setScalar(1 - this.sink * 0.6);
    this.root.visible = this.sink < 1;

    // The core glows while it hunts, dims in the heap and goes out in the water.
    const glow = e.dissolved ? 0 : crumbled ? 0.3 : 1.4 + 0.3 * Math.sin(this.stride * 0.5);
    this.coreMat.emissiveIntensity += (glow - this.coreMat.emissiveIntensity) * (1 - Math.exp(-dt * 5));
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.coreMat.dispose();
  }
}

/**
 * The Ninth Chamber's monuments (spec §19, chamber IX), stand-ins until the
 * owner's models arrive (docs/art/models-brief.md):
 * - the eight keepers in stone, each holding its chamber's relic, which glows
 *   in that chamber's colour; the ninth pedestal stands empty;
 * - the great seal of the nine on a wall: eight segments cut in stone and the
 *   ninth an outline, which fills with amber light once Nora carves her name.
 * It reads the simulation every frame and never writes to it.
 */
import * as THREE from 'three/webgpu';
import type { Level } from '../sim/grid/level';
import { BLOCK, DIR_VEC, DIR_YAW, type Dir } from '../sim/grid/units';
import type { World } from '../sim/world';

/** Each relic's glow, in campaign order (the Heart's amber … the Astrolabe's moonlight). */
const RELIC_GLOW = ['#f2a93b', '#7ee6dc', '#ffcf6a', '#ff9a5a', '#86e09a', '#d8894a', '#cfe4ff', '#b9cbf2'];

const SEAL_RADIUS = 2.4;
const SEAL_INNER = 1.7;
const SEAL_HEIGHT = 3.2;

export class Monuments {
  readonly group = new THREE.Group();
  private readonly stone = new THREE.MeshStandardMaterial({ color: '#b9a88c', roughness: 0.85 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: '#6f6250', roughness: 0.9 });
  private readonly ninth = new THREE.MeshStandardMaterial({
    color: '#e8a33d',
    emissive: '#e8a33d',
    emissiveIntensity: 0,
    roughness: 0.4,
    transparent: true,
    opacity: 0.25,
  });
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /** Seals whose ninth segment answers a lever: the lever's id. */
  private readonly sealLevers: string[] = [];
  private carved = 0;

  constructor(level: Level) {
    this.group.name = 'monuments';
    for (const e of level.entities) {
      const [cx, cz] = e.at;
      const y = level.floorAt(cx * BLOCK + BLOCK / 2, cz * BLOCK + BLOCK / 2);
      if (e.type === 'statue') this.statue(cx, cz, y, e.relic, e.face);
      if (e.type === 'seal') {
        this.seal(cx, cz, y, e.wall);
        if (e.lever) this.sealLevers.push(e.lever);
      }
    }
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    this.geometries.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  private statue(cx: number, cz: number, y: number, relic: number, face: Dir): void {
    const g = new THREE.Group();
    g.position.set(cx * BLOCK + BLOCK / 2, y, cz * BLOCK + BLOCK / 2);
    g.rotation.y = DIR_YAW[face];
    this.group.add(g);
    // The pedestal.
    this.mesh(new THREE.BoxGeometry(1.3, 0.6, 1.3), this.dark, g).position.y = 0.3;
    if (relic > 8) return;
    // A robed keeper: a tapered body, shoulders, a hooded head, arms forward holding the relic.
    const body = this.mesh(new THREE.CylinderGeometry(0.32, 0.5, 2.0, 10), this.stone, g);
    body.position.y = 0.6 + 1.0;
    const shoulders = this.mesh(new THREE.SphereGeometry(0.42, 12, 8), this.stone, g);
    shoulders.scale.set(1.15, 0.55, 0.8);
    shoulders.position.y = 2.55;
    const head = this.mesh(new THREE.SphereGeometry(0.24, 12, 10), this.stone, g);
    head.position.set(0, 2.95, 0.02);
    for (const side of [1, -1]) {
      const arm = this.mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.7, 6), this.stone, g);
      arm.position.set(side * 0.3, 2.2, -0.25);
      arm.rotation.x = Math.PI / 2.6;
      arm.rotation.z = side * 0.25;
    }
    // The relic, held at the chest, in its chamber's light (it faces -Z, the statue's front).
    const colour = RELIC_GLOW[relic - 1] ?? '#e8a33d';
    const glow = new THREE.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: 1.6,
      roughness: 0.3,
    });
    this.materials.push(glow);
    const r = this.mesh(new THREE.IcosahedronGeometry(0.16, 1), glow, g);
    r.position.set(0, 2.05, -0.55);
    r.castShadow = false;
  }

  private seal(cx: number, cz: number, y: number, wall: Dir): void {
    const v = DIR_VEC[wall];
    const g = new THREE.Group();
    // On the wall's face, looking back into the sector.
    g.position.set(
      cx * BLOCK + BLOCK / 2 + v.x * (BLOCK / 2 - 0.06),
      y + SEAL_HEIGHT,
      cz * BLOCK + BLOCK / 2 + v.z * (BLOCK / 2 - 0.06),
    );
    g.rotation.y = DIR_YAW[wall] + Math.PI;
    this.group.add(g);
    for (let i = 0; i < 9; i++) {
      // The same layout as the seal everywhere else (ui/seal.ts): segment 8, the ninth, up and to the left.
      const centre = -(-70 + i * 40) * (Math.PI / 180);
      const half = (18 * Math.PI) / 180;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, SEAL_RADIUS, centre - half, centre + half, false);
      shape.absarc(0, 0, SEAL_INNER, centre + half, centre - half, true);
      const ninth = i === 8;
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: ninth ? 0.04 : 0.14,
        bevelEnabled: false,
        curveSegments: 10,
      });
      this.mesh(geo, ninth ? this.ninth : this.stone, g);
    }
    // The centre boss.
    this.mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.16, 20), this.dark, g).rotation.x = Math.PI / 2;
  }

  update(world: World, dt: number): void {
    if (this.sealLevers.length === 0) return;
    const done = this.sealLevers.some((id) => world.state.signals[`${id}.used`]);
    const target = done ? 1 : 0;
    if (Math.abs(this.carved - target) < 1e-3) return;
    this.carved += (target - this.carved) * Math.min(1, dt * 0.8);
    this.ninth.opacity = 0.25 + 0.75 * this.carved;
    this.ninth.emissiveIntensity = 2.2 * this.carved;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of [this.stone, this.dark, this.ninth, ...this.materials]) m.dispose();
  }
}

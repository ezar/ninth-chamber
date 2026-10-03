/**
 * The Wind Stair's gusts (spec §19, chamber VII): dust streaks and a few
 * leaves blown along each wind zone while it gusts, a faint stir while the
 * flutes warn, and nothing in the calm. Views only read the simulation.
 */
import * as THREE from 'three/webgpu';
import type { Level } from '../sim/grid/level';
import { BLOCK, DIR_VEC } from '../sim/grid/units';
import { defsOf, type WindDef } from '../sim/mechanisms/defs';
import { windFactor } from '../sim/mechanisms/wind';
import type { World } from '../sim/world';

/** Streaks per cell of a zone, and at most this many per zone. */
const PER_CELL = 6;
const MAX_PER_ZONE = 240;
/** A streak travels at this many times the wind speed (it reads as gusty, not as drifting). */
const VISUAL_SPEED = 2.4;

interface Mote {
  /** Position across the zone, 0 … 1 on each axis, and along it. */
  u: number;
  v: number;
  w: number;
  /** Own speed factor and length. */
  speed: number;
  length: number;
  leaf: boolean;
}

interface ZoneView {
  def: WindDef;
  mesh: THREE.InstancedMesh;
  motes: Mote[];
  /** World box the motes fill (m). */
  min: THREE.Vector3;
  size: THREE.Vector3;
  /** Smoothed visibility: the gust's strength, or a faint stir during the warning. */
  shown: number;
}

let seed = 7;
const rnd = (): number => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

export class WindView {
  readonly group = new THREE.Group();
  private readonly zones: ZoneView[] = [];
  private readonly geometry = new THREE.BoxGeometry(0.025, 0.025, 1);
  private readonly material = new THREE.MeshBasicMaterial({
    color: '#d9d2c3',
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor(level: Level) {
    seed = 7;
    for (const def of defsOf(level).winds.values()) {
      // The height the wind fills: the zone's highest floor up to jumping height, or the whole shaft.
      let floor = Infinity;
      let ceil = -Infinity;
      for (let x = def.minX; x < def.maxX; x++)
        for (let z = def.minZ; z < def.maxZ; z++) {
          const s = level.sector(x, z);
          if (!s || s.wall) continue;
          floor = Math.min(floor, s.pit ? s.pitFloor : Math.max(...s.floor));
          ceil = Math.max(ceil, s.ceil);
        }
      if (!Number.isFinite(floor)) continue;
      const up = def.dir === 'up';
      const top = up ? Math.min(ceil, floor + 24) : Math.min(ceil, floor + 2.8);
      // Horizontal winds over a drop blow at the ledges' height, not down in the pit.
      let ledge = floor;
      if (!up)
        for (let x = def.minX; x < def.maxX; x++)
          for (let z = def.minZ; z < def.maxZ; z++) {
            const s = level.sector(x, z);
            if (s && !s.wall && !s.pit) ledge = Math.max(ledge, Math.max(...s.floor));
          }
      const bottom = up ? floor : ledge + 0.2;
      const min = new THREE.Vector3(def.minX * BLOCK, bottom, def.minZ * BLOCK);
      const size = new THREE.Vector3(
        (def.maxX - def.minX) * BLOCK,
        Math.max(1, (up ? top : ledge + 2.8) - bottom),
        (def.maxZ - def.minZ) * BLOCK,
      );
      const cells = (def.maxX - def.minX) * (def.maxZ - def.minZ);
      const count = Math.min(MAX_PER_ZONE, Math.max(12, cells * PER_CELL * (up ? 2 : 1)));
      const motes: Mote[] = [];
      for (let i = 0; i < count; i++)
        motes.push({
          u: rnd(),
          v: rnd(),
          w: rnd(),
          speed: 0.7 + rnd() * 0.6,
          length: 0.3 + rnd() * 0.9,
          leaf: rnd() < 0.08,
        });
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.zones.push({ def, mesh, motes, min, size, shown: 0 });
    }
  }

  update(world: World, dt: number): void {
    const states = world.state.mechanisms.winds;
    for (const z of this.zones) {
      const st = states.find((s) => s.id === z.def.id);
      if (!st) continue;
      const f = windFactor(z.def, st);
      const target = Math.max(f, st.phase === 'warn' ? 0.15 : 0);
      z.shown += (target - z.shown) * (1 - Math.exp(-dt * 6));
      z.mesh.visible = z.shown > 0.02;
      if (!z.mesh.visible) continue;
      const up = z.def.dir === 'up';
      const v = up ? { x: 0, z: 0 } : DIR_VEC[z.def.dir as 'N' | 'E' | 'S' | 'W'];
      // Along-axis length of the zone, in metres, to wrap the motes around.
      const span = up ? z.size.y : Math.abs(v.x) * z.size.x + Math.abs(v.z) * z.size.z;
      const speed = (up ? 6 : z.def.strength) * VISUAL_SPEED * Math.max(0.2, z.shown);
      this.quat.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        up ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(v.x, 0, v.z),
      );
      z.motes.forEach((m, i) => {
        m.w = (m.w + (speed * m.speed * dt) / span) % 1;
        // Position: across on two axes, along on the third.
        let x: number;
        let y: number;
        let zz: number;
        if (up) {
          x = z.min.x + m.u * z.size.x;
          zz = z.min.z + m.v * z.size.z;
          y = z.min.y + m.w * z.size.y;
        } else {
          const along = v.x + v.z > 0 ? m.w : 1 - m.w;
          x = z.min.x + (v.x !== 0 ? along : m.u) * z.size.x;
          zz = z.min.z + (v.z !== 0 ? along : m.u) * z.size.z;
          y = z.min.y + m.v * z.size.y + (m.leaf ? Math.sin((m.w + m.u) * 18) * 0.25 : 0);
        }
        // Streaks fade in and out at the zone's ends; leaves are short flecks.
        const edge = Math.min(1, m.w * 6, (1 - m.w) * 6);
        const len = (m.leaf ? 0.08 : m.length) * edge * z.shown;
        this.pos.set(x, y, zz);
        this.scale.set(m.leaf ? 4 : 1, m.leaf ? 2 : 1, Math.max(0.001, len));
        this.matrix.compose(this.pos, this.quat, this.scale);
        z.mesh.setMatrixAt(i, this.matrix);
      });
      z.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    for (const z of this.zones) z.mesh.dispose();
    this.group.removeFromParent();
  }
}

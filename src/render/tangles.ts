/**
 * Tangles of roots (spec §19, chamber V), stand-ins until the root kit
 * arrives (docs/art/models-brief.md). Each tangle is a thicket of pale roots
 * crossing its box from the rock around it (or rising from the floor when it
 * stands free); as the sim's `grown` falls they shrink back into the rock
 * they come from and thin out, and grow out again as
 * it rises. It reads the simulation every frame and never writes to it.
 */
import * as THREE from 'three/webgpu';
import type { Level } from '../sim/grid/level';
import { sectorTop } from '../sim/grid/level';
import { defsOf, type TangleDef } from '../sim/mechanisms/defs';
import { BLOCK } from '../sim/grid/units';
import type { World } from '../sim/world';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Strand {
  /** Pivot at the side it grows from; local +X runs into the tangle. */
  pivot: THREE.Group;
}

interface View {
  id: string;
  strands: Strand[];
  shown: number;
}

export class TangleViews {
  readonly group = new THREE.Group();
  private readonly views: View[] = [];
  private readonly mat = new THREE.MeshStandardMaterial({ color: '#8f7a52', roughness: 0.9 });
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(level: Level) {
    this.group.name = 'tangles';
    for (const def of defsOf(level).tangles.values()) this.views.push(this.build(level, def));
  }

  private build(level: Level, def: TangleDef): View {
    const r = rng(def.minX * 92821 + def.minZ * 68917 + def.id.length * 31);
    let bottom = Infinity;
    for (let x = def.minX; x < def.maxX; x++)
      for (let z = def.minZ; z < def.maxZ; z++) {
        const s = level.sector(x, z);
        if (s && !s.wall) bottom = Math.min(bottom, s.pit ? s.pitFloor : sectorTop(s));
      }
    if (!Number.isFinite(bottom)) bottom = def.top - 1;
    const x0 = def.minX * BLOCK;
    const x1 = def.maxX * BLOCK;
    const z0 = def.minZ * BLOCK;
    const z1 = def.maxZ * BLOCK;
    const cells = (def.maxX - def.minX) * (def.maxZ - def.minZ);
    const height = def.top - bottom;
    const count = Math.round(cells * Math.max(10, height * 12));
    const strands: Strand[] = [];
    const add = (pivot: THREE.Group, pts: THREE.Vector3[], radius: number): void => {
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, radius, 6, false);
      this.geometries.push(geo);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.castShadow = true;
      pivot.add(mesh);
      this.group.add(pivot);
      strands.push({ pivot });
    };
    // They grow from the rock around them: the sides with a wall (or higher floor) beyond.
    const solid = (cx: number, cz: number): boolean => {
      const n = level.sector(cx, cz);
      return !n || n.wall || sectorTop(n) >= def.top - 0.25;
    };
    const sideSolid = (side: number): boolean => {
      for (let k = side < 2 ? def.minZ : def.minX; k < (side < 2 ? def.maxZ : def.maxX); k++) {
        const cx = side === 0 ? def.minX - 1 : side === 1 ? def.maxX : k;
        const cz = side === 2 ? def.minZ - 1 : side === 3 ? def.maxZ : k;
        if (!solid(side < 2 ? cx : k, side < 2 ? k : cz)) return false;
      }
      return true;
    };
    const sides = [0, 1, 2, 3].filter(sideSolid);
    for (let i = 0; i < (sides.length > 0 ? count : 0); i++) {
      const side = sides[Math.floor(r() * sides.length)] ?? 0;
      const y = bottom + r() * height;
      const pivot = new THREE.Group();
      let span: number;
      if (side < 2) {
        pivot.position.set(side === 0 ? x0 : x1, y, z0 + r() * (z1 - z0));
        pivot.rotation.y = side === 0 ? 0 : Math.PI;
        span = x1 - x0;
      } else {
        pivot.position.set(x0 + r() * (x1 - x0), y, side === 2 ? z0 : z1);
        pivot.rotation.y = side === 2 ? -Math.PI / 2 : Math.PI / 2;
        span = z1 - z0;
      }
      // Across the box, slanting up or down and wandering sideways, kept inside it.
      const len = span * (0.7 + r() * 0.4);
      const rise = (r() - 0.5) * Math.min(2.4, height);
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 4; k++) {
        const u = k / 4;
        const py = Math.min(def.top - y - 0.05, Math.max(bottom - y + 0.05, rise * u + (r() - 0.5) * 0.3));
        pts.push(new THREE.Vector3(u * len, py, (r() - 0.5) * 0.8 * u));
      }
      add(pivot, pts, 0.04 + r() * 0.06);
    }
    // Thick roots from the floor up through it, which shrink down into the ground.
    const trunks = Math.round(cells * (sides.length > 0 ? 3 : 3 + Math.max(6, height * 5)));
    for (let i = 0; i < trunks; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(x0 + (0.15 + r() * 0.7) * (x1 - x0), bottom, z0 + (0.15 + r() * 0.7) * (z1 - z0));
      pivot.rotation.z = Math.PI / 2;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 4; k++)
        pts.push(new THREE.Vector3((k / 4) * height, (r() - 0.5) * 0.4, (r() - 0.5) * 0.4));
      add(pivot, pts, 0.08 + r() * 0.06);
    }
    return { id: def.id, strands, shown: -1 };
  }

  update(world: World, dt: number): void {
    for (const v of this.views) {
      const st = world.state.mechanisms.tangles.find((t) => t.id === v.id);
      const target = st ? st.grown : 1;
      // Ease toward the sim so a quick shrink still reads as roots pulling back.
      const k = v.shown < 0 ? 1 : 1 - Math.exp(-dt * 10);
      const g = v.shown < 0 ? target : v.shown + (target - v.shown) * k;
      if (Math.abs(g - v.shown) < 1e-4) continue;
      v.shown = g;
      const along = 0.08 + 0.92 * g;
      const thick = 0.45 + 0.55 * g;
      for (const s of v.strands) {
        s.pivot.scale.set(along, thick, thick);
        s.pivot.visible = along > 0.1;
      }
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.mat.dispose();
  }
}

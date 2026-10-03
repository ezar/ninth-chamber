/**
 * High-contrast mode (spec §13 "Accesibilidad"): a bright, unlit strip along
 * every grabbable lip (sim/grid/edges.ts), so ledges read against a detailed
 * scene. One merged mesh per room, placed in that room's culling group.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Level } from '../sim/grid/level';
import { grabEdges } from '../sim/grid/edges';

const WIDTH = 0.06;
const HEIGHT = 0.03;

export class GrabEdgeView {
  readonly meshes: THREE.Mesh[] = [];
  // Over-bright and saturated, so the room's colour grade cannot wash it out.
  private readonly material = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffb800').multiplyScalar(1.8),
    fog: false,
    toneMapped: false,
  });

  constructor(level: Level, place: (o: THREE.Object3D, room: string) => void) {
    const byRoom = new Map<string, THREE.BufferGeometry[]>();
    for (const e of grabEdges(level)) {
      const len = Math.hypot(e.x2 - e.x1, e.z2 - e.z1);
      const along = e.x1 !== e.x2;
      const g = new THREE.BoxGeometry(along ? len : WIDTH, HEIGHT, along ? WIDTH : len);
      // On the lip's top, just inside the edge, a hair above the floor.
      g.translate(
        (e.x1 + e.x2) / 2 - e.nx * WIDTH * 0.5,
        e.y + HEIGHT / 2 + 0.005,
        (e.z1 + e.z2) / 2 - e.nz * WIDTH * 0.5,
      );
      const list = byRoom.get(e.room) ?? [];
      list.push(g);
      byRoom.set(e.room, list);
    }
    for (const [room, geos] of byRoom) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const m = new THREE.Mesh(merged, this.material);
      m.name = `grab-edges:${room}`;
      m.visible = false;
      m.castShadow = false;
      m.receiveShadow = false;
      place(m, room);
      this.meshes.push(m);
    }
  }

  setVisible(on: boolean): void {
    for (const m of this.meshes) m.visible = on;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.material.dispose();
  }
}

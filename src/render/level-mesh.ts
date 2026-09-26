/**
 * Builds the static level geometry from the sector grid (spec §11 "La
 * rejilla es invisible"): floors, walls, ceilings and ledge lips, merged per
 * material. Wall surfaces are displaced by up to 4 cm and darkened near
 * corners (baked vertex AO) so the grid does not read as cubes.
 */
import * as THREE from 'three/webgpu';
import type { Level, Sector } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';

export type Surface = 'wall' | 'floorStone' | 'floorSand' | 'ceiling' | 'lip';

class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, ao: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(ao, ao, ao);
    return this.pos.length / 3 - 1;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Smooth hash noise in 3D for surface displacement (render only). */
function noise3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 1.7 + y * 3.1 + z * 2.3) * 0.5 + Math.sin(x * 4.3 - z * 3.7 + y * 1.3) * 0.3;
  return s + Math.sin(x * 9.1 + y * 7.7 - z * 8.3) * 0.2;
}

export interface LevelMeshes {
  surfaces: Record<Surface, THREE.BufferGeometry>;
  /** Cells that are sky holes in the ceiling, per room. */
  skylights: { x: number; z: number; ceil: number }[];
}

/**
 * Options: `skylightRooms` lists rooms whose ceiling gets an opening around its
 * centre (rooms lit by a sun shaft).
 */
export function buildLevelMeshes(level: Level, opts: { skylightRooms: ReadonlySet<string> }): LevelMeshes {
  const b: Record<Surface, Builder> = {
    wall: new Builder(),
    floorStone: new Builder(),
    floorSand: new Builder(),
    ceiling: new Builder(),
    lip: new Builder(),
  };
  const sector = (cx: number, cz: number): Sector | undefined => level.sector(cx, cz);
  /** Visible floor of a sector: collapsing tiles are drawn separately, over their pit. */
  const floorTop = (s: Sector): number => (s.flags.has('crumble') ? s.pitFloor : Math.max(...s.floor));
  const solid = (s: Sector | undefined): boolean => !s || s.wall;

  const skyCells = new Set<string>();
  const skylights: LevelMeshes['skylights'] = [];
  for (const room of level.rooms) {
    if (!opts.skylightRooms.has(room.id)) continue;
    const cx = Math.floor((room.minX + room.maxX) / 2);
    const cz = Math.floor((room.minZ + room.maxZ) / 2);
    for (const [dx, dz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const s = sector(cx + dx, cz + dz);
      if (s && !s.wall) {
        skyCells.add(`${cx + dx},${cz + dz}`);
        skylights.push({ x: (cx + dx) * BLOCK + 1, z: (cz + dz) * BLOCK + 1, ceil: s.ceil });
      }
    }
  }

  // Corner AO for floors: darker where walls or higher floors surround the corner.
  const cornerAo = (cx: number, cz: number, y: number, ix: number, iz: number): number => {
    let occ = 0;
    for (const [dx, dz] of [
      [ix - 1, iz - 1],
      [ix, iz - 1],
      [ix - 1, iz],
      [ix, iz],
    ] as const) {
      const n = sector(cx + dx, cz + dz);
      if (solid(n) || (n && floorTop(n) > y + 0.4)) occ++;
    }
    return 1 - occ * 0.14;
  };

  for (const s of level.allSectors()) {
    if (s.wall) continue;
    const x0 = s.cx * BLOCK;
    const z0 = s.cz * BLOCK;
    const top = floorTop(s);
    const sloped = !s.flags.has('crumble') && new Set(s.floor).size > 1;

    // Floor: a 4 × 4 grid per sector so corner AO has room to fade.
    const fb = s.mat === 'sand' ? b.floorSand : b.floorStone;
    const N = 4;
    const base = fb.pos.length / 3;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const v = j / N;
        const x = x0 + u * BLOCK;
        const z = z0 + v * BLOCK;
        const y = sloped
          ? level.floorAt(Math.min(x, x0 + BLOCK - 1e-4), Math.min(z, z0 + BLOCK - 1e-4))
          : top;
        const a00 = cornerAo(s.cx, s.cz, top, 0, 0);
        const a10 = cornerAo(s.cx, s.cz, top, 1, 0);
        const a01 = cornerAo(s.cx, s.cz, top, 0, 1);
        const a11 = cornerAo(s.cx, s.cz, top, 1, 1);
        const ao = (a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v;
        const edgeFade = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 6 + 0.55);
        fb.vertex(
          new THREE.Vector3(x, y, z),
          new THREE.Vector3(0, 1, 0),
          x / BLOCK,
          z / BLOCK,
          ao * (0.85 + 0.15 * edgeFade),
        );
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i;
        fb.idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
      }
    }
    if (sloped) {
      // Recompute normals for sloped sectors later via computeVertexNormals on the whole set is costly; approximate.
      const [nw, ne, , sw] = s.floor;
      const n = new THREE.Vector3(-(ne - nw) / BLOCK, 1, -(sw - nw) / BLOCK).normalize();
      for (let k = base; k < fb.pos.length / 3; k++) {
        fb.nor[k * 3] = n.x;
        fb.nor[k * 3 + 1] = n.y;
        fb.nor[k * 3 + 2] = n.z;
      }
    }

    // Ceiling.
    if (!skyCells.has(`${s.cx},${s.cz}`)) {
      const cb = b.ceiling;
      const c0 = cb.pos.length / 3;
      const y = s.ceil;
      const n = new THREE.Vector3(0, -1, 0);
      cb.vertex(new THREE.Vector3(x0, y, z0), n, x0 / BLOCK, z0 / BLOCK, 0.8);
      cb.vertex(new THREE.Vector3(x0 + BLOCK, y, z0), n, (x0 + BLOCK) / BLOCK, z0 / BLOCK, 0.8);
      cb.vertex(new THREE.Vector3(x0, y, z0 + BLOCK), n, x0 / BLOCK, (z0 + BLOCK) / BLOCK, 0.8);
      cb.vertex(
        new THREE.Vector3(x0 + BLOCK, y, z0 + BLOCK),
        n,
        (x0 + BLOCK) / BLOCK,
        (z0 + BLOCK) / BLOCK,
        0.8,
      );
      cb.idx.push(c0, c0 + 1, c0 + 2, c0 + 1, c0 + 3, c0 + 2);
    }

    // Walls: this sector draws the faces of its neighbours that rise above its floor.
    const sides = [
      { dx: 0, dz: -1, a: [x0 + BLOCK, z0], b: [x0, z0], n: [0, 1] },
      { dx: 1, dz: 0, a: [x0 + BLOCK, z0 + BLOCK], b: [x0 + BLOCK, z0], n: [-1, 0] },
      { dx: 0, dz: 1, a: [x0, z0 + BLOCK], b: [x0 + BLOCK, z0 + BLOCK], n: [0, -1] },
      { dx: -1, dz: 0, a: [x0, z0], b: [x0, z0 + BLOCK], n: [1, 0] },
    ] as const;
    for (const side of sides) {
      const nb = sector(s.cx + side.dx, s.cz + side.dz);
      const bottom = top;
      let upper: number;
      if (solid(nb)) upper = s.ceil;
      else if (nb) upper = Math.min(floorTop(nb), s.ceil);
      else upper = s.ceil;
      if (upper > bottom + 1e-3) {
        wallQuad(b.wall, side.a, side.b, bottom, upper, side.n);
        // A grabbable ledge gets a pale, hand-polished lip (legibility, art bible).
        if (nb && !solid(nb) && upper < s.ceil - 0.5 && upper - bottom >= 0.75)
          lip(b.lip, side.a, side.b, upper, side.n);
      }
      // Ceiling steps: where the neighbour's ceiling is lower, close the gap.
      if (nb && !solid(nb) && nb.ceil < s.ceil - 1e-3) {
        wallQuad(b.wall, side.a, side.b, Math.max(nb.ceil, top), s.ceil, side.n);
      }
    }
  }

  return {
    surfaces: {
      wall: b.wall.geometry(),
      floorStone: b.floorStone.geometry(),
      floorSand: b.floorSand.geometry(),
      ceiling: b.ceiling.geometry(),
      lip: b.lip.geometry(),
    },
    skylights,
  };
}

/**
 * A vertical wall face from a to b (in XZ) between two heights, subdivided
 * every 0.5 m and displaced along its normal on interior vertices only, so
 * neighbouring faces still meet without cracks.
 */
function wallQuad(
  wb: Builder,
  a: readonly [number, number],
  bb: readonly [number, number],
  y0: number,
  y1: number,
  n: readonly [number, number],
): void {
  const cols = 4;
  const rows = Math.max(1, Math.round((y1 - y0) / 0.5));
  const normal = new THREE.Vector3(n[0], 0, n[1]);
  const base = wb.pos.length / 3;
  const along = Math.abs(bb[0] - a[0]) > 0 ? 'x' : 'z';
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const v = j / rows;
      const x = a[0] + (bb[0] - a[0]) * u;
      const z = a[1] + (bb[1] - a[1]) * u;
      const y = y0 + (y1 - y0) * v;
      const interior = i > 0 && i < cols && j > 0 && j < rows;
      const d = interior ? noise3(x, y, z) * 0.035 : 0;
      const p = new THREE.Vector3(x + normal.x * d, y, z + normal.z * d);
      // Baked AO: darker at the foot of the wall and under the ceiling.
      const foot = Math.min(1, (y - y0) / 0.9);
      const ao = 0.62 + 0.38 * foot;
      const uCoord = (along === 'x' ? x : z) / BLOCK;
      wb.vertex(p, normal, uCoord, y / BLOCK, ao);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const q = base + j * (cols + 1) + i;
      wb.idx.push(q, q + cols + 1, q + 1, q + 1, q + cols + 1, q + cols + 2);
    }
  }
}

/** A worn stone lip along a ledge edge: 6 cm proud of the face, 10 cm tall, bevelled. */
function lip(
  lb: Builder,
  a: readonly [number, number],
  bb: readonly [number, number],
  y: number,
  n: readonly [number, number],
): void {
  const out = 0.06;
  const h = 0.1;
  const nx = n[0];
  const nz = n[1];
  const p = (x: number, yy: number, z: number): THREE.Vector3 => new THREE.Vector3(x, yy, z);
  const ax = a[0];
  const az = a[1];
  const bx = bb[0];
  const bz = bb[1];
  const base = lb.pos.length / 3;
  const front = new THREE.Vector3(nx, 0, nz);
  const up = new THREE.Vector3(nx * 0.4, 1, nz * 0.4).normalize();
  const len = Math.hypot(bx - ax, bz - az) / BLOCK;
  // Front face.
  lb.vertex(p(ax + nx * out, y - h, az + nz * out), front, 0, 0, 0.85);
  lb.vertex(p(bx + nx * out, y - h, bz + nz * out), front, len, 0, 0.85);
  lb.vertex(p(ax + nx * out, y - 0.02, az + nz * out), front, 0, 0.05, 1);
  lb.vertex(p(bx + nx * out, y - 0.02, bz + nz * out), front, len, 0.05, 1);
  lb.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  // Bevelled top, sloping back onto the ledge.
  const t = lb.pos.length / 3;
  lb.vertex(p(ax + nx * out, y - 0.02, az + nz * out), up, 0, 0, 1);
  lb.vertex(p(bx + nx * out, y - 0.02, bz + nz * out), up, len, 0, 1);
  lb.vertex(p(ax - nx * 0.08, y + 0.005, az - nz * 0.08), up, 0, 0.07, 1);
  lb.vertex(p(bx - nx * 0.08, y + 0.005, bz - nz * 0.08), up, len, 0.07, 1);
  lb.idx.push(t, t + 2, t + 1, t + 1, t + 2, t + 3);
  // Underside.
  const u = lb.pos.length / 3;
  const down = new THREE.Vector3(0, -1, 0);
  lb.vertex(p(ax, y - h, az), down, 0, 0, 0.6);
  lb.vertex(p(bx, y - h, bz), down, len, 0, 0.6);
  lb.vertex(p(ax + nx * out, y - h, az + nz * out), down, 0, 0.03, 0.6);
  lb.vertex(p(bx + nx * out, y - h, bz + nz * out), down, len, 0.03, 0.6);
  lb.idx.push(u, u + 2, u + 1, u + 1, u + 2, u + 3);
}

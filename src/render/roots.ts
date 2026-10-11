/**
 * Roots on climbable faces (spec §11 "Legibilidad intacta": walls you can
 * climb show cracks and roots; §19 chamber V). Every face marked `climb<D>`
 * gets a lattice of pale roots: wandering vertical runners with crossing
 * tendrils, clearly lighter than the stone so it reads as climbable. Behind
 * them, once loaded, the Meshy root panel (root_kit.glb) covers each face in
 * two-metre tiles, one instanced mesh for the level.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Level, Sector } from '../sim/grid/level';
import type { SectorFlag } from '../sim/grid/schema';
import { BLOCK, DIR_VEC, DIR_YAW, DIRS, type Dir } from '../sim/grid/units';
import { fitCopy } from './static-models';

const FLAG: Record<Dir, SectorFlag> = { N: 'climbN', E: 'climbE', S: 'climbS', W: 'climbW' };

/** Small deterministic generator, so the roots look the same in every run and every shot. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const top = (s: Sector): number => (s.wall ? s.ceil : Math.min(Math.max(...s.floor), s.ceil));
const bottom = (s: Sector | undefined): number =>
  !s || s.wall ? Infinity : s.pit ? s.pitFloor : Math.min(...s.floor);

/** Every climbable face: its sector, the way it looks, and the span of wall it covers. */
function climbFaces(level: Level): { s: Sector; d: Dir; y0: number; y1: number }[] {
  const faces: { s: Sector; d: Dir; y0: number; y1: number }[] = [];
  for (const s of level.allSectors()) {
    for (const d of DIRS) {
      if (!s.flags.has(FLAG[d])) continue;
      const v = DIR_VEC[d];
      const front = level.sector(s.cx + v.x, s.cz + v.z);
      const y0 = bottom(front);
      const y1 = Math.min(top(s), front ? front.ceil : top(s));
      if (y1 - y0 > 0.3) faces.push({ s, d, y0, y1 });
    }
  }
  return faces;
}

export function rootFaces(level: Level): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const { s, d, y0, y1 } of climbFaces(level)) face(parts, s, d, y0, y1);
  if (parts.length === 0) return null;
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const mat = new THREE.MeshStandardMaterial({ color: '#9a8458', roughness: 0.92 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'root-faces';
  return mesh;
}

/** The roots of one face: runners from bottom to top and tendrils across. */
function face(out: THREE.BufferGeometry[], s: Sector, d: Dir, y0: number, y1: number): void {
  const v = DIR_VEC[d];
  const r = rng(s.cx * 7349 + s.cz * 1913 + d.charCodeAt(0) * 31);
  // The face plane, and the axis along it.
  const along = { x: Math.abs(v.z), z: Math.abs(v.x) };
  const ox = v.x > 0 ? (s.cx + 1) * BLOCK : s.cx * BLOCK;
  const oz = v.z > 0 ? (s.cz + 1) * BLOCK : s.cz * BLOCK;
  const at = (u: number, y: number, out: number): THREE.Vector3 =>
    new THREE.Vector3(ox + along.x * u + v.x * out, y, oz + along.z * u + v.z * out);

  const runners = 4;
  for (let i = 0; i < runners; i++) {
    const u0 = ((i + 0.3 + r() * 0.4) / runners) * BLOCK;
    const pts: THREE.Vector3[] = [];
    const steps = Math.max(3, Math.ceil((y1 - y0) / 0.5));
    let u = u0;
    for (let k = 0; k <= steps; k++) {
      u = Math.min(BLOCK - 0.08, Math.max(0.08, u + (r() - 0.5) * 0.22));
      pts.push(at(u, y0 + ((y1 - y0) * k) / steps, 0.04 + r() * 0.03));
    }
    const radius = 0.035 + r() * 0.025;
    out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps * 4, radius, 5, false));
  }
  // Tendrils across, every half metre or so: the handholds.
  for (let y = y0 + 0.4 + r() * 0.2; y < y1 - 0.3; y += 0.5 + r() * 0.25) {
    // Each one slants and sags a little, from a random side.
    const a = r() * 0.7;
    const b = BLOCK - r() * 0.7;
    const tilt = (r() - 0.5) * 0.6;
    const flip = r() < 0.5;
    const pts = [
      at(flip ? b : a, y - tilt, 0.05),
      at((a + b) / 2 + (r() - 0.5) * 0.3, y - 0.08 - r() * 0.1, 0.09),
      at(flip ? a : b, y + tilt, 0.05),
    ];
    out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.025 + r() * 0.012, 4, false));
  }
}

/** The root panel's depth as laid on a face (m): thin, behind the runners. */
const PANEL_DEPTH = 0.06;

/**
 * The Meshy root panel tiled over every climbable face, two metres at a time (the last
 * tile of a face squashed to fit), as one instanced mesh; null when there are no faces.
 */
export function rootPanels(level: Level, model: THREE.Object3D): THREE.InstancedMesh | null {
  const faces = climbFaces(level);
  // One fitted tile, baked into a geometry: a 2 m square facing -Z, centred, thin.
  const { root, materials } = fitCopy(model, { width: BLOCK, origin: 'centre' });
  root.updateMatrixWorld(true);
  let tile: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !tile) tile = o;
  });
  const mesh = tile as THREE.Mesh | null;
  const material = materials[0];
  if (!mesh || !material || faces.length === 0) return null;
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const size = geo.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(BLOCK, BLOCK, 1);
  const unitH = size.y;
  const depthScale = PANEL_DEPTH / Math.max(1e-6, size.z);
  const mats: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const { s, d, y0, y1 } of faces) {
    const v = DIR_VEC[d];
    // The face plane's middle, a hair out from the wall towards the side you climb from.
    const cx = v.x > 0 ? (s.cx + 1) * BLOCK : v.x < 0 ? s.cx * BLOCK : s.cx * BLOCK + BLOCK / 2;
    const cz = v.z > 0 ? (s.cz + 1) * BLOCK : v.z < 0 ? s.cz * BLOCK : s.cz * BLOCK + BLOCK / 2;
    const out = PANEL_DEPTH / 2 + 0.005;
    q.setFromAxisAngle(up, DIR_YAW[d]);
    for (let y = y0; y < y1 - 0.05; y += unitH) {
      const h = Math.min(unitH, y1 - y);
      mats.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(cx + v.x * out, y + h / 2, cz + v.z * out),
          q,
          new THREE.Vector3(1, h / unitH, depthScale),
        ),
      );
    }
  }
  const inst = new THREE.InstancedMesh(geo, material, mats.length);
  mats.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingBox();
  inst.computeBoundingSphere();
  inst.receiveShadow = true;
  inst.name = 'root-panels';
  return inst;
}

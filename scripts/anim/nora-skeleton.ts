/** Nora's scanned skeleton (public/models/nora.glb) for the offline animation tools. */
import { join } from 'node:path';
import * as THREE from 'three/webgpu';
import { JOINTS, ScanSkeleton, type BindJoint } from '../../src/render/anim/skeleton';
import type { RetargetJoint } from '../../src/render/nora';
import { Gltf, worldMatrices } from './gltf';

export const REPO = join(import.meta.dirname, '..', '..');

export function loadSkeleton(path = join(REPO, 'public', 'models', 'nora.glb')): ScanSkeleton {
  const g = new Gltf(path);
  const ms = worldMatrices(g, g.restPose());
  const bind = {} as Record<RetargetJoint, BindJoint>;
  for (const j of JOINTS) {
    const m = ms[g.nodeIndex(j)];
    if (!m) throw new Error(`nora.glb: no bone ${j}`);
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    m.decompose(pos, rot, new THREE.Vector3());
    bind[j] = { pos, rot };
  }
  return new ScanSkeleton(bind);
}

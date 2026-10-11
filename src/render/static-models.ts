/**
 * Static Meshy models (props, relics, statues: docs/art/meshy-prompts.md),
 * fitted with `pnpm models:fit`. Each file loads once and is shared; views
 * take fitted copies and keep their procedural stand-ins until a copy
 * arrives, or for good if the file is missing.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ktx2 } from './ktx2';

const cache = new Map<string, Promise<THREE.Object3D | null>>();

/** Loads a model by name from public/models (once; null when missing or broken). */
export function loadStaticModel(name: string): Promise<THREE.Object3D | null> {
  let p = cache.get(name);
  if (!p) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const k = ktx2();
    if (k) loader.setKTX2Loader(k);
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
      .then((gltf) => gltf.scene as THREE.Object3D)
      .catch(() => null);
    cache.set(name, p);
  }
  return p;
}

export interface Fit {
  /** Height (m) of the copy; its width and depth follow. */
  height?: number;
  /** Instead of the height: its widest horizontal extent (m), to keep it inside a cell. */
  width?: number;
  /** Where the copy's origin goes: the middle of its footprint on the floor, or its centre. */
  origin: 'bottom' | 'centre';
}

/**
 * A copy of a loaded model, scaled and centred as asked, turned to face -Z
 * (glTF models face +Z), with its own materials (the geometry stays shared).
 */
export function fitCopy(
  model: THREE.Object3D,
  fit: Fit,
): { root: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
  const inner = model.clone(true);
  const materials: THREE.MeshStandardMaterial[] = [];
  inner.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = o.receiveShadow = true;
    if (o.material instanceof THREE.MeshStandardMaterial) {
      o.material = o.material.clone();
      materials.push(o.material);
    }
  });
  inner.rotation.y = Math.PI;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const s =
    fit.width !== undefined
      ? fit.width / Math.max(1e-6, size.x, size.z)
      : (fit.height ?? 1) / Math.max(1e-6, size.y);
  inner.scale.multiplyScalar(s);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
  inner.position.set(-c.x, fit.origin === 'bottom' ? -box.min.y * s : -c.y, -c.z);
  const root = new THREE.Group();
  root.add(inner);
  return { root, materials };
}

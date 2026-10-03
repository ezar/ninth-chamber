/**
 * One shared KTX2 loader (Basis Universal textures, see scripts/textures/ktx2.ts).
 * It transcodes each texture in a worker into what the GPU can sample while
 * compressed (ASTC on phones, BC on desktops, ETC2 elsewhere), or to plain
 * RGBA where none is supported. The renderer sets it up once it has started.
 */
import type * as THREE from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

let shared: KTX2Loader | null = null;

/** Prepares the loader for this renderer's GPU (call after renderer.init()). */
export function setupKtx2(renderer: THREE.WebGPURenderer): KTX2Loader {
  shared ??= new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).setWorkerLimit(2);
  shared.detectSupport(renderer);
  return shared;
}

/** The loader, once setupKtx2 has run (null before). */
export function ktx2(): KTX2Loader | null {
  return shared;
}

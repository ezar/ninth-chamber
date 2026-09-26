/**
 * Surface materials. Scanned CC0 textures (public/textures, see sources.json)
 * are preferred; the procedural ones in textures.ts are the fallback when a
 * file is missing or fails to load.
 */
import * as THREE from 'three/webgpu';
import { BLOCK } from '../sim/grid/units';
import { ashlar, flagstones, rock, sand, type PbrSet } from './textures';

export interface SurfaceSet extends PbrSet {
  /** Ambient occlusion (R), roughness (G) and metalness (B) in one map, when scanned. */
  armMap: THREE.Texture | null;
}

export type SurfaceName = 'wall' | 'floor' | 'block' | 'sand' | 'ceiling';

/** Real-world size (m) covered by one repeat of each scanned texture. */
const SCANNED_SIZE: Record<SurfaceName, number> = {
  wall: 3,
  floor: 3,
  block: 2,
  sand: 3,
  ceiling: 3,
};

function procedural(name: SurfaceName): PbrSet {
  switch (name) {
    case 'wall':
      return ashlar({ base: '#b8895a', courses: 4, seed: 11 });
    case 'floor':
      return flagstones({ base: '#b09a7c', slabs: 2, seed: 5 });
    case 'block':
      return flagstones({ base: '#d8c7a8', slabs: 1, seed: 17 });
    case 'sand':
      return sand({ base: '#c8a77c' });
    case 'ceiling':
      return rock({ base: '#6d5a47' });
  }
}

async function loadScanned(name: SurfaceName, loader: THREE.TextureLoader): Promise<SurfaceSet> {
  const base = `${import.meta.env.BASE_URL}textures/${name}/`;
  const [map, normalMap, armMap] = await Promise.all([
    loader.loadAsync(`${base}albedo.jpg`),
    loader.loadAsync(`${base}normal.jpg`),
    loader.loadAsync(`${base}arm.jpg`),
  ]);
  // Level UVs run one unit per 2 m block; scale so the scan keeps its real size.
  const r = BLOCK / SCANNED_SIZE[name];
  for (const t of [map, normalMap, armMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(r, r);
    t.anisotropy = 8;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap, roughnessMap: armMap, armMap };
}

export async function loadSurfaces(): Promise<Record<SurfaceName, SurfaceSet>> {
  const loader = new THREE.TextureLoader();
  const names: SurfaceName[] = ['wall', 'floor', 'block', 'sand', 'ceiling'];
  const sets = await Promise.all(
    names.map(async (n): Promise<SurfaceSet> => {
      try {
        return await loadScanned(n, loader);
      } catch {
        return { ...procedural(n), armMap: null };
      }
    }),
  );
  return Object.fromEntries(names.map((n, i) => [n, sets[i]])) as Record<SurfaceName, SurfaceSet>;
}

/** Standard material parameters for a surface set. */
export function surfaceParams(s: SurfaceSet): THREE.MeshStandardMaterialParameters {
  return s.armMap
    ? {
        map: s.map,
        normalMap: s.normalMap,
        roughnessMap: s.armMap,
        metalnessMap: s.armMap,
        aoMap: s.armMap,
        metalness: 1,
      }
    : { map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap };
}

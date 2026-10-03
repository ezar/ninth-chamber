/**
 * Surface materials. Scanned CC0 textures (art/textures, see sources.json),
 * shipped as KTX2 in public/textures, are preferred; the procedural ones in
 * textures.ts are the fallback when a file is missing or fails to load.
 */
import * as THREE from 'three/webgpu';
import { BLOCK } from '../sim/grid/units';
import { ktx2 } from './ktx2';
import { ashlar, flagstones, rock, sand, type PbrSet } from './textures';

export interface SurfaceSet extends PbrSet {
  /** Ambient occlusion (R), roughness (G) and metalness (B) in one map, when scanned. */
  armMap: THREE.Texture | null;
  /** Normal map strength (1 = as scanned). */
  normalStrength: number;
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

/**
 * Softening of the scans, which read harsh and grainy on phone screens: the
 * normal maps' relief is toned down, most on the busiest surfaces (floor and
 * sand). The albedo is softened when the KTX2 files are made
 * (scripts/textures/ktx2.ts, SURFACE_SOFTEN).
 */
const NORMAL_STRENGTH: Record<SurfaceName, number> = {
  wall: 0.8,
  floor: 0.7,
  block: 0.85,
  sand: 0.65,
  ceiling: 0.85,
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

async function loadScanned(name: SurfaceName): Promise<SurfaceSet> {
  const loader = ktx2();
  if (!loader) throw new Error('KTX2 loader not set up');
  const base = `${import.meta.env.BASE_URL}textures/${name}/`;
  const [map, normalMap, armMap] = await Promise.all([
    loader.loadAsync(`${base}albedo.ktx2`),
    loader.loadAsync(`${base}normal.ktx2`),
    loader.loadAsync(`${base}arm.ktx2`),
  ]);
  // Level UVs run one unit per 2 m block; scale so the scan keeps its real size.
  const r = BLOCK / SCANNED_SIZE[name];
  for (const t of [map, normalMap, armMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(r, r);
    t.anisotropy = 8;
  }
  // The albedo file is tagged sRGB, the others linear; the loader reads it from the file.
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap, roughnessMap: armMap, armMap, normalStrength: NORMAL_STRENGTH[name] };
}

export async function loadSurfaces(): Promise<Record<SurfaceName, SurfaceSet>> {
  const names: SurfaceName[] = ['wall', 'floor', 'block', 'sand', 'ceiling'];
  const sets = await Promise.all(
    names.map(async (n): Promise<SurfaceSet> => {
      try {
        return await loadScanned(n);
      } catch {
        return { ...procedural(n), armMap: null, normalStrength: NORMAL_STRENGTH[n] };
      }
    }),
  );
  return Object.fromEntries(names.map((n, i) => [n, sets[i]])) as Record<SurfaceName, SurfaceSet>;
}

/** Standard material parameters for a surface set. */
export function surfaceParams(s: SurfaceSet): THREE.MeshStandardMaterialParameters {
  const normalScale = new THREE.Vector2(s.normalStrength, s.normalStrength);
  return s.armMap
    ? {
        map: s.map,
        normalMap: s.normalMap,
        normalScale,
        roughnessMap: s.armMap,
        metalnessMap: s.armMap,
        aoMap: s.armMap,
        metalness: 1,
      }
    : { map: s.map, normalMap: s.normalMap, normalScale, roughnessMap: s.roughnessMap };
}

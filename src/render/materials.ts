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
 * albedo moves part of the way towards the texture's mean colour (lower
 * contrast and saturation in the blotches, joints and cracks still readable
 * up close) and the normal maps' relief is toned down. The busiest surfaces,
 * floor and sand, get the most.
 */
const SOFTEN: Record<SurfaceName, { albedo: number; normal: number }> = {
  wall: { albedo: 0.18, normal: 0.8 },
  floor: { albedo: 0.24, normal: 0.7 },
  block: { albedo: 0.12, normal: 0.85 },
  sand: { albedo: 0.28, normal: 0.65 },
  ceiling: { albedo: 0.15, normal: 0.85 },
};

/**
 * The albedo lerped by `k` towards its own mean colour, drawn on a canvas (a
 * translucent fill over the image, so no per-pixel work on the CPU). Returns
 * the texture unchanged where there is no canvas or the image is not drawable.
 */
export function softenAlbedo(tex: THREE.Texture, k: number): THREE.Texture {
  const img = tex.image as (CanvasImageSource & { width?: number; height?: number }) | null;
  const width = img?.width ?? 0;
  const height = img?.height ?? 0;
  if (!img || !width || !height || k <= 0 || typeof document === 'undefined') return tex;
  try {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 16;
    const pg = probe.getContext('2d', { willReadFrequently: true });
    if (!pg) return tex;
    pg.drawImage(img, 0, 0, 16, 16);
    const px = pg.getImageData(0, 0, 16, 16).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i] ?? 0;
      g += px[i + 1] ?? 0;
      b += px[i + 2] ?? 0;
    }
    const n = px.length / 4;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const cg = canvas.getContext('2d');
    if (!cg) return tex;
    cg.drawImage(img, 0, 0);
    cg.globalAlpha = k;
    cg.fillStyle = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
    cg.fillRect(0, 0, width, height);
    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = tex.colorSpace;
    out.wrapS = tex.wrapS;
    out.wrapT = tex.wrapT;
    out.repeat.copy(tex.repeat);
    out.anisotropy = tex.anisotropy;
    out.minFilter = THREE.LinearMipmapLinearFilter;
    out.generateMipmaps = true;
    out.name = tex.name;
    tex.dispose();
    return out;
  } catch {
    // A tainted or undecodable image: keep the scan as it is.
    return tex;
  }
}

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
  const soft = SOFTEN[name];
  return {
    map: softenAlbedo(map, soft.albedo),
    normalMap,
    roughnessMap: armMap,
    armMap,
    normalStrength: soft.normal,
  };
}

export async function loadSurfaces(): Promise<Record<SurfaceName, SurfaceSet>> {
  const loader = new THREE.TextureLoader();
  const names: SurfaceName[] = ['wall', 'floor', 'block', 'sand', 'ceiling'];
  const sets = await Promise.all(
    names.map(async (n): Promise<SurfaceSet> => {
      try {
        return await loadScanned(n, loader);
      } catch {
        return { ...procedural(n), armMap: null, normalStrength: SOFTEN[n].normal };
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

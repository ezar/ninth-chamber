/**
 * Per-room lighting "looks" from art/looks/*.json (spec §11 "Guion de color y
 * luz"), blended smoothly as the player moves between rooms.
 */
import * as THREE from 'three/webgpu';

export interface LookFile {
  id: string;
  background: string;
  exposure: number;
  hemi: { sky: string; ground: string; intensity: number };
  fog: { color: string; density: number };
  sun: { color: string; intensity: number; direction: [number, number, number] } | null;
  fire: { color: string; intensity: number; flicker: number };
  bloom: { strength: number; radius: number; threshold: number };
  grade: { tint: string; saturation: number; contrast: number; vignette: number };
  /** Scale on the baked bounce light while in this room (default 1): a room gone dark dims what was baked with its fires. */
  lightmap?: number;
  /**
   * Scale on the soft light that follows Nora (default 1). Dark rooms with no
   * fire of their own (the Temple's boulder run) raise it so she and the floor
   * around her read.
   */
  fill?: number;
  /** Rooms with water: its colours, caustics and the fog under the surface (render/water.ts). */
  water?: {
    deep: string;
    tint: string;
    sky: string;
    caustics: number;
    fog: { color: string; density: number };
  };
  /** A night look: the starfield is drawn beyond the openings (the Observatory). */
  stars?: boolean;
  /** Architectural dressing: a gilded frieze round the walls (height above the floor, m) and painted relief panels. */
  trim?: { friezeHeight?: number; reliefs?: boolean };
}

/** A look with colours parsed, ready to blend. */
export interface Look {
  background: THREE.Color;
  exposure: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fogColor: THREE.Color;
  fogDensity: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunDir: THREE.Vector3;
  fireColor: THREE.Color;
  fireIntensity: number;
  flicker: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  tint: THREE.Color;
  saturation: number;
  contrast: number;
  vignette: number;
  lightmap: number;
  fill: number;
}

const files = import.meta.glob<LookFile>('../../art/looks/*.json', { eager: true, import: 'default' });

const DEFAULT: LookFile = {
  id: 'default',
  background: '#0e0c0a',
  exposure: 1,
  hemi: { sky: '#6f7f8f', ground: '#2a1f17', intensity: 0.4 },
  fog: { color: '#2a1f17', density: 0.03 },
  sun: null,
  fire: { color: '#ff9448', intensity: 30, flicker: 0.25 },
  bloom: { strength: 0.5, radius: 0.5, threshold: 0.8 },
  grade: { tint: '#ffffff', saturation: 1, contrast: 1.05, vignette: 0.35 },
};

export function parseLook(f: LookFile): Look {
  const c = (h: string): THREE.Color => new THREE.Color(h);
  return {
    background: c(f.background),
    exposure: f.exposure,
    hemiSky: c(f.hemi.sky),
    hemiGround: c(f.hemi.ground),
    hemiIntensity: f.hemi.intensity,
    fogColor: c(f.fog.color),
    fogDensity: f.fog.density,
    sunColor: c(f.sun?.color ?? '#ffffff'),
    sunIntensity: f.sun?.intensity ?? 0,
    sunDir: new THREE.Vector3(...(f.sun?.direction ?? [0, 1, 0])).normalize(),
    fireColor: c(f.fire.color),
    fireIntensity: f.fire.intensity,
    flicker: f.fire.flicker,
    bloomStrength: f.bloom.strength,
    bloomRadius: f.bloom.radius,
    bloomThreshold: f.bloom.threshold,
    tint: c(f.grade.tint),
    saturation: f.grade.saturation,
    contrast: f.grade.contrast,
    vignette: f.grade.vignette,
    lightmap: f.lightmap ?? 1,
    fill: f.fill ?? 1,
  };
}

const looks = new Map<string, Look>();
for (const f of Object.values(files)) looks.set(f.id, parseLook(f));

export function getLook(id: string | null): Look {
  return (id && looks.get(id)) || parseLook(DEFAULT);
}

export function lookFile(id: string | null): LookFile | undefined {
  return Object.values(files).find((f) => f.id === id);
}

/** Moves `out` towards `to` by factor k (0..1). */
export function blendLook(out: Look, to: Look, k: number): void {
  const n = (a: number, b: number): number => a + (b - a) * k;
  out.background.lerp(to.background, k);
  out.exposure = n(out.exposure, to.exposure);
  out.hemiSky.lerp(to.hemiSky, k);
  out.hemiGround.lerp(to.hemiGround, k);
  out.hemiIntensity = n(out.hemiIntensity, to.hemiIntensity);
  out.fogColor.lerp(to.fogColor, k);
  out.fogDensity = n(out.fogDensity, to.fogDensity);
  out.sunColor.lerp(to.sunColor, k);
  out.sunIntensity = n(out.sunIntensity, to.sunIntensity);
  if (to.sunIntensity > 0) out.sunDir.lerp(to.sunDir, k).normalize();
  out.fireColor.lerp(to.fireColor, k);
  out.fireIntensity = n(out.fireIntensity, to.fireIntensity);
  out.flicker = n(out.flicker, to.flicker);
  out.bloomStrength = n(out.bloomStrength, to.bloomStrength);
  out.bloomRadius = n(out.bloomRadius, to.bloomRadius);
  out.bloomThreshold = n(out.bloomThreshold, to.bloomThreshold);
  out.tint.lerp(to.tint, k);
  out.saturation = n(out.saturation, to.saturation);
  out.contrast = n(out.contrast, to.contrast);
  out.vignette = n(out.vignette, to.vignette);
  out.lightmap = n(out.lightmap, to.lightmap);
  out.fill = n(out.fill, to.fill);
}

export function cloneLook(l: Look): Look {
  return {
    ...l,
    background: l.background.clone(),
    hemiSky: l.hemiSky.clone(),
    hemiGround: l.hemiGround.clone(),
    fogColor: l.fogColor.clone(),
    sunColor: l.sunColor.clone(),
    sunDir: l.sunDir.clone(),
    fireColor: l.fireColor.clone(),
    tint: l.tint.clone(),
  };
}

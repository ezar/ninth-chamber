/**
 * Player settings (spec §13 "Menús"), kept in localStorage. Storage may be
 * missing or throw (private mode, blocked cookies): every access is guarded
 * and the game runs on defaults.
 */
import {
  isQualityTier,
  isResolutionMode,
  isTextureFiltering,
  type QualityTier,
  type ResolutionMode,
  type TextureFiltering,
} from '../render/quality';

export type Language = 'en' | 'es';

/** Options → Renderer. Both draw on the GPU; 'auto' is WebGPU where available. */
export type RendererChoice = 'auto' | 'webgpu' | 'webgl2';
export const RENDERER_CHOICES: readonly RendererChoice[] = ['auto', 'webgpu', 'webgl2'];

export interface Settings {
  /** Layout version, for migrating what older builds stored. */
  version: number;
  /** Null until the first-run benchmark (or the player) picks one. */
  quality: QualityTier | null;
  /** 'auto': picked by detection, may be lowered when frames stay slow. 'user': chosen in options. */
  qualitySource: 'auto' | 'user';
  /** Phones: the pixel ratio the first-run benchmark allowed (null until measured). */
  mobilePixelRatio: number | null;
  /** Applied at startup; changing it reloads the game. */
  renderer: RendererChoice;
  resolution: ResolutionMode;
  textureFiltering: TextureFiltering;
  /** Null follows the tier (off on phones). */
  filmGrain: boolean | null;
  /** Null: on whenever the image is drawn below the screen's own resolution. */
  sharpen: boolean | null;
  /** Renderer, frame rate and resolution readout in the corner. */
  showStats: boolean;
  /** Linear volumes 0..1. */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  /** Multiplier on the default camera sensitivity (0.25..2). */
  cameraSensitivity: number;
  invertY: boolean;
  reducedMotion: boolean;
  /** Placeholder until captions exist (spec §13 "Accesibilidad"). */
  subtitles: boolean;
  /** Null follows the browser. */
  language: Language | null;
}

export const SETTINGS_KEY = 'nc.settings';
export const SETTINGS_VERSION = 3;

export const SENSITIVITY_RANGE = { min: 0.25, max: 2, step: 0.25 } as const;

export function defaultSettings(prefersReducedMotion = false): Settings {
  return {
    version: SETTINGS_VERSION,
    quality: null,
    qualitySource: 'auto',
    mobilePixelRatio: null,
    renderer: 'auto',
    resolution: 'auto',
    textureFiltering: 'auto',
    filmGrain: null,
    sharpen: null,
    showStats: false,
    masterVolume: 0.8,
    musicVolume: 0.8,
    sfxVolume: 0.9,
    cameraSensitivity: 1,
    invertY: false,
    reducedMotion: prefersReducedMotion,
    subtitles: false,
    language: null,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const optionalBool = (v: unknown, fallback: boolean | null): boolean | null =>
  typeof v === 'boolean' || v === null ? v : fallback;

/**
 * Brings what an older build stored up to date. Version 1 (no `version`
 * field) sent phones straight to a 1.25 pixel-ratio mobile tier without
 * measuring them: an automatically chosen mobile tier is forgotten so the
 * new first-run benchmark can measure the phone once. `desktop` says the
 * device is a computer (see version 3 below).
 */
export function migrateSettings(raw: Record<string, unknown>, desktop = false): Record<string, unknown> {
  const out = { ...raw };
  const version = typeof out.version === 'number' ? out.version : 1;
  const autoMobile = out.quality === 'mobile' && out.qualitySource !== 'user';
  if (version < 2 && autoMobile) out.quality = null;
  // Version 3: computers stop at the medium tier on their own; one that an
  // earlier build lowered to mobile by itself (a slow first run, a stall of
  // errors) is measured again.
  if (version < 3 && desktop && autoMobile) out.quality = null;
  out.version = SETTINGS_VERSION;
  return out;
}

/** Reads settings, falling back field by field to the defaults on anything invalid. */
export function loadSettings(
  storage: StorageLike | null,
  defaults = defaultSettings(),
  /** The device is a computer: an automatic mobile tier from older builds is measured again. */
  desktop = false,
): Settings {
  let raw: unknown;
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...defaults };
  const r = migrateSettings(raw as Record<string, unknown>, desktop);
  return {
    version: SETTINGS_VERSION,
    quality: isQualityTier(r.quality) ? r.quality : defaults.quality,
    qualitySource: r.qualitySource === 'user' ? 'user' : 'auto',
    mobilePixelRatio:
      typeof r.mobilePixelRatio === 'number' && Number.isFinite(r.mobilePixelRatio)
        ? Math.min(3, Math.max(1, r.mobilePixelRatio))
        : defaults.mobilePixelRatio,
    renderer: RENDERER_CHOICES.includes(r.renderer as RendererChoice)
      ? (r.renderer as RendererChoice)
      : defaults.renderer,
    resolution: isResolutionMode(r.resolution) ? r.resolution : defaults.resolution,
    textureFiltering: isTextureFiltering(r.textureFiltering) ? r.textureFiltering : defaults.textureFiltering,
    filmGrain: optionalBool(r.filmGrain, defaults.filmGrain),
    sharpen: optionalBool(r.sharpen, defaults.sharpen),
    showStats: bool(r.showStats, defaults.showStats),
    masterVolume: clamp(r.masterVolume, 0, 1, defaults.masterVolume),
    musicVolume: clamp(r.musicVolume, 0, 1, defaults.musicVolume),
    sfxVolume: clamp(r.sfxVolume, 0, 1, defaults.sfxVolume),
    cameraSensitivity: clamp(
      r.cameraSensitivity,
      SENSITIVITY_RANGE.min,
      SENSITIVITY_RANGE.max,
      defaults.cameraSensitivity,
    ),
    invertY: bool(r.invertY, defaults.invertY),
    reducedMotion: bool(r.reducedMotion, defaults.reducedMotion),
    subtitles: bool(r.subtitles, defaults.subtitles),
    language: r.language === 'en' || r.language === 'es' ? r.language : defaults.language,
  };
}

/** Writes settings; returns false when storage is unavailable or full. */
export function saveSettings(storage: StorageLike | null, s: Settings): boolean {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
    return storage !== null;
  } catch {
    return false;
  }
}

/** window.localStorage, or null where touching it throws. */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

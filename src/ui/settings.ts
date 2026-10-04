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
import { noOverrides, sanitizeBindings, type BindingOverrides } from '../core/bindings';
import { CAPTION_SIZES, type CaptionSize } from './captions';

export type Language = 'en' | 'es' | 'ca';
export const LANGUAGES: readonly Language[] = ['en', 'es', 'ca'];

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
  /** Captions for the sounds that matter (spec §13 "Accesibilidad"). */
  subtitles: boolean;
  subtitleSize: CaptionSize;
  /** An arrow at the screen edge when a trap arms. */
  trapCues: boolean;
  /** Action and Walk: held down, or pressed once to latch and again to let go. */
  actionMode: HoldMode;
  walkMode: HoldMode;
  /** 1 or 0.75: the simulation's wall clock (stats count ticks, so they are not penalized). */
  gameSpeed: number;
  /** Grabbable edges drawn with a bright line. */
  highContrast: boolean;
  /** Health and poison drawn in a palette safe for colour blindness, with patterns. */
  colourSafe: boolean;
  /** Touch buttons: scale 0.8..1.4 and opacity 0.3..1. */
  touchSize: number;
  touchOpacity: number;
  /** Where the player moved each touch button: an offset in px from its own place. */
  touchLayout: TouchLayout;
  /** Tips on how to play (Nora's remarks about each chamber always show). */
  tutorialHints: boolean;
  /** Null follows the browser. */
  language: Language | null;
  /** The player's key and gamepad bindings over the defaults (core/bindings.ts). */
  bindings: BindingOverrides;
}

export type HoldMode = 'hold' | 'toggle';
/** The touch buttons the player can move (index.html, data-button inside #touch). */
export const TOUCH_BUTTONS = ['jump', 'action', 'walk', 'fire', 'weapons', 'torch'] as const;
export type TouchButton = (typeof TOUCH_BUTTONS)[number];
export type TouchLayout = Partial<Record<TouchButton, [number, number]>>;
/** No button is moved further than this (px) from its place. */
export const TOUCH_OFFSET_MAX = 2000;
export const GAME_SPEEDS: readonly number[] = [1, 0.75];
export const TOUCH_SIZE_RANGE = { min: 0.8, max: 1.4, step: 0.1 } as const;
export const TOUCH_OPACITY_RANGE = { min: 0.3, max: 1, step: 0.1 } as const;

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
    subtitleSize: 'medium',
    trapCues: true,
    actionMode: 'hold',
    walkMode: 'hold',
    gameSpeed: 1,
    highContrast: false,
    colourSafe: false,
    touchSize: 1,
    touchOpacity: 1,
    touchLayout: {},
    tutorialHints: true,
    language: null,
    bindings: noOverrides(),
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const holdMode = (v: unknown, fallback: HoldMode): HoldMode =>
  v === 'hold' || v === 'toggle' ? v : fallback;
function touchLayout(v: unknown): TouchLayout {
  const out: TouchLayout = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const b of TOUCH_BUTTONS) {
    const o = (v as Record<string, unknown>)[b];
    if (!Array.isArray(o) || o.length !== 2) continue;
    const [x, y] = o as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
      continue;
    const c = (n: number): number => Math.round(Math.min(TOUCH_OFFSET_MAX, Math.max(-TOUCH_OFFSET_MAX, n)));
    out[b] = [c(x), c(y)];
  }
  return out;
}
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
    subtitleSize: CAPTION_SIZES.includes(r.subtitleSize as CaptionSize)
      ? (r.subtitleSize as CaptionSize)
      : defaults.subtitleSize,
    trapCues: bool(r.trapCues, defaults.trapCues),
    actionMode: holdMode(r.actionMode, defaults.actionMode),
    walkMode: holdMode(r.walkMode, defaults.walkMode),
    gameSpeed: GAME_SPEEDS.includes(r.gameSpeed as number) ? (r.gameSpeed as number) : defaults.gameSpeed,
    highContrast: bool(r.highContrast, defaults.highContrast),
    colourSafe: bool(r.colourSafe, defaults.colourSafe),
    touchSize: clamp(r.touchSize, TOUCH_SIZE_RANGE.min, TOUCH_SIZE_RANGE.max, defaults.touchSize),
    touchOpacity: clamp(
      r.touchOpacity,
      TOUCH_OPACITY_RANGE.min,
      TOUCH_OPACITY_RANGE.max,
      defaults.touchOpacity,
    ),
    touchLayout: r.touchLayout === undefined ? defaults.touchLayout : touchLayout(r.touchLayout),
    tutorialHints: bool(r.tutorialHints, defaults.tutorialHints),
    language: LANGUAGES.includes(r.language as Language) ? (r.language as Language) : defaults.language,
    bindings: r.bindings === undefined ? defaults.bindings : sanitizeBindings(r.bindings),
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

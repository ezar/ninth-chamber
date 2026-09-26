/**
 * Player settings (spec §13 "Menús"), kept in localStorage. Storage may be
 * missing or throw (private mode, blocked cookies): every access is guarded
 * and the game runs on defaults.
 */
import { isQualityTier, type QualityTier } from '../render/quality';

export type Language = 'en' | 'es';

export interface Settings {
  /** Null until the first-run benchmark (or the player) picks one. */
  quality: QualityTier | null;
  /** 'auto': picked by detection, may be lowered when frames stay slow. 'user': chosen in options. */
  qualitySource: 'auto' | 'user';
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

export const SENSITIVITY_RANGE = { min: 0.25, max: 2, step: 0.25 } as const;

export function defaultSettings(prefersReducedMotion = false): Settings {
  return {
    quality: null,
    qualitySource: 'auto',
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

/** Reads settings, falling back field by field to the defaults on anything invalid. */
export function loadSettings(storage: StorageLike | null, defaults = defaultSettings()): Settings {
  let raw: unknown;
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  if (typeof raw !== 'object' || raw === null) return { ...defaults };
  const r = raw as Record<string, unknown>;
  return {
    quality: isQualityTier(r.quality) ? r.quality : defaults.quality,
    qualitySource: r.qualitySource === 'user' ? 'user' : 'auto',
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

import { describe, expect, it } from 'vitest';
import {
  SETTINGS_KEY,
  SETTINGS_VERSION,
  defaultSettings,
  loadSettings,
  migrateSettings,
  saveSettings,
} from '../src/ui/settings';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('settings', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const s = defaultSettings();
    s.quality = 'medium';
    s.qualitySource = 'user';
    s.musicVolume = 0.3;
    s.invertY = true;
    s.language = 'es';
    expect(saveSettings(storage, s)).toBe(true);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('falls back to defaults field by field on bad data', () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        quality: 'ultra',
        masterVolume: 7,
        sfxVolume: 'loud',
        cameraSensitivity: 0.01,
        invertY: 'yes',
        language: 'fr',
      }),
    });
    const s = loadSettings(storage);
    const d = defaultSettings();
    expect(s.quality).toBeNull();
    expect(s.masterVolume).toBe(1);
    expect(s.sfxVolume).toBe(d.sfxVolume);
    expect(s.cameraSensitivity).toBe(0.25);
    expect(s.invertY).toBe(false);
    expect(s.language).toBeNull();
  });

  it('survives storage that throws or holds garbage', () => {
    expect(loadSettings(throwing)).toEqual(defaultSettings());
    expect(saveSettings(throwing, defaultSettings())).toBe(false);
    expect(saveSettings(null, defaultSettings())).toBe(false);
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: '{not json' }))).toEqual(defaultSettings());
  });

  it('starts with reduced motion when the system asks for it', () => {
    expect(loadSettings(memoryStorage(), defaultSettings(true)).reducedMotion).toBe(true);
  });

  it('defaults the graphics options to automatic', () => {
    const d = defaultSettings();
    expect(d.version).toBe(SETTINGS_VERSION);
    expect(d.renderer).toBe('auto');
    expect(d.resolution).toBe('auto');
    expect(d.textureFiltering).toBe('auto');
    expect(d.filmGrain).toBeNull();
    expect(d.sharpen).toBeNull();
    expect(d.showStats).toBe(false);
    expect(d.mobilePixelRatio).toBeNull();
  });

  it('round-trips the graphics options and rejects invalid ones', () => {
    const storage = memoryStorage();
    const s = defaultSettings();
    s.renderer = 'webgl2';
    s.resolution = '75';
    s.textureFiltering = 'max';
    s.filmGrain = false;
    s.sharpen = true;
    s.showStats = true;
    s.mobilePixelRatio = 1.75;
    saveSettings(storage, s);
    expect(loadSettings(storage)).toEqual(s);

    const bad = loadSettings(
      memoryStorage({
        [SETTINGS_KEY]: JSON.stringify({
          version: 2,
          renderer: 'vulkan',
          resolution: '33',
          textureFiltering: 'ultra',
          filmGrain: 'yes',
          sharpen: 1,
          mobilePixelRatio: 9,
        }),
      }),
    );
    expect(bad.renderer).toBe('auto');
    expect(bad.resolution).toBe('auto');
    expect(bad.textureFiltering).toBe('auto');
    expect(bad.filmGrain).toBeNull();
    expect(bad.sharpen).toBeNull();
    expect(bad.mobilePixelRatio).toBe(3);
  });
});

describe('settings migration', () => {
  /** What builds before the graphics options stored (no version field). */
  const v1 = (extra: Record<string, unknown>): Record<string, string> => ({
    [SETTINGS_KEY]: JSON.stringify({
      quality: 'mobile',
      qualitySource: 'auto',
      masterVolume: 0.5,
      invertY: true,
      language: 'es',
      ...extra,
    }),
  });

  it('keeps the old fields and fills the new ones with defaults', () => {
    const s = loadSettings(memoryStorage(v1({ quality: 'high' })));
    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.quality).toBe('high');
    expect(s.masterVolume).toBe(0.5);
    expect(s.invertY).toBe(true);
    expect(s.language).toBe('es');
    expect(s.renderer).toBe('auto');
    expect(s.resolution).toBe('auto');
    expect(s.filmGrain).toBeNull();
  });

  it('forgets an automatically chosen mobile tier so the phone is measured again', () => {
    expect(loadSettings(memoryStorage(v1({}))).quality).toBeNull();
  });

  it('keeps a mobile tier the player chose', () => {
    expect(loadSettings(memoryStorage(v1({ qualitySource: 'user' }))).quality).toBe('mobile');
  });

  it('measures again a computer an older build lowered to mobile by itself', () => {
    const stored = {
      [SETTINGS_KEY]: JSON.stringify({ quality: 'mobile', qualitySource: 'auto', version: 2 }),
    };
    expect(loadSettings(memoryStorage(stored), defaultSettings(), true).quality).toBeNull();
    // A phone keeps its measured mobile tier, and a computer keeps one the player chose.
    expect(loadSettings(memoryStorage(stored), defaultSettings(), false).quality).toBe('mobile');
    const chosen = {
      [SETTINGS_KEY]: JSON.stringify({ quality: 'mobile', qualitySource: 'user', version: 2 }),
    };
    expect(loadSettings(memoryStorage(chosen), defaultSettings(), true).quality).toBe('mobile');
  });

  it('does not migrate twice', () => {
    const migrated = migrateSettings({ quality: 'mobile', qualitySource: 'auto', version: 2 });
    expect(migrated.quality).toBe('mobile');
    expect(migrateSettings({ quality: 'mobile' }).version).toBe(SETTINGS_VERSION);
  });
});

import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY, defaultSettings, loadSettings, saveSettings } from '../src/ui/settings';

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
});

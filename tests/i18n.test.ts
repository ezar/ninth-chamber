import { describe, expect, it } from 'vitest';
import { availableLocales, localeKeys, pickLocale } from '../src/ui/i18n';

describe('i18n', () => {
  it('every locale has the same keys as English', () => {
    const reference = localeKeys('en');
    for (const locale of availableLocales()) expect(localeKeys(locale)).toEqual(reference);
  });

  it('picks the first supported language and falls back to English', () => {
    expect(pickLocale(['es-ES', 'en'])).toBe('es');
    expect(pickLocale(['fr-FR', 'en-GB'])).toBe('en');
    expect(pickLocale(['fr'])).toBe('en');
    expect(pickLocale(['ca-ES', 'es-ES'])).toBe('ca');
  });
});

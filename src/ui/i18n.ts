/**
 * Player-facing strings live in i18n/*.json (spec §13 "Localización").
 * English is the reference locale; every other locale must have the same keys.
 */
import en from '../../i18n/en.json';
import es from '../../i18n/es.json';

export type StringKey = keyof typeof en;
type Strings = Record<StringKey, string>;

const locales: Record<string, Strings> = { en, es };

export function pickLocale(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const lang = tag.toLowerCase().split('-')[0] ?? '';
    if (lang in locales) return lang;
  }
  return 'en';
}

let current: Strings = en;
let currentName = 'en';

export function setLocale(locale: string): void {
  current = locales[locale] ?? en;
  currentName = locale in locales ? locale : 'en';
  document.documentElement.lang = currentName;
}

export const currentLocale = (): string => currentName;

/** Translates `key`, replacing `{name}` placeholders with `params`. */
export function t(key: StringKey, params: Record<string, string | number> = {}): string {
  return current[key].replace(/\{(\w+)\}/g, (m, name: string) => String(params[name] ?? m));
}

/** Whether `key` is a known string (ids built at run time, such as `item.<id>`). */
export const isStringKey = (key: string): key is StringKey => key in en;

/** Fills every element carrying a data-i18n (text) or data-i18n-label (aria-label) attribute. */
export function applyStaticStrings(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as StringKey);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel as StringKey));
  }
  document.title = t('title');
}

export const localeKeys = (locale: string): string[] => Object.keys(locales[locale] ?? {}).sort();
export const availableLocales = (): string[] => Object.keys(locales);

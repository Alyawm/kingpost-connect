/**
 * Localisation scaffold. Strings used by the newer interface parts go through `t()`,
 * which looks them up in the active locale and falls back to the key's English text.
 * Adding a language means adding a JSON file next to `en.json` and registering it here;
 * the older panels still carry English text inline and move over as they are touched.
 */
import en from '../locales/en.json';

type Dictionary = Record<string, string>;

const locales: Record<string, Dictionary> = { en };
let active = 'en';

export function setLocale(code: string): void {
  if (locales[code]) active = code;
}

export function locale(): string {
  return active;
}

/** Looks up `key`; `{name}` placeholders are filled from `values`. */
export function t(key: string, values?: Record<string, string | number>): string {
  const text = locales[active]?.[key] ?? locales.en?.[key] ?? key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

export function availableLocales(): string[] {
  return Object.keys(locales);
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export type Locale = 'en' | 'it' | 'es' | 'fr' | 'de' | 'pt';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'it', 'es', 'fr', 'de', 'pt'];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  it: 'Italiano',
  es: 'Espa\u00f1ol',
  fr: 'Fran\u00e7ais',
  de: 'Deutsch',
  pt: 'Portugu\u00eas',
};

const translations = new Map<Locale, Record<string, string>>();

export function loadTranslations(): void {
  for (const locale of SUPPORTED_LOCALES) {
    const filePath = join(__dirname, 'locales', `${locale}.json`);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      translations.set(locale, flattenObject(data));
    } catch {
      if (locale === 'en') throw new Error(`Missing required locale file: ${filePath}`);
    }
  }
}

export function t(key: string, locale: Locale = 'en', params?: Record<string, string>): string {
  const dict = translations.get(locale) ?? translations.get('en')!;
  let value = dict[key] ?? translations.get('en')![key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{{${k}}}`, v);
    }
  }
  return value;
}

export function getLocaleData(locale: Locale): Record<string, string> {
  return translations.get(locale) ?? translations.get('en')!;
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

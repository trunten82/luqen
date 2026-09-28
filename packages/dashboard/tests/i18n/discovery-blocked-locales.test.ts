import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCALES_DIR = join(__dirname, '..', '..', 'src', 'i18n', 'locales');

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt'] as const;
const KEYS = ['reportDetail.discoveryBlocked', 'scanProgress.discoveryBlocked'] as const;

function loadLocale(locale: string): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')) as Record<string, Record<string, string>>;
}

const enDict = loadLocale('en');

function getKeyValue(dict: Record<string, Record<string, string>>, dottedKey: string): string | undefined {
  const [section, key] = dottedKey.split('.');
  return dict[section]?.[key];
}

const PAGES_PLACEHOLDER = ['{{', 'pages', '}}'].join('');
const PAGES_SINGLE_BRACE = ['{', 'pages', '}'].join('');

describe('discovery-blocked locale coverage (WAF-SURFACE-1)', () => {
  for (const locale of LOCALES) {
    it(`${locale} defines both discovery-blocked strings with one pages placeholder`, () => {
      const dict = loadLocale(locale);
      for (const key of KEYS) {
        const value = getKeyValue(dict, key);
        expect(value, `${locale}: missing ${key}`).toBeDefined();
        expect(typeof value).toBe('string');
        const str = value as string;
        const occurrences = str.split(PAGES_PLACEHOLDER).length - 1;
        expect(occurrences, `${locale}: ${key} placeholder count`).toBe(1);
        // No single-brace variant (a stray '{pages}' rather than '{{pages}}').
        const withoutDouble = str.split(PAGES_PLACEHOLDER).join('');
        expect(withoutDouble.includes(PAGES_SINGLE_BRACE), `${locale}: ${key} single-brace variant`).toBe(false);

        if (locale !== 'en') {
          const enValue = getKeyValue(enDict, key);
          expect(str, `${locale}: ${key} must differ from en`).not.toBe(enValue);
        }
      }
    });
  }
});

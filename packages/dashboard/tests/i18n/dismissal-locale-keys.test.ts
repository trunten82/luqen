import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTranslations, t } from '../../src/i18n/index.js';

// Phase 88 Plan 13: the locale keys Plans 05 (Dismissed sheet) and 06 (ACR
// disclosure) consume. The REAL loader is used on purpose: a mock of
// i18n/index.js would let a missing key pass.

const DISCLOSURE_ONE_EN = '1 automated finding was dismissed as a false positive after review.';
const DISCLOSURE_OTHER_EN = '{{count}} automated findings were dismissed as false positives after review.';

beforeAll(() => {
  loadTranslations();
});

describe('dismissal disclosure resolves through the real loader (tracer)', () => {
  it('t() resolves the Italian plural disclosure through loadTranslations', () => {
    const it_ = t('acr.dismissedDisclosureOther', 'it', { count: '3' });
    const en = t('acr.dismissedDisclosureOther', 'en', { count: '3' });
    expect(it_).not.toBe('acr.dismissedDisclosureOther');
    expect(it_).toContain('3');
    expect(it_.includes('{{')).toBe(false);
    expect(it_).not.toBe(en);
  });

  it('the English disclosure strings are the exact D-09 wording', () => {
    expect(t('acr.dismissedDisclosureOne', 'en')).toBe(DISCLOSURE_ONE_EN);
    expect(t('acr.dismissedDisclosureOther', 'en', { count: '5' })).toBe(
      DISCLOSURE_OTHER_EN.replace('{{count}}', '5'),
    );
  });
});

// ---------------------------------------------------------------------------
// Full coverage: all six locales, both ACR disclosure keys and the Dismissed
// sheet keys (D-12, D-18). Locale files are read directly, as the
// discovery-blocked precedent does, so the dotted-key shape is checked too.
// ---------------------------------------------------------------------------

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt'] as const;
const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'i18n', 'locales');

const ACR_KEYS = ['acr.dismissedDisclosureOne', 'acr.dismissedDisclosureOther'] as const;
const SHEET_NAME_KEY = 'dismissalsExport.sheetName';
const COLUMN_KEYS = [
  'dismissalsExport.colPageUrl',
  'dismissalsExport.colRuleCode',
  'dismissalsExport.colSelector',
  'dismissalsExport.colLevel',
  'dismissalsExport.colReason',
  'dismissalsExport.colDismissedBy',
  'dismissalsExport.colDismissedAt',
] as const;
const ALL_KEYS = [...ACR_KEYS, SHEET_NAME_KEY, ...COLUMN_KEYS] as const;

// Built from parts so this file never contains the literal token (the
// discovery-blocked test does the same).
const COUNT_PLACEHOLDER = ['{{', 'count', '}}'].join('');
const ANY_PLACEHOLDER = /\{\{([^}]*)\}\}/g;

type Dict = Record<string, unknown>;

function loadLocale(locale: string): Dict {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')) as Dict;
}

function lookup(dict: Dict, dottedKey: string): string | undefined {
  const [section, key] = dottedKey.split('.');
  const node = dict[section];
  if (node === null || typeof node !== 'object') return undefined;
  const value = (node as Dict)[key];
  return typeof value === 'string' ? value : undefined;
}

function expectUsable(locale: string, key: string, value: string | undefined): string {
  expect(value, `${locale}: missing ${key}`).toBeDefined();
  const str = value as string;
  expect(str.trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0);
  expect(str, `${locale}: ${key} is the key id`).not.toBe(key);
  return str;
}

describe('ACR dismissal disclosure locale coverage (D-09, D-12)', () => {
  for (const locale of LOCALES) {
    it(`${locale} defines both ACR dismissal disclosure keys with one count placeholder in the plural`, () => {
      const dict = loadLocale(locale);
      const one = expectUsable(locale, ACR_KEYS[0], lookup(dict, ACR_KEYS[0]));
      const other = expectUsable(locale, ACR_KEYS[1], lookup(dict, ACR_KEYS[1]));
      expect(other.split(COUNT_PLACEHOLDER).length - 1, `${locale}: plural placeholder count`).toBe(1);
      expect(one.includes('{{'), `${locale}: singular must carry no placeholder`).toBe(false);
      if (locale !== 'en') {
        expect(one, `${locale}: singular must differ from en`).not.toBe(lookup(loadLocale('en'), ACR_KEYS[0]));
        expect(other, `${locale}: plural must differ from en`).not.toBe(lookup(loadLocale('en'), ACR_KEYS[1]));
      }
    });
  }
});

describe('Dismissed sheet locale coverage (D-18)', () => {
  for (const locale of LOCALES) {
    it(`${locale} defines the Dismissed-sheet name and seven column headers`, () => {
      const dict = loadLocale(locale);
      expect(COLUMN_KEYS.length).toBe(7);
      for (const key of [SHEET_NAME_KEY, ...COLUMN_KEYS]) {
        expectUsable(locale, key, lookup(dict, key));
      }
    });
  }

  for (const locale of LOCALES) {
    it(`${locale} Dismissed-sheet name is a legal, distinct worksheet name`, () => {
      const name = expectUsable(locale, SHEET_NAME_KEY, lookup(loadLocale(locale), SHEET_NAME_KEY));
      expect(name.length, `${locale}: 1-31 chars`).toBeGreaterThanOrEqual(1);
      expect(name.length, `${locale}: 1-31 chars`).toBeLessThanOrEqual(31);
      expect(/[*?:/\\[\]]/.test(name), `${locale}: illegal character`).toBe(false);
      expect(/(^')|('$)/.test(name), `${locale}: leading/trailing apostrophe`).toBe(false);
      expect(name, `${locale}: protected name`).not.toBe('History');
      expect(name.toLowerCase(), `${locale}: collides with the Issues sheet`).not.toBe('issues');
    });
  }

  it('the English Dismissed-sheet strings are the exact D-18 wording', () => {
    const en = loadLocale('en');
    expect([SHEET_NAME_KEY, ...COLUMN_KEYS].map((k) => lookup(en, k))).toEqual([
      'Dismissed',
      'Page URL',
      'Rule Code',
      'Selector',
      'Level',
      'Reason',
      'Dismissed By',
      'Dismissed At',
    ]);
  });
});

describe('dismissal strings are placeholder-safe (P2)', () => {
  it('dismissal strings carry no placeholder other than count', () => {
    let seen = 0;
    for (const locale of LOCALES) {
      const dict = loadLocale(locale);
      for (const key of ALL_KEYS) {
        const str = expectUsable(locale, key, lookup(dict, key));
        for (const match of str.matchAll(ANY_PLACEHOLDER)) {
          seen += 1;
          expect(match[1], `${locale}: ${key} carries placeholder ${match[0]}`).toBe('count');
        }
        expect(/\{[^{]|[^}]\}/.test(str.replaceAll(COUNT_PLACEHOLDER, '')), `${locale}: ${key} stray brace`).toBe(false);
      }
    }
    // Positive control: the whitelist loop must have actually met the six plural placeholders.
    expect(seen).toBe(LOCALES.length);
  });
});

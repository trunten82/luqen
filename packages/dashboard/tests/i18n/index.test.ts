import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock fs before importing the module
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import type { Locale } from '../../src/i18n/index.js';

const mockedReadFileSync = vi.mocked(readFileSync);

// We re-import the module per test group via dynamic import,
// but for the exports that are plain constants we can import statically.
// For functions that depend on mutable module state (translations map),
// we need to handle carefully.

describe('i18n', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------
  describe('SUPPORTED_LOCALES', () => {
    it('contains all six supported locales', async () => {
      const mod = await import('../../src/i18n/index.js');
      expect(mod.SUPPORTED_LOCALES).toEqual(['en', 'it', 'es', 'fr', 'de', 'pt']);
    });

    it('is an array with exactly six entries', async () => {
      const mod = await import('../../src/i18n/index.js');
      expect(Array.isArray(mod.SUPPORTED_LOCALES)).toBe(true);
      expect(mod.SUPPORTED_LOCALES).toHaveLength(6);
    });
  });

  describe('LOCALE_LABELS', () => {
    it('maps each locale to its native label', async () => {
      const mod = await import('../../src/i18n/index.js');
      expect(mod.LOCALE_LABELS.en).toBe('English');
      expect(mod.LOCALE_LABELS.it).toBe('Italiano');
      expect(mod.LOCALE_LABELS.es).toBe('Español');
      expect(mod.LOCALE_LABELS.fr).toBe('Français');
      expect(mod.LOCALE_LABELS.de).toBe('Deutsch');
      expect(mod.LOCALE_LABELS.pt).toBe('Português');
    });

    it('has an entry for every supported locale', async () => {
      const mod = await import('../../src/i18n/index.js');
      for (const locale of mod.SUPPORTED_LOCALES) {
        expect(mod.LOCALE_LABELS[locale]).toBeDefined();
        expect(typeof mod.LOCALE_LABELS[locale]).toBe('string');
      }
    });
  });

  // -------------------------------------------------------------------------
  // loadTranslations
  // -------------------------------------------------------------------------
  describe('loadTranslations', () => {
    it('loads and flattens JSON files for all locales', async () => {
      const enData = JSON.stringify({ common: { save: 'Save', cancel: 'Cancel' } });
      const itData = JSON.stringify({ common: { save: 'Salva', cancel: 'Annulla' } });

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.endsWith('en.json')) return enData;
        if (p.endsWith('it.json')) return itData;
        throw new Error('File not found');
      });

      const mod = await import('../../src/i18n/index.js');
      mod.loadTranslations();

      // en should be loaded
      expect(mod.t('common.save', 'en')).toBe('Save');
      expect(mod.t('common.cancel', 'en')).toBe('Cancel');

      // it should be loaded
      expect(mod.t('common.save', 'it')).toBe('Salva');
    });

    it('throws when the English locale file is missing', async () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const mod = await import('../../src/i18n/index.js');
      expect(() => mod.loadTranslations()).toThrow('Missing required locale file');
    });

    it('silently skips non-English locale files that fail to load', async () => {
      const enData = JSON.stringify({ greeting: 'Hello' });

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.endsWith('en.json')) return enData;
        throw new Error('File not found');
      });

      const mod = await import('../../src/i18n/index.js');
      // Should not throw even though all non-en locales fail
      expect(() => mod.loadTranslations()).not.toThrow();
    });

    it('handles deeply nested JSON objects', async () => {
      const enData = JSON.stringify({
        level1: {
          level2: {
            level3: 'deep value',
          },
        },
      });

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.endsWith('en.json')) return enData;
        throw new Error('File not found');
      });

      const mod = await import('../../src/i18n/index.js');
      mod.loadTranslations();

      expect(mod.t('level1.level2.level3', 'en')).toBe('deep value');
    });

    it('converts non-string values to strings during flattening', async () => {
      const enData = JSON.stringify({
        count: 42,
        enabled: true,
        items: [1, 2, 3],
      });

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.endsWith('en.json')) return enData;
        throw new Error('File not found');
      });

      const mod = await import('../../src/i18n/index.js');
      mod.loadTranslations();

      expect(mod.t('count', 'en')).toBe('42');
      expect(mod.t('enabled', 'en')).toBe('true');
      // Arrays are not objects for flattening, they get String()
      expect(mod.t('items', 'en')).toBe('1,2,3');
    });
  });

  // -------------------------------------------------------------------------
  // t (translate)
  // -------------------------------------------------------------------------
  describe('t', () => {
    async function setupModule() {
      const enData = JSON.stringify({
        common: { save: 'Save', greeting: 'Hello {{name}}', multi: '{{a}} and {{b}}' },
        onlyEn: 'English only',
      });
      const frData = JSON.stringify({
        common: { save: 'Enregistrer', greeting: 'Bonjour {{name}}' },
      });

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.endsWith('en.json')) return enData;
        if (p.endsWith('fr.json')) return frData;
        throw new Error('File not found');
      });

      const mod = await import('../../src/i18n/index.js');
      mod.loadTranslations();
      return mod;
    }

    it('returns the translation for the given locale', async () => {
      const mod = await setupModule();
      expect(mod.t('common.save', 'fr')).toBe('Enregistrer');
    });

    it('defaults to English locale when no locale is specified', async () => {
      const mod = await setupModule();
      expect(mod.t('common.save')).toBe('Save');
    });

    it('falls back to English when key is missing in requested locale', async () => {
      const mod = await setupModule();
      expect(mod.t('onlyEn', 'fr')).toBe('English only');
    });

    it('returns the key itself when not found in any locale', async () => {
      const mod = await setupModule();
      expect(mod.t('nonexistent.key', 'en')).toBe('nonexistent.key');
    });

    it('substitutes template parameters', async () => {
      const mod = await setupModule();
      expect(mod.t('common.greeting', 'en', { name: 'World' })).toBe('Hello World');
    });

    it('substitutes multiple template parameters', async () => {
      const mod = await setupModule();
      expect(mod.t('common.multi', 'en', { a: 'X', b: 'Y' })).toBe('X and Y');
    });

    it('leaves placeholders intact when params do not include the key', async () => {
      const mod = await setupModule();
      expect(mod.t('common.greeting', 'en', { other: 'val' })).toBe('Hello {{name}}');
    });

    it('substitutes params in fallback locale translation', async () => {
      const mod = await setupModule();
      // 'onlyEn' does not exist in fr, so falls back to en
      // But 'onlyEn' has no params, so test with greeting in a locale that doesn't have it
      expect(mod.t('common.greeting', 'fr', { name: 'Monde' })).toBe('Bonjour Monde');
    });

    it('falls back to en dict when requested locale has no translations at all', async () => {
      const mod = await setupModule();
      // 'de' was not loaded (threw error), so should fall back to en
      expect(mod.t('common.save', 'de')).toBe('Save');
    });
  });

  // -------------------------------------------------------------------------
  // getLocaleData
  // -------------------------------------------------------------------------
  describe('getLocaleData', () => {
    it('returns the full flattened dictionary for a loaded locale', async () => {
      const enData = JSON.stringify({ a: '1', b: { c: '2' } });
      const itData = JSON.stringify({ a: 'uno' });

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.endsWith('en.json')) return enData;
        if (p.endsWith('it.json')) return itData;
        throw new Error('File not found');
      });

      const mod = await import('../../src/i18n/index.js');
      mod.loadTranslations();

      const itLocale = mod.getLocaleData('it');
      expect(itLocale).toEqual({ a: 'uno' });
    });

    it('falls back to English data when locale is not loaded', async () => {
      const enData = JSON.stringify({ key: 'value' });

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.endsWith('en.json')) return enData;
        throw new Error('File not found');
      });

      const mod = await import('../../src/i18n/index.js');
      mod.loadTranslations();

      const deLocale = mod.getLocaleData('de');
      expect(deLocale).toEqual({ key: 'value' });
    });

    it('returns English data for an unloaded locale', async () => {
      const enData = JSON.stringify({ x: 'y' });

      mockedReadFileSync.mockImplementation((filePath: any) => {
        const p = String(filePath);
        if (p.endsWith('en.json')) return enData;
        throw new Error('File not found');
      });

      const mod = await import('../../src/i18n/index.js');
      mod.loadTranslations();

      // 'es' was not loaded
      const esLocale = mod.getLocaleData('es');
      expect(esLocale).toEqual({ x: 'y' });
    });
  });
});

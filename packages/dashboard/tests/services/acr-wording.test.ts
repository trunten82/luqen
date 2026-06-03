import { describe, it, expect } from 'vitest';
import {
  ACR_WORDING_KEYS,
  resolveAcrStrings,
  type AcrWordingOverride,
} from '../../src/services/acr-wording.js';

/**
 * The ACR's prose is single-source and localizable. Every string the shared
 * template renders comes from the wording resolver, which merges:
 *   - the STANDARD localized wording (from the app i18n catalog), and
 *   - optional per-org CUSTOM overrides (admin-edited / translated).
 * Each resolved string carries provenance (`source`) so the report and the
 * admin can show whether wording is standard or customised, and whether a
 * non-English standard string has been human-reviewed.
 */

// A tiny fake translator: returns `${locale}:${key}` so tests can assert which
// locale/key was resolved without depending on real translations.
const fakeT = (key: string, locale: string): string => `${locale}:${key}`;

describe('resolveAcrStrings', () => {
  it('returns the standard localized wording for every catalog key when there are no overrides', () => {
    const strings = resolveAcrStrings({ locale: 'fr', t: fakeT, overrides: [] });
    for (const entry of ACR_WORDING_KEYS) {
      expect(strings[entry.key].text).toBe(`fr:${entry.i18nKey}`);
      expect(strings[entry.key].source).toBe('standard');
    }
  });

  it('marks English standard wording as reviewed, non-English standard wording as needs-review', () => {
    const en = resolveAcrStrings({ locale: 'en', t: fakeT, overrides: [] });
    const it = resolveAcrStrings({ locale: 'it', t: fakeT, overrides: [] });
    const anyKey = ACR_WORDING_KEYS[0].key;
    expect(en[anyKey].reviewed).toBe(true);
    expect(it[anyKey].reviewed).toBe(false);
  });

  it('applies a custom override, flips source to custom, and carries its review metadata', () => {
    const key = ACR_WORDING_KEYS[0].key;
    const overrides: AcrWordingOverride[] = [
      {
        key,
        locale: 'it',
        text: 'Testo personalizzato',
        source: 'custom',
        reviewed: true,
        translatedBy: 'mario@acme.it',
        translatedAt: '2026-06-03',
        notes: 'legal sign-off',
      },
    ];
    const strings = resolveAcrStrings({ locale: 'it', t: fakeT, overrides });
    expect(strings[key].text).toBe('Testo personalizzato');
    expect(strings[key].source).toBe('custom');
    expect(strings[key].reviewed).toBe(true);
    expect(strings[key].translatedBy).toBe('mario@acme.it');
    expect(strings[key].translatedAt).toBe('2026-06-03');
  });

  it('ignores overrides for a different locale', () => {
    const key = ACR_WORDING_KEYS[0].key;
    const overrides: AcrWordingOverride[] = [
      { key, locale: 'fr', text: 'FR only', source: 'custom', reviewed: true },
    ];
    const strings = resolveAcrStrings({ locale: 'it', t: fakeT, overrides });
    expect(strings[key].text).toBe(`it:${ACR_WORDING_KEYS[0].i18nKey}`);
    expect(strings[key].source).toBe('standard');
  });

  it('a vpat-standard-sourced override keeps its source (official localized wording, not custom)', () => {
    const key = ACR_WORDING_KEYS[0].key;
    const overrides: AcrWordingOverride[] = [
      { key, locale: 'fr', text: 'Texte officiel', source: 'vpat-standard', reviewed: true },
    ];
    const strings = resolveAcrStrings({ locale: 'fr', t: fakeT, overrides });
    expect(strings[key].text).toBe('Texte officiel');
    expect(strings[key].source).toBe('vpat-standard');
  });

  it('exposes a non-empty, unique catalog of keys each mapped to an i18n key', () => {
    expect(ACR_WORDING_KEYS.length).toBeGreaterThan(20);
    const keys = ACR_WORDING_KEYS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of ACR_WORDING_KEYS) {
      expect(entry.i18nKey).toMatch(/^[a-zA-Z0-9.]+$/);
    }
  });
});

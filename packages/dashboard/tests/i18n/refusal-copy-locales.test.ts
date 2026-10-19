/**
 * HARD-01: the per-reason refusal copy exists in every locale and is translated. The REAL loader is
 * used, so a key missing from one locale cannot pass through the English fallback.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getLocaleData, loadTranslations, SUPPORTED_LOCALES } from '../../src/i18n/index.js';

const REFUSAL_KEYS: readonly string[] = [
  'issueDismissals.action.refusedSelectorTooLong',
  'issueDismissals.action.refusedCodeTooLong',
  'issueDismissals.action.refusedCodeMissing',
  'issueDismissals.dialog.preview.refusedSelectorTooLong',
  'issueDismissals.dialog.preview.refusedInvalid',
  'issueDismissals.dialog.preview.reportUnavailable',
  'issueDismissals.dialog.preview.refusedGeneric',
];

beforeAll(() => {
  loadTranslations();
});

describe('refusal copy locales', () => {
  it('HARD-01 every refusal copy exists in every locale and differs from English', () => {
    const en = getLocaleData('en');
    const problems: string[] = [];
    for (const key of REFUSAL_KEYS) {
      const english = en[key];
      if (typeof english !== 'string' || english.trim() === '') problems.push(`en: ${key} missing`);
      for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
        const value = getLocaleData(locale)[key];
        if (typeof value !== 'string' || value.trim() === '') problems.push(`${locale}: ${key} missing`);
        else if (value === english) problems.push(`${locale}: ${key} is the English text`);
      }
    }
    expect(problems).toEqual([]);
    // Positive control: the loop met five other locales and seven keys.
    expect(SUPPORTED_LOCALES.length).toBe(6);
    expect(new Set(REFUSAL_KEYS).size).toBe(7);
  });
});

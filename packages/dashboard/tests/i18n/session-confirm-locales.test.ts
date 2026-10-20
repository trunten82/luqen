/**
 * HARD-21: the sign-in page notice and the two expired-approval messages exist in every locale and are
 * translated. The REAL loader is used, so a key missing from one locale cannot pass through the English
 * fallback.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getLocaleData, loadTranslations, SUPPORTED_LOCALES } from '../../src/i18n/index.js';

const KEYS: readonly string[] = [
  'auth.signInPageExpired',
  'agent.confirm.expired',
  'agent.confirm.notPending',
];

beforeAll(() => {
  loadTranslations();
});

describe('sign in page and approval message locales', () => {
  it('HARD-21 the sign in page and approval messages exist in every locale and differ from English', () => {
    const en = getLocaleData('en');
    const problems: string[] = [];
    for (const key of KEYS) {
      const english = en[key];
      if (typeof english !== 'string' || english.trim() === '') problems.push(`en: ${key} missing`);
      for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
        const value = getLocaleData(locale)[key];
        if (typeof value !== 'string' || value.trim() === '') problems.push(`${locale}: ${key} missing`);
        else if (value === english) problems.push(`${locale}: ${key} is the English text`);
      }
    }
    expect(problems).toEqual([]);
    // Positive control: the loop met five other locales and three keys.
    expect(SUPPORTED_LOCALES.length).toBe(6);
    expect(new Set(KEYS).size).toBe(3);
  });
});

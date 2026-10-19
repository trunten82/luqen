/**
 * HARD-04: locale strings use double-brace placeholders only. t() substitutes `{{name}}`; a
 * triple-brace `{{{name}}}` leaves a stray brace on each side of the value in the rendered text.
 * The fix is in the data: the placeholder pattern is not widened.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getLocaleData, loadTranslations, SUPPORTED_LOCALES, t } from '../../src/i18n/index.js';

beforeAll(() => {
  loadTranslations();
});

describe('locale placeholders', () => {
  it('HARD-04 no locale string holds a triple brace placeholder', () => {
    const found: string[] = [];
    let strings = 0;
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of Object.entries(getLocaleData(locale))) {
        strings += 1;
        if (value.includes('{{{')) found.push(`${locale}: ${key}`);
      }
    }
    expect(found).toEqual([]);
    // Positive control: the loop read every locale's strings.
    expect(SUPPORTED_LOCALES.length).toBe(6);
    expect(strings).toBeGreaterThan(6 * 1000);
  });

  it('HARD-04 the prompt reset and compare titles name the capability without braces', () => {
    expect(t('admin.llm.prompts.resetModalTitle', 'en', { capability: 'generate-fix' })).toBe('Reset generate-fix to default?');
    expect(t('admin.llm.prompts.diffModalTitle', 'en', { capability: 'generate-fix' })).toBe('Compare with default — generate-fix');
  });
});

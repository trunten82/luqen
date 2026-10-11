import { describe, it, expect, beforeAll } from 'vitest';
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

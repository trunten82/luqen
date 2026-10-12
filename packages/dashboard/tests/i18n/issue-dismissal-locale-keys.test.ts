import { describe, it, expect, beforeAll } from 'vitest';
import { loadTranslations, getLocaleData, t, SUPPORTED_LOCALES, type Locale } from '../../src/i18n/index.js';

// Phase 89 Plan 02: parity gate for the issueDismissals.* namespace (FP-16).
// The REAL loader is used on purpose (a mock of i18n/index.js would let a
// missing key pass), and getLocaleData returns the flattened map production
// reads. template-key-coverage.test.ts checks English only, so a key dropped
// or renamed in one other locale is caught here and nowhere else.

const NS = 'issueDismissals.';

// The explicit required list. A key missing from every locale cannot pass by
// absence, and a key added to a locale without being listed here is refused.
const REQUIRED_KEYS: readonly string[] = [
  'action.dismiss',
  'action.dismissTitle',
  'action.dismissAria',
  'action.refusedTitle',
  'action.revokeAria',
  'dialog.mark.title',
  'dialog.mark.ruleLabel',
  'dialog.mark.elementLabel',
  'dialog.mark.messageLabel',
  'dialog.mark.scope',
  'dialog.mark.effect',
  'dialog.mark.reasonLabel',
  'dialog.mark.reasonHint',
  'dialog.mark.confirm',
  'dialog.mark.saving',
  'dialog.preview.occurrences',
  'dialog.preview.pages',
  'dialog.preview.loading',
  'dialog.preview.none',
  'dialog.preview.error',
  'dialog.preview.retry',
  'dialog.preview.refused',
  'dialog.preview.alreadyDismissed',
  'dialog.revoke.title',
  'dialog.revoke.body',
  'dialog.revoke.commentLabel',
  'dialog.revoke.commentHint',
  'dialog.revoke.confirm',
  'dialog.revoke.saving',
  'section.summary',
  'section.intro',
  'section.activeHeading',
  'section.revokedHeading',
  'section.noActive',
  'col.rule',
  'col.element',
  'col.reason',
  'col.dismissedBy',
  'col.dismissedOn',
  'col.revokedBy',
  'col.revokedOn',
  'col.comment',
  'col.actions',
  'actor.apiKey',
  'allDismissed',
  'toast.marked',
  'toast.revoked',
  'toast.recomputeFailed',
  'toast.recomputeIncomplete',
  'error.invalid',
  'error.session',
  'error.forbidden',
  'error.notFound',
  'error.conflictMark',
  'error.conflictRevoke',
  'error.noMatch',
  'error.rateLimited',
  'error.unavailable',
  'error.generic',
];

const OTHER_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== 'en');

// A missing key reads as no placeholders, so the presence test reports it once
// and this check reports a real mismatch instead of crashing on undefined.
function placeholdersOf(value: string | undefined): string[] {
  return [...(value ?? '').matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]).sort();
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function nsKeys(locale: Locale): string[] {
  return Object.keys(getLocaleData(locale)).filter((k) => k.startsWith(NS));
}

beforeAll(() => {
  loadTranslations();
});

describe('issueDismissals namespace parity through the real loader', () => {
  it('the required list is 59 distinct keys', () => {
    expect(REQUIRED_KEYS.length).toBe(59);
    expect(new Set(REQUIRED_KEYS).size).toBe(59);
  });

  it('all six locales load as their own dictionary (a missing file would silently fall back to English)', () => {
    expect(SUPPORTED_LOCALES.length).toBe(6);
    for (const locale of OTHER_LOCALES) {
      expect(getLocaleData(locale), `${locale}: fell back to the English dictionary`).not.toBe(getLocaleData('en'));
    }
  });

  for (const locale of SUPPORTED_LOCALES) {
    it(`every required issueDismissals key exists and is non-empty in every locale (${locale})`, () => {
      const data = getLocaleData(locale);
      for (const key of REQUIRED_KEYS) {
        const full = NS + key;
        const value = data[full];
        expect(value, `${locale}: missing ${full}`).toBeDefined();
        expect(value.trim().length, `${locale}: ${full} is empty`).toBeGreaterThan(0);
        expect(value, `${locale}: ${full} is the key id`).not.toBe(full);
      }
    });

    it(`no locale has issueDismissals keys outside the required list (${locale})`, () => {
      const allowed = new Set(REQUIRED_KEYS.map((k) => NS + k));
      const extra = nsKeys(locale).filter((k) => !allowed.has(k));
      expect(extra, `${locale}: unexpected keys`).toEqual([]);
    });
  }

  for (const locale of OTHER_LOCALES) {
    it(`placeholders match English exactly and appear once (${locale})`, () => {
      const en = getLocaleData('en');
      const data = getLocaleData(locale);
      let withPlaceholder = 0;
      for (const key of REQUIRED_KEYS) {
        const full = NS + key;
        const expected = placeholdersOf(en[full]);
        if (expected.length > 0) withPlaceholder += 1;
        const actual = placeholdersOf(data[full]);
        expect(actual, `${locale}: ${full} placeholders`).toEqual(expected);
        expect(new Set(actual).size, `${locale}: ${full} repeats a placeholder`).toBe(actual.length);
        expect((data[full] ?? '').replace(/\{\{[^}]*\}\}/g, '').includes('{'), `${locale}: ${full} stray brace`).toBe(false);
      }
      // Positive control: the loop must have met the six placeholder-carrying keys.
      expect(withPlaceholder).toBe(6);
    });

    it(`sentences are translated, not copied from English (${locale})`, () => {
      const en = getLocaleData('en');
      const data = getLocaleData(locale);
      let sentences = 0;
      for (const key of REQUIRED_KEYS) {
        const full = NS + key;
        if (wordCount(en[full]) < 4) continue;
        sentences += 1;
        expect(data[full], `${locale}: ${full} is byte-identical to English`).not.toBe(en[full]);
      }
      expect(sentences).toBeGreaterThan(30);
    });
  }

  it('English placeholders are double-brace and each appears once per string', () => {
    const en = getLocaleData('en');
    const found: Record<string, string[]> = {};
    for (const key of REQUIRED_KEYS) {
      const ph = placeholdersOf(en[NS + key]);
      expect(new Set(ph).size, `en: ${key} repeats a placeholder`).toBe(ph.length);
      if (ph.length > 0) found[key] = ph;
    }
    expect(found).toEqual({
      'action.dismissAria': ['code'],
      'action.revokeAria': ['code'],
      'section.summary': ['active', 'revoked'],
      'toast.marked': ['count'],
      'toast.revoked': ['count'],
      'toast.recomputeFailed': ['failed'],
    });
  });

  for (const locale of SUPPORTED_LOCALES) {
    it(`t() renders a placeholder key in ${locale}`, () => {
      const marked = t('issueDismissals.toast.marked', locale, { count: '7' });
      expect(marked).not.toBe('issueDismissals.toast.marked');
      expect(marked).toContain('7');
      expect(marked.includes('{{')).toBe(false);
      const summary = t('issueDismissals.section.summary', locale, { active: '3', revoked: '4' });
      expect(summary.includes('{{')).toBe(false);
      expect(summary).toContain('3');
      expect(summary).toContain('4');
    });
  }

  it('English copy promises no more than one rule on one exact element', () => {
    const en = getLocaleData('en');
    const FORBIDDEN = /forever|permanent|all similar|always/i;
    const values = REQUIRED_KEYS.map((k) => [k, en[NS + k]] as const);
    for (const [key, value] of values) {
      expect(FORBIDDEN.test(value), `en: ${key} over-promises: ${value}`).toBe(false);
    }
    // Positive control: the pattern can match the words it forbids.
    for (const word of ['forever', 'permanently', 'all similar issues', 'Always']) {
      expect(FORBIDDEN.test(word), `pattern cannot match ${word}`).toBe(true);
    }
    for (const key of ['dialog.mark.scope', 'section.intro']) {
      expect(en[NS + key], `en: ${key} must say the match is one exact element`).toContain('exact element');
    }
  });

  it('the English values are the UI-SPEC wording for the strings other plans match on', () => {
    const en = getLocaleData('en');
    expect(en['issueDismissals.action.dismiss']).toBe('Dismiss');
    expect(en['issueDismissals.dialog.mark.messageLabel']).toBe('Finding');
    expect(en['issueDismissals.dialog.mark.confirm']).toBe('Dismiss as false positive');
    expect(en['issueDismissals.dialog.revoke.confirm']).toBe('Revoke dismissal');
    expect(en['issueDismissals.actor.apiKey']).toBe('API key');
  });
});

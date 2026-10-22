/**
 * COPY-01 and COPY-02 (D-01, D-02): the dismiss dialog and the Dismissed findings intro say what a
 * dismissal does, in every locale. The scope text names EARLIER completed scans (the claim is pinned by
 * tests/services/issue-dismissals/earlier-scans.test.ts); the effect text and the intro say a criterion
 * stops failing only when no finding behind it remains (pinned by the filter-compliance boundary tests).
 *
 * The REAL loader is used, so a key missing from one locale cannot pass through the English fallback.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getLocaleData, loadTranslations, SUPPORTED_LOCALES, type Locale } from '../../src/i18n/index.js';

const SCOPE = 'issueDismissals.dialog.mark.scope';
const EFFECT = 'issueDismissals.dialog.mark.effect';
const INTRO = 'issueDismissals.section.intro';

/** A word each locale's new sentence must contain; none of them occurs in the previous text. */
const EARLIER_WORD: Record<Locale, string> = {
  en: 'earlier', de: 'früheren', es: 'anteriores', fr: 'antérieures', it: 'precedenti', pt: 'anteriores',
};
const ONLY_WHEN_WORD: Record<Locale, string> = {
  en: 'only when', de: 'nur', es: 'solo', fr: 'uniquement', it: 'solo', pt: 'somente',
};

const EN_SCOPE =
  "This dismissal applies to this rule on this exact element, on every page of this site, in this scan, in earlier completed scans and in future scans. It stops matching if the element's selector changes.";
const EN_EFFECT =
  'Dismissed findings stop counting in totals and scores. In the compliance results, a criterion stops failing only when no finding behind it remains. Conformance reports (ACR) state how many findings were dismissed as false positives. You can revoke the dismissal later from the Dismissed findings section.';
const EN_INTRO =
  'Findings dismissed as false positives for this site. They do not count in totals or scores, and in the compliance results a criterion stops failing only when no finding behind it remains. Each dismissal matches one rule on one exact element.';

beforeAll(() => {
  loadTranslations();
});

function value(locale: Locale, key: string): string {
  const v = getLocaleData(locale)[key];
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${locale}: ${key} missing`);
  return v;
}

function differsFromEnglish(locale: Locale, key: string): void {
  if (locale !== 'en') expect(value(locale, key)).not.toBe(value('en', key));
}

describe('dismissal copy in every locale', () => {
  it.each(SUPPORTED_LOCALES)('COPY-01 the %s dismiss dialog names earlier completed scans', (locale) => {
    expect(value(locale, SCOPE)).toContain(EARLIER_WORD[locale]);
    differsFromEnglish(locale, SCOPE);
  });

  it.each(SUPPORTED_LOCALES)(
    'COPY-02 the %s dismiss dialog says a criterion stops failing only when no finding behind it remains',
    (locale) => {
      expect(value(locale, EFFECT)).toContain(ONLY_WHEN_WORD[locale]);
      differsFromEnglish(locale, EFFECT);
    },
  );

  it.each(SUPPORTED_LOCALES)(
    'COPY-02 the %s Dismissed findings intro says a criterion stops failing only when no finding behind it remains',
    (locale) => {
      expect(value(locale, INTRO)).toContain(ONLY_WHEN_WORD[locale]);
      differsFromEnglish(locale, INTRO);
    },
  );

  it('COPY-01 and COPY-02 the English strings are exactly the reviewed wording', () => {
    expect(value('en', SCOPE)).toBe(EN_SCOPE);
    expect(value('en', EFFECT)).toBe(EN_EFFECT);
    expect(value('en', INTRO)).toBe(EN_INTRO);
  });

  it('COPY-01 and COPY-02 the loop met six locales and the placeholders stay out of the sentences', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(6);
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of [SCOPE, EFFECT, INTRO]) expect(value(locale, key)).not.toMatch(/\{\{|\}\}/);
    }
  });
});

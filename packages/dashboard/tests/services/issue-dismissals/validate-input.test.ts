import { describe, it, expect } from 'vitest';
import {
  DISMISSAL_CODE_MAX_LENGTH,
  DISMISSAL_COMMENT_MAX_LENGTH,
  DISMISSAL_REASON_MAX_LENGTH,
  DISMISSAL_SELECTOR_MAX_LENGTH,
  isWholePageSelector,
  validateDismissalCode,
  validateDismissalReason,
  validateDismissalSelector,
  validateMarkInput,
  validateRevokeComment,
} from '../../../src/services/issue-dismissals/validate-input.js';

const WHOLE_PAGE_ERROR = 'cannot identify an element';

describe('limits', () => {
  it('are the documented values', () => {
    expect(DISMISSAL_REASON_MAX_LENGTH).toBe(1000);
    expect(DISMISSAL_COMMENT_MAX_LENGTH).toBe(1000);
    expect(DISMISSAL_CODE_MAX_LENGTH).toBe(300);
    expect(DISMISSAL_SELECTOR_MAX_LENGTH).toBe(4000);
  });
});

describe('validateDismissalReason', () => {
  it('returns the trimmed value', () => {
    expect(validateDismissalReason('  vendor widget, not ours  ')).toEqual({ ok: true, value: 'vendor widget, not ours' });
  });

  it.each([[''], ['   '], ['\n\t '], [undefined], [null], [42], [{}]])('refuses %j as missing', (input) => {
    const result = validateDismissalReason(input);
    expect(result).toEqual({ ok: false, error: 'A reason is required to mark a finding as a false positive' });
  });

  it('accepts exactly 1000 characters after trim', () => {
    const result = validateDismissalReason('a'.repeat(1000));
    expect(result.ok).toBe(true);
  });

  it('refuses 1001 characters', () => {
    expect(validateDismissalReason('a'.repeat(1001))).toEqual({
      ok: false,
      error: 'The reason must be at most 1000 characters',
    });
  });

  it('accepts 1000 characters padded with whitespace and returns them trimmed', () => {
    const result = validateDismissalReason(`   ${'a'.repeat(1000)}   `);
    expect(result).toEqual({ ok: true, value: 'a'.repeat(1000) });
  });
});

describe('validateDismissalSelector', () => {
  it.each([
    [''], ['  '], ['html'], ['HTML'], [' body '], [':root'], ['html > body'], ['html>body'],
    ['/html'], ['/html[1]'], ['/html/body'], ['/html[1]/body[1]'],
  ])('refuses whole-page selector %j', (selector) => {
    const result = validateDismissalSelector(selector);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(WHOLE_PAGE_ERROR);
  });

  it('refuses a non-string selector', () => {
    expect(validateDismissalSelector(undefined).ok).toBe(false);
    expect(validateDismissalSelector(null).ok).toBe(false);
    expect(validateDismissalSelector(7).ok).toBe(false);
  });

  it('uses the documented message', () => {
    expect(validateDismissalSelector('html')).toEqual({
      ok: false,
      error:
        'This selector cannot identify an element: it matches the whole page, so a dismissal on it would hide every finding reported against the page root',
    });
  });

  it.each([['html > body > main'], ['body > div'], ['#app'], ['/html/body/img[1]'], ['html > body > main > p']])(
    'accepts %j and returns it UNCHANGED',
    (selector) => {
      expect(validateDismissalSelector(selector)).toEqual({ ok: true, value: selector });
    },
  );

  it('does not trim or re-case an accepted selector (matching is byte-exact by design)', () => {
    expect(validateDismissalSelector('  #App .Item  ')).toEqual({ ok: true, value: '  #App .Item  ' });
  });

  it('accepts exactly 4000 characters and refuses 4001', () => {
    expect(validateDismissalSelector(`#${'a'.repeat(3999)}`).ok).toBe(true);
    const tooLong = validateDismissalSelector(`#${'a'.repeat(4000)}`);
    expect(tooLong.ok).toBe(false);
  });
});

describe('isWholePageSelector', () => {
  it.each([
    [''], ['html'], ['BODY'], [':ROOT'], ['html > body'], ['  html   >   body  '],
    ['/html'], ['/html[1]'], ['/html/body'], ['/html[1]/body'], ['/html/body[1]'], ['/html[1]/body[1]'],
  ])('is true for %j', (selector) => {
    expect(isWholePageSelector(selector)).toBe(true);
  });

  // WR-03 (87 review): equivalent spellings of the root element — descendant
  // combinator, qualifiers on html/body, :root chains, the universal selector,
  // a selector list containing a root, and the // XPath form.
  it.each([
    ['html body'], [':root>body'], [':root body'], ['html.js'], ['html[lang]'], ['body.home'], ['body[class]'],
    ['*'], ['html > body.home'], ['main, body'], ['//body'], ['//html'], ['html:not(.x)'],
  ])('is true for the root-element spelling %j', (selector) => {
    expect(isWholePageSelector(selector)).toBe(true);
  });

  it.each([
    ['body > div'], ['#app'], ['html > body > main'], ['/html/body/img[1]'], ['/html[2]'], ['/html/body[2]'],
    ['/html/head'], ['h tml'], ['.home'], ['body *'], ['html > body + div'], ['main, #app'],
  ])('is false for %j', (selector) => {
    expect(isWholePageSelector(selector)).toBe(false);
  });
});

describe('validateDismissalCode', () => {
  it.each([[''], ['   '], [undefined], [null], [3]])('refuses %j', (input) => {
    expect(validateDismissalCode(input)).toEqual({ ok: false, error: 'A rule code is required' });
  });

  it('returns the code unchanged', () => {
    expect(validateDismissalCode('WCAG2AA.Principle1.1_4_3.G18')).toEqual({
      ok: true,
      value: 'WCAG2AA.Principle1.1_4_3.G18',
    });
  });

  it('accepts 300 characters and refuses 301', () => {
    expect(validateDismissalCode('c'.repeat(300)).ok).toBe(true);
    expect(validateDismissalCode('c'.repeat(301)).ok).toBe(false);
  });
});

describe('validateRevokeComment', () => {
  it.each([[undefined], [null], [''], ['   ']])('turns %j into null', (input) => {
    expect(validateRevokeComment(input)).toEqual({ ok: true, value: null });
  });

  it('returns trimmed text', () => {
    expect(validateRevokeComment('  was wrong  ')).toEqual({ ok: true, value: 'was wrong' });
  });

  it('accepts 1000 after trim and refuses 1001', () => {
    expect(validateRevokeComment(` ${'x'.repeat(1000)} `).ok).toBe(true);
    expect(validateRevokeComment('x'.repeat(1001)).ok).toBe(false);
  });

  it('refuses a non-string, non-null value', () => {
    expect(validateRevokeComment(5).ok).toBe(false);
    expect(validateRevokeComment({}).ok).toBe(false);
  });
});

describe('validateMarkInput', () => {
  const valid = () => ({ code: 'C1', selector: '#a', reason: '  why  ' });

  it('returns the validated triple', () => {
    expect(validateMarkInput(valid())).toEqual({ ok: true, value: { code: 'C1', selector: '#a', reason: 'why' } });
  });

  it('reports the code error first', () => {
    const result = validateMarkInput({ code: '', selector: 'html', reason: '' });
    expect(result).toEqual({ ok: false, error: 'A rule code is required' });
  });

  it('then the selector error', () => {
    const result = validateMarkInput({ code: 'C1', selector: 'html', reason: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(WHOLE_PAGE_ERROR);
  });

  it('then the reason error', () => {
    const result = validateMarkInput({ code: 'C1', selector: '#a', reason: '   ' });
    expect(result).toEqual({ ok: false, error: 'A reason is required to mark a finding as a false positive' });
  });
});

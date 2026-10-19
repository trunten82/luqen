/**
 * HARD-01: one shared list of (selector, rule code) pairs and whether a dismissal of that pair is
 * refused. The report page's disabled Dismiss button (the dismissalRefused helper) and the server
 * validator (validateDismissalSelector + validateDismissalCode) are both tested against THIS list,
 * so the button and the API cannot come to disagree without a test going red.
 *
 * Lengths are JavaScript string lengths (UTF-16 code units), the unit both sides measure.
 */
import type { DismissalRefusalReason } from '../../src/services/issue-dismissals/validate-input.js';

export interface DismissalRefusalCase {
  readonly why: string;
  readonly selector: unknown;
  readonly code: unknown;
  readonly refused: boolean;
  /**
   * Why the server refuses the pair: null exactly when `refused` is false. A pair refused on both
   * inputs names the rule-code reason, because the server checks the rule code first.
   */
  readonly reason: DismissalRefusalReason | null;
}

const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const SELECTOR = '#hero > p';
const SELECTOR_LIMIT = 4000;
const CODE_LIMIT = 300;

/** A specific (not whole-page) selector of exactly `length` characters. */
function selectorOfLength(length: number, fill = 'a'): string {
  return `#${fill.repeat(length - 1)}`;
}

/** A rule code of exactly `length` characters. */
function codeOfLength(length: number): string {
  return `R.${'x'.repeat(length - 2)}`;
}

export const DISMISSAL_REFUSAL_CASES: readonly DismissalRefusalCase[] = [
  { why: 'a specific selector with a rule code', selector: SELECTOR, code: CODE, refused: false, reason: null },
  { why: 'a descendant of body', selector: 'body > div', code: CODE, refused: false, reason: null },
  { why: 'every child of body', selector: 'body *', code: CODE, refused: false, reason: null },
  { why: 'the html element', selector: 'html', code: CODE, refused: true, reason: 'no-element' },
  { why: 'the html element in capitals', selector: 'HTML', code: CODE, refused: true, reason: 'no-element' },
  { why: 'the body element with spaces', selector: ' body ', code: CODE, refused: true, reason: 'no-element' },
  { why: 'the root pseudo-class', selector: ':root', code: CODE, refused: true, reason: 'no-element' },
  { why: 'the universal selector', selector: '*', code: CODE, refused: true, reason: 'no-element' },
  { why: 'body reached through html', selector: 'html > body', code: CODE, refused: true, reason: 'no-element' },
  { why: 'body with a class', selector: 'body.home', code: CODE, refused: true, reason: 'no-element' },
  { why: 'a list with a whole-page member', selector: '#nav, body', code: CODE, refused: true, reason: 'no-element' },
  { why: 'the XPath of body', selector: '/html/body', code: CODE, refused: true, reason: 'no-element' },
  { why: 'the indexed XPath of html', selector: '/html[1]', code: CODE, refused: true, reason: 'no-element' },
  { why: 'an empty selector', selector: '', code: CODE, refused: true, reason: 'no-element' },
  { why: 'a whitespace selector', selector: '   ', code: CODE, refused: true, reason: 'no-element' },
  { why: 'no selector', selector: undefined, code: CODE, refused: true, reason: 'no-element' },
  { why: 'a null selector', selector: null, code: CODE, refused: true, reason: 'no-element' },
  { why: 'a number as selector', selector: 5, code: CODE, refused: true, reason: 'no-element' },
  { why: 'an object as selector', selector: {}, code: CODE, refused: true, reason: 'no-element' },
  { why: 'a selector at the length limit', selector: selectorOfLength(SELECTOR_LIMIT), code: CODE, refused: false, reason: null },
  { why: 'a selector one over the length limit', selector: selectorOfLength(SELECTOR_LIMIT + 1), code: CODE, refused: true, reason: 'selector-too-long' },
  { why: 'a multibyte selector at the length limit', selector: selectorOfLength(SELECTOR_LIMIT, 'é'), code: CODE, refused: false, reason: null },
  { why: 'a multibyte selector one over the length limit', selector: selectorOfLength(SELECTOR_LIMIT + 1, 'é'), code: CODE, refused: true, reason: 'selector-too-long' },
  { why: 'astral characters counted in code units, at the limit', selector: `#${'\u{1F600}'.repeat(1999)}a`, code: CODE, refused: false, reason: null },
  { why: 'astral characters counted in code units, one over', selector: `#${'\u{1F600}'.repeat(2000)}`, code: CODE, refused: true, reason: 'selector-too-long' },
  { why: 'an empty rule code', selector: SELECTOR, code: '', refused: true, reason: 'code-missing' },
  { why: 'a whitespace rule code', selector: SELECTOR, code: '   ', refused: true, reason: 'code-missing' },
  { why: 'no rule code', selector: SELECTOR, code: undefined, refused: true, reason: 'code-missing' },
  { why: 'a number as rule code', selector: SELECTOR, code: 7, refused: true, reason: 'code-missing' },
  { why: 'a rule code at the length limit', selector: SELECTOR, code: codeOfLength(CODE_LIMIT), refused: false, reason: null },
  { why: 'a rule code one over the length limit', selector: SELECTOR, code: codeOfLength(CODE_LIMIT + 1), refused: true, reason: 'code-too-long' },
  { why: 'both over their limits', selector: selectorOfLength(SELECTOR_LIMIT + 1), code: codeOfLength(CODE_LIMIT + 1), refused: true, reason: 'code-too-long' },
];

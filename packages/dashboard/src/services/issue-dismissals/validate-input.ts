/**
 * Input validators for marking / revoking an issue dismissal (D-04, D-05, FP-01, FP-04).
 *
 * Pure: no storage access. Untrusted request input reaches these through the
 * Phase 87 routes, which must call them before anything is written.
 *
 * Whole-page selectors are refused (D-05). Several engines (lighthouse, IBM,
 * reflow) fall back to `html` when they cannot locate an element, so a
 * dismissal on it would hide every such finding site-wide. The XPath forms go
 * BEYOND D-05's literal list on purpose: IBM Equal Access emits XPath DOM
 * paths (packages/core/src/ibm/map.ts:160 uses result.path.dom; core's own
 * fixture tests/ibm/ibm-map.test.ts:48 has '/html/body'), so '/html/body' is
 * the IBM spelling of the same whole-page fallback.
 *
 * An accepted selector and code are returned UNCHANGED: matching is
 * byte-exact by design (normalised matching, FP-V2-02, is deferred).
 *
 * A selector is classified by its length first (constant time), and only a
 * selector within DISMISSAL_SELECTOR_MAX_LENGTH is read for its shape; the
 * shape check runs in time linear in the selector's length.
 */

export const DISMISSAL_REASON_MAX_LENGTH = 1000;
export const DISMISSAL_COMMENT_MAX_LENGTH = 1000;
export const DISMISSAL_CODE_MAX_LENGTH = 300;
export const DISMISSAL_SELECTOR_MAX_LENGTH = 4000;
/**
 * The largest selector the dismissal preview request accepts (a 400 above it). It bounds the request
 * only: a selector over DISMISSAL_SELECTOR_MAX_LENGTH is refused with the selector-too-long reason.
 * The preview is a GET, so the selector travels in the URL: the bound sits well inside Node's 16 KiB
 * header limit, which refuses a longer request line with 431 before any validation. A selector whose
 * URL encoding is over that limit (each reserved character takes three bytes) still gets 431.
 */
export const DISMISSAL_PREVIEW_SELECTOR_MAX_LENGTH = 8192;

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = <T>(error: string): ValidationResult<T> => ({ ok: false, error });

const REASON_REQUIRED = 'A reason is required to mark a finding as a false positive';
const SELECTOR_WHOLE_PAGE =
  'This selector cannot identify an element: it matches the whole page, so a dismissal on it would hide every finding reported against the page root';
const CODE_REQUIRED = 'A rule code is required';

const ROOT_ELEMENTS = new Set(['html', 'body', ':root']);
const WHOLE_PAGE_XPATH = /^\/\/?(html(\[1\])?(\/body(\[1\])?)?|body(\[1\])?)$/;
const COMBINATOR = /\s*[>+~]\s*|\s+/;
const COMPOUND_BASE = /^(\*|:root|[a-z][a-z0-9-]*)/;

/**
 * Does one CSS selector (no commas) target the root element? Only the LAST
 * compound decides what a selector matches, so `html body`, `:root > body`
 * and `body.home` all target body, while `body > div` and `body *` do not.
 * A lone `*` matches the root too.
 */
function targetsRootElement(part: string): boolean {
  const compounds = part.trim().split(COMBINATOR).filter((c) => c !== '');
  if (compounds.length === 0) return false;
  if (compounds.length === 1 && compounds[0] === '*') return true;
  const base = COMPOUND_BASE.exec(compounds[compounds.length - 1]);
  return base !== null && ROOT_ELEMENTS.has(base[1]);
}

/**
 * Replace every `open ... close` group with the empty pair, in one left-to-right pass: from an opening
 * character, the group ends at the first closing character after it; an opening character with no
 * closing one after it is kept. The same result as replacing `/\[[^\]]*\]/g` (or the parenthesis
 * form) with the empty pair, in time linear in the text's length.
 */
function blankGroups(text: string, open: string, close: string): string {
  const nextClose = new Int32Array(text.length + 1);
  nextClose[text.length] = -1;
  for (let i = text.length - 1; i >= 0; i -= 1) nextClose[i] = text[i] === close ? i : nextClose[i + 1];
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = text[i] === open ? nextClose[i + 1] : -1;
    if (end === -1) {
      parts.push(text[i]);
      i += 1;
    } else {
      parts.push(open + close);
      i = end + 1;
    }
  }
  return parts.join('');
}

export function isWholePageSelector(selector: string): boolean {
  const normalised = selector.trim().toLowerCase();
  if (normalised === '') return true;
  if (WHOLE_PAGE_XPATH.test(normalised.replace(/\s+/g, ''))) return true;
  // Blank out bracket and paren contents so commas or combinators inside
  // [attr] or :not(...) are not read as structure: brackets first, then
  // parentheses on the result.
  const structural = blankGroups(blankGroups(normalised, '[', ']'), '(', ')');
  return structural.split(',').some(targetsRootElement);
}

export function validateDismissalReason(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') return fail(REASON_REQUIRED);
  const reason = raw.trim();
  if (reason === '') return fail(REASON_REQUIRED);
  if (reason.length > DISMISSAL_REASON_MAX_LENGTH) {
    return fail(`The reason must be at most ${DISMISSAL_REASON_MAX_LENGTH} characters`);
  }
  return ok(reason);
}

/** Why a finding cannot be dismissed, in the order the validators check it (rule code first). */
export type DismissalRefusalReason = 'no-element' | 'selector-too-long' | 'code-missing' | 'code-too-long';

/** The one classification of a rule code: the validator and the refusal reason both read it. */
function codeRefusal(raw: unknown): 'code-missing' | 'code-too-long' | null {
  if (typeof raw !== 'string' || raw.trim() === '') return 'code-missing';
  if (raw.length > DISMISSAL_CODE_MAX_LENGTH) return 'code-too-long';
  return null;
}

/**
 * The one classification of a selector: the validator and the refusal reason both read it. The
 * length decides first, so a selector over the limit is never read for its shape.
 */
function selectorRefusal(raw: unknown): 'no-element' | 'selector-too-long' | null {
  if (typeof raw !== 'string') return 'no-element';
  if (raw.length > DISMISSAL_SELECTOR_MAX_LENGTH) return 'selector-too-long';
  return isWholePageSelector(raw) ? 'no-element' : null;
}

export function validateDismissalCode(raw: unknown): ValidationResult<string> {
  const refusal = codeRefusal(raw);
  if (refusal === 'code-missing') return fail(CODE_REQUIRED);
  if (refusal === 'code-too-long') {
    return fail(`The rule code must be at most ${DISMISSAL_CODE_MAX_LENGTH} characters`);
  }
  return ok(raw as string);
}

export function validateDismissalSelector(raw: unknown): ValidationResult<string> {
  const refusal = selectorRefusal(raw);
  if (refusal === 'no-element') return fail(SELECTOR_WHOLE_PAGE);
  if (refusal === 'selector-too-long') {
    return fail(`The selector must be at most ${DISMISSAL_SELECTOR_MAX_LENGTH} characters`);
  }
  return ok(raw as string);
}

/**
 * Why the server refuses to dismiss this (selector, rule code) pair, or null when it accepts it.
 * The same checks as validateDismissalCode and validateDismissalSelector, in the same order (the
 * rule code first), so the report page's disabled Dismiss button and the API name the same reason.
 */
export function dismissalRefusalReason(selector: unknown, code: unknown): DismissalRefusalReason | null {
  return codeRefusal(code) ?? selectorRefusal(selector);
}

export function validateRevokeComment(raw: unknown): ValidationResult<string | null> {
  if (raw === undefined || raw === null) return ok(null);
  if (typeof raw !== 'string') return fail('The comment must be text');
  const comment = raw.trim();
  if (comment === '') return ok(null);
  if (comment.length > DISMISSAL_COMMENT_MAX_LENGTH) {
    return fail(`The comment must be at most ${DISMISSAL_COMMENT_MAX_LENGTH} characters`);
  }
  return ok(comment);
}

/** Validates in the order code, selector, reason and returns the first error. */
export function validateMarkInput(raw: {
  readonly code?: unknown;
  readonly selector?: unknown;
  readonly reason?: unknown;
}): ValidationResult<{ code: string; selector: string; reason: string }> {
  const code = validateDismissalCode(raw.code);
  if (!code.ok) return code;
  const selector = validateDismissalSelector(raw.selector);
  if (!selector.ok) return selector;
  const reason = validateDismissalReason(raw.reason);
  if (!reason.ok) return reason;
  return ok({ code: code.value, selector: selector.value, reason: reason.value });
}

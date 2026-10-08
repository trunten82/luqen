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
 */

export const DISMISSAL_REASON_MAX_LENGTH = 1000;
export const DISMISSAL_COMMENT_MAX_LENGTH = 1000;
export const DISMISSAL_CODE_MAX_LENGTH = 300;
export const DISMISSAL_SELECTOR_MAX_LENGTH = 4000;

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = <T>(error: string): ValidationResult<T> => ({ ok: false, error });

const REASON_REQUIRED = 'A reason is required to mark a finding as a false positive';
const SELECTOR_WHOLE_PAGE =
  'This selector cannot identify an element: it matches the whole page, so a dismissal on it would hide every finding reported against the page root';
const CODE_REQUIRED = 'A rule code is required';

const WHOLE_PAGE_CSS = new Set(['', 'html', 'body', ':root', 'html>body']);
const WHOLE_PAGE_XPATH = /^\/html(\[1\])?(\/body(\[1\])?)?$/;

export function isWholePageSelector(selector: string): boolean {
  const normalised = selector.trim().toLowerCase().replace(/\s+/g, '');
  return WHOLE_PAGE_CSS.has(normalised) || WHOLE_PAGE_XPATH.test(normalised);
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

export function validateDismissalCode(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string' || raw.trim() === '') return fail(CODE_REQUIRED);
  if (raw.length > DISMISSAL_CODE_MAX_LENGTH) {
    return fail(`The rule code must be at most ${DISMISSAL_CODE_MAX_LENGTH} characters`);
  }
  return ok(raw);
}

export function validateDismissalSelector(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string' || isWholePageSelector(raw)) return fail(SELECTOR_WHOLE_PAGE);
  if (raw.length > DISMISSAL_SELECTOR_MAX_LENGTH) {
    return fail(`The selector must be at most ${DISMISSAL_SELECTOR_MAX_LENGTH} characters`);
  }
  return ok(raw);
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

/**
 * Keyboard-interaction behavioral checks.
 *
 * Drives Tab traversal in a real browser and observes:
 *  - 2.1.2 Keyboard trap   (error  — only on a clear stuck loop)
 *  - 2.4.7 Focus visible    (warning — heuristic, no visible indicator)
 *  - 2.4.3 Focus order      (notice  — tab order diverges from DOM order)
 *
 * Severity is deliberately conservative: only a DEFINITE keyboard trap is an
 * error, since a false trap claim is serious. Visibility/order are heuristics.
 */

import type { Page } from 'puppeteer';
import type { Issue } from '../types.js';
import type { BehavioralOptions } from './types.js';

const DEFAULT_MAX_TAB_STOPS = 100;
const MAX_FOCUS_VISIBLE_CHECKS = 40;
const MAX_FOCUS_VISIBLE_ISSUES = 15;
const TRAP_REPEAT_THRESHOLD = 3;

/** Snapshot of the currently-focused element, gathered inside the page. */
interface FocusSnapshot {
  readonly signature: string;
  readonly selector: string;
  readonly context: string;
  readonly domIndex: number;
  readonly tagName: string;
  readonly hasVisibleFocusIndicator: boolean;
  readonly isBody: boolean;
}

const CODE_KEYBOARD_TRAP = 'Luqen.Behavioral.Principle2.Guideline2_1.2_1_2.KeyboardTrap';
const CODE_FOCUS_NOT_VISIBLE = 'Luqen.Behavioral.Principle2.Guideline2_4.2_4_7.FocusNotVisible';
const CODE_FOCUS_ORDER = 'Luqen.Behavioral.Principle2.Guideline2_4.2_4_3.FocusOrder';

/** Yield briefly so the page's async focus/blur handlers can run. */
async function settle(page: Page): Promise<void> {
  try {
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 15)),
    );
  } catch {
    // Non-fatal — traversal continues without the settle.
  }
}

/**
 * Read a snapshot of the active element. Runs entirely in the page context.
 * Returns null only if evaluation fails.
 */
async function snapshotActiveElement(page: Page): Promise<FocusSnapshot | null> {
  try {
    return await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;

      const isBody = el === document.body || el === document.documentElement;

      // Build a reasonably stable CSS selector.
      const buildSelector = (node: HTMLElement): string => {
        if (node.id) return `#${node.id}`;
        const tag = node.tagName.toLowerCase();
        const cls = (node.getAttribute('class') ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join('');
        const parent = node.parentElement;
        let nth = '';
        if (parent) {
          const sibs = Array.from(parent.children).filter(
            (c) => c.tagName === node.tagName,
          );
          if (sibs.length > 1) nth = `:nth-of-type(${sibs.indexOf(node) + 1})`;
        }
        return `${tag}${cls}${nth}`;
      };

      // Position of this element among ALL focusable elements in DOM order.
      const focusableSelector =
        'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"], summary, [role="button"]';
      const all = Array.from(
        document.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((n) => {
        const ti = n.getAttribute('tabindex');
        if (ti !== null && parseInt(ti, 10) < 0) return false;
        if ((n as HTMLButtonElement).disabled) return false;
        const style = getComputedStyle(n);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      const domIndex = all.indexOf(el);

      // Visible focus indicator heuristic: outline, box-shadow, or border.
      const cs = getComputedStyle(el);
      const outlineWidth = parseFloat(cs.outlineWidth || '0');
      const hasOutline = cs.outlineStyle !== 'none' && outlineWidth > 0;
      const hasBoxShadow = cs.boxShadow !== 'none' && cs.boxShadow !== '';
      const borderWidth =
        parseFloat(cs.borderTopWidth || '0') +
        parseFloat(cs.borderBottomWidth || '0') +
        parseFloat(cs.borderLeftWidth || '0') +
        parseFloat(cs.borderRightWidth || '0');
      const hasBorder = borderWidth > 0 && cs.borderStyle !== 'none';
      const hasVisibleFocusIndicator = hasOutline || hasBoxShadow || hasBorder;

      const idPart = el.id ? `#${el.id}` : '';
      const clsPart = (el.getAttribute('class') ?? '').trim();
      const signature = `${el.tagName}|${idPart}|${clsPart}|${domIndex}`;

      const outer = el.outerHTML ?? '';
      const context = outer.length > 200 ? `${outer.slice(0, 200)}...` : outer;

      return {
        signature,
        selector: buildSelector(el),
        context,
        domIndex,
        tagName: el.tagName.toLowerCase(),
        hasVisibleFocusIndicator,
        isBody,
      };
    });
  } catch {
    return null;
  }
}

/** Count focusable elements currently in the document (DOM order). */
async function countFocusable(page: Page): Promise<number> {
  try {
    return await page.evaluate(() => {
      const sel =
        'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"], summary, [role="button"]';
      return Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((n) => {
        const ti = n.getAttribute('tabindex');
        if (ti !== null && parseInt(ti, 10) < 0) return false;
        if ((n as HTMLButtonElement).disabled) return false;
        const style = getComputedStyle(n);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }).length;
    });
  } catch {
    return 0;
  }
}

/** Detect a definite keyboard trap from the focus sequence. */
function detectTrap(
  sequence: readonly FocusSnapshot[],
  focusableCount: number,
): FocusSnapshot | null {
  if (sequence.length === 0) return null;

  // Pattern A: the same non-body element is focused for > N consecutive presses.
  let run = 1;
  for (let i = 1; i < sequence.length; i++) {
    const prev = sequence[i - 1];
    const cur = sequence[i];
    if (cur.signature === prev.signature && !cur.isBody) {
      run++;
      if (run > TRAP_REPEAT_THRESHOLD) {
        return cur;
      }
    } else {
      run = 1;
    }
  }

  // Pattern B: a single non-body element dominates the tail of the traversal,
  // interleaved only with body/no-focus (the classic "refocus on blur" trap
  // where each Tab briefly lands on body before being yanked back). Focus never
  // reaches any OTHER interactive element across the tail window, and more
  // focusable elements demonstrably exist that are never reached.
  const window = TRAP_REPEAT_THRESHOLD * 2;
  if (sequence.length >= window) {
    const tail = sequence.slice(-window);
    const nonBody = tail.filter((s) => !s.isBody);
    if (nonBody.length >= TRAP_REPEAT_THRESHOLD) {
      const first = nonBody[0];
      const allSame = nonBody.every((s) => s.signature === first.signature);
      const moreExist = first.domIndex < 0 || first.domIndex < focusableCount - 1;
      if (allSame && moreExist) {
        return first;
      }
    }
  }

  return null;
}

/** Build the focus-order notice when tab order diverges from DOM order. */
function checkFocusOrder(sequence: readonly FocusSnapshot[]): Issue | null {
  // Build the ordered list of DOM indices visited (skip body / unknown).
  const visited = sequence
    .filter((s) => !s.isBody && s.domIndex >= 0)
    .map((s) => s.domIndex);

  // Deduplicate consecutive repeats.
  const deduped: number[] = [];
  for (const idx of visited) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== idx) {
      deduped.push(idx);
    }
  }

  // Count positions where the visited DOM index decreases (out-of-order step).
  let outOfOrder = 0;
  for (let i = 1; i < deduped.length; i++) {
    if (deduped[i] < deduped[i - 1]) outOfOrder++;
  }

  if (outOfOrder > 2) {
    return {
      type: 'notice',
      code: CODE_FOCUS_ORDER,
      message:
        `Tab focus order diverges from DOM document order in ${outOfOrder} place(s). ` +
        'Verify the focus sequence is logical and meaningful (WCAG 2.4.3).',
      selector: 'html',
      context: '<html>',
      runner: 'behavioral',
    };
  }
  return null;
}

/**
 * Run keyboard behavioral checks on an already-loaded page.
 * Never throws for a single observation failure.
 */
export async function checkKeyboard(
  page: Page,
  opts: BehavioralOptions,
): Promise<Issue[]> {
  const maxTabStops = opts.maxTabStops ?? DEFAULT_MAX_TAB_STOPS;
  const issues: Issue[] = [];

  const focusableCount = await countFocusable(page);
  if (focusableCount === 0) {
    return issues; // Nothing keyboard-interactive to assess.
  }

  // Start from a clean focus state.
  try {
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && typeof el.blur === 'function') el.blur();
    });
  } catch {
    // Ignore — traversal still works.
  }

  const sequence: FocusSnapshot[] = [];
  const noIndicatorBySelector = new Map<string, FocusSnapshot>();

  const stops = Math.min(maxTabStops, focusableCount * 3 + 5);
  for (let i = 0; i < stops; i++) {
    try {
      await page.keyboard.press('Tab');
    } catch {
      break;
    }
    // Allow async focus handlers (e.g. a refocus-on-blur trap) to settle so the
    // observed focus reflects the page's real post-Tab state.
    await settle(page);
    const snap = await snapshotActiveElement(page);
    if (!snap) continue;
    sequence.push(snap);

    // Collect focus-visibility issues (cap cost + dedupe by selector).
    if (
      !snap.isBody &&
      i < MAX_FOCUS_VISIBLE_CHECKS &&
      !snap.hasVisibleFocusIndicator &&
      !noIndicatorBySelector.has(snap.selector) &&
      noIndicatorBySelector.size < MAX_FOCUS_VISIBLE_ISSUES
    ) {
      noIndicatorBySelector.set(snap.selector, snap);
    }
  }

  // 2.1.2 Keyboard trap (error — definite only).
  const trap = detectTrap(sequence, focusableCount);
  if (trap) {
    issues.push({
      type: 'error',
      code: CODE_KEYBOARD_TRAP,
      message:
        'Keyboard focus appears trapped: Tab cannot move focus away from this element. ' +
        'Users must be able to move focus away using the keyboard alone (WCAG 2.1.2).',
      selector: trap.selector,
      context: trap.context,
      runner: 'behavioral',
    });
  }

  // 2.4.7 Focus not visible (warning — heuristic). Skip if a trap was found
  // (the trapped element dominates the traversal and would be noise).
  if (!trap) {
    for (const snap of noIndicatorBySelector.values()) {
      issues.push({
        type: 'warning',
        code: CODE_FOCUS_NOT_VISIBLE,
        message:
          'Element receives keyboard focus with no visible focus indicator ' +
          '(no outline, box-shadow, or border change). Provide a visible focus ' +
          'indicator (WCAG 2.4.7).',
        selector: snap.selector,
        context: snap.context,
        runner: 'behavioral',
      });
    }
  }

  // 2.4.3 Focus order (notice — low confidence).
  const orderIssue = checkFocusOrder(sequence);
  if (orderIssue) issues.push(orderIssue);

  return issues;
}

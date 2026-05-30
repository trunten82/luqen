/**
 * Dynamic-state behavioral checks.
 *
 * Clicks disclosure/menu/dialog triggers and observes whether ARIA state and
 * focus management behave correctly:
 *  - 4.1.2 Name/Role/Value  (warning — aria-expanded not updated on toggle)
 *  - 2.4.3 Focus order       (warning — dialog/menu opens but focus not moved)
 *
 * Every interaction is wrapped so one failure never aborts the rest, and the
 * total number of interactions and emitted issues is bounded.
 */

import type { Page } from 'puppeteer';
import type { Issue } from '../types.js';
import type { BehavioralOptions } from './types.js';

const DEFAULT_MAX_INTERACTIONS = 12;
const MAX_EMITTED_ISSUES = 15;

const CODE_NAME_ROLE_VALUE = 'Luqen.Behavioral.Principle4.Guideline4_1.4_1_2.NameRoleValue';
const CODE_DIALOG_FOCUS = 'Luqen.Behavioral.Principle2.Guideline2_4.2_4_3.DialogFocusOrder';

/** A trigger candidate located in the page, with a stable index for re-lookup. */
interface TriggerInfo {
  readonly index: number;
  readonly selector: string;
  readonly context: string;
  readonly hasAriaExpanded: boolean;
  readonly controlsId: string | null;
}

/** Locate candidate interactive triggers in the page (DOM order). */
async function findTriggers(page: Page, max: number): Promise<TriggerInfo[]> {
  try {
    return await page.evaluate((maxCount: number) => {
      const selector =
        '[aria-expanded], [aria-haspopup], [aria-controls], summary, [data-toggle], [data-bs-toggle], [role="button"][aria-controls]';
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));

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
        return `${tag}${cls}`;
      };

      const out: Array<{
        index: number;
        selector: string;
        context: string;
        hasAriaExpanded: boolean;
        controlsId: string | null;
      }> = [];

      for (let i = 0; i < nodes.length && out.length < maxCount; i++) {
        const node = nodes[i];
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // Mark each candidate so we can re-find it deterministically after clicks.
        node.setAttribute('data-luqen-trigger', String(out.length));
        const outer = node.outerHTML ?? '';
        out.push({
          index: out.length,
          selector: buildSelector(node),
          context: outer.length > 200 ? `${outer.slice(0, 200)}...` : outer,
          hasAriaExpanded: node.hasAttribute('aria-expanded'),
          controlsId: node.getAttribute('aria-controls'),
        });
      }
      return out;
    }, max);
  } catch {
    return [];
  }
}

/** Read the current dynamic state around a trigger (by its tag index). */
async function readState(
  page: Page,
  index: number,
): Promise<{
  ariaExpanded: string | null;
  controlledVisible: boolean;
  dialogOrMenuVisible: boolean;
  focusInsideControlled: boolean;
} | null> {
  try {
    return await page.evaluate((idx: number) => {
      const trigger = document.querySelector<HTMLElement>(
        `[data-luqen-trigger="${idx}"]`,
      );
      if (!trigger) return null;

      const ariaExpanded = trigger.getAttribute('aria-expanded');
      const controlsId = trigger.getAttribute('aria-controls');

      const isVisible = (node: Element | null): boolean => {
        if (!node) return false;
        const el = node as HTMLElement;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
      };

      let controlled: Element | null = null;
      if (controlsId) {
        // aria-controls can be space separated; take the first.
        const firstId = controlsId.split(/\s+/)[0];
        controlled = document.getElementById(firstId);
      }
      const controlledVisible = isVisible(controlled);

      // Look for any visible dialog/menu region (popup surface).
      const dialogLike = Array.from(
        document.querySelectorAll('[role="dialog"], [role="menu"], dialog[open]'),
      ).filter((n) => isVisible(n));
      const dialogOrMenuVisible = dialogLike.length > 0;

      // Is focus inside the controlled region or any visible dialog/menu?
      const active = document.activeElement;
      let focusInsideControlled = false;
      if (active) {
        if (controlled && controlled.contains(active)) focusInsideControlled = true;
        for (const d of dialogLike) {
          if (d.contains(active) || d === active) focusInsideControlled = true;
        }
      }

      return {
        ariaExpanded,
        controlledVisible,
        dialogOrMenuVisible,
        focusInsideControlled,
      };
    }, index);
  } catch {
    return null;
  }
}

/** Click a trigger by its tag index. Ignores navigations and errors. */
async function clickTrigger(page: Page, index: number): Promise<void> {
  try {
    await page.evaluate((idx: number) => {
      const el = document.querySelector<HTMLElement>(`[data-luqen-trigger="${idx}"]`);
      if (el && typeof el.click === 'function') el.click();
    }, index);
  } catch {
    // Ignore — a single failed click must not abort the rest.
  }
}

/** Best-effort restore (close popups) so triggers don't interfere. */
async function tryEscape(page: Page): Promise<void> {
  try {
    await page.keyboard.press('Escape');
  } catch {
    // Non-fatal.
  }
}

/** Yield briefly so the page's async/microtask handlers (and inline scripts) run. */
async function settle(page: Page, ms = 20): Promise<void> {
  try {
    await page.evaluate(
      (delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)),
      ms,
    );
  } catch {
    // Non-fatal.
  }
}

/**
 * Run dynamic-state behavioral checks on an already-loaded page.
 * Conservative: only emits warnings, and only when behaviour is clearly wrong.
 */
export async function checkDynamicStates(
  page: Page,
  opts: BehavioralOptions,
): Promise<Issue[]> {
  const maxInteractions = opts.maxInteractions ?? DEFAULT_MAX_INTERACTIONS;
  const issues: Issue[] = [];
  const seen = new Set<string>();

  // Ensure end-of-body inline scripts (which wire up the triggers) have run
  // before we start interacting — `domcontentloaded` does not guarantee it.
  await settle(page);

  const triggers = await findTriggers(page, maxInteractions);

  for (const trigger of triggers) {
    if (issues.length >= MAX_EMITTED_ISSUES) break;

    const before = await readState(page, trigger.index);
    if (!before) continue;

    await clickTrigger(page, trigger.index);
    // Allow the click handler (and any async reveal animation toggling display)
    // to settle before reading the resulting state.
    await settle(page);

    const after = await readState(page, trigger.index);
    if (!after) {
      await tryEscape(page);
      continue;
    }

    // 4.1.2: a popup/region clearly appeared but aria-expanded did NOT update.
    const popupAppeared =
      !before.controlledVisible && (after.controlledVisible || after.dialogOrMenuVisible);
    if (
      trigger.hasAriaExpanded &&
      popupAppeared &&
      before.ariaExpanded === after.ariaExpanded
    ) {
      const key = `arie:${trigger.selector}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          type: 'warning',
          code: CODE_NAME_ROLE_VALUE,
          message:
            'Activating this control reveals a region but its aria-expanded state ' +
            'is not updated. Update aria-expanded to reflect the open/closed state ' +
            'so assistive technology conveys it (WCAG 4.1.2).',
          selector: trigger.selector,
          context: trigger.context,
          runner: 'behavioral',
        });
      }
    }

    // 2.4.3: a dialog/menu became visible but focus was NOT moved into it.
    if (
      after.dialogOrMenuVisible &&
      !before.dialogOrMenuVisible &&
      !after.focusInsideControlled
    ) {
      const key = `focus:${trigger.selector}`;
      if (!seen.has(key) && issues.length < MAX_EMITTED_ISSUES) {
        seen.add(key);
        issues.push({
          type: 'warning',
          code: CODE_DIALOG_FOCUS,
          message:
            'A dialog or menu opened but keyboard focus was not moved into it. ' +
            'Move focus into the dialog/menu so keyboard users can operate it (WCAG 2.4.3).',
          selector: trigger.selector,
          context: trigger.context,
          runner: 'behavioral',
        });
      }
    }

    // Best-effort restore before the next trigger.
    await tryEscape(page);
  }

  return issues;
}

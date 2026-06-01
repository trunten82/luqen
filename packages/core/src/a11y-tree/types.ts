/**
 * Accessibility-tree engine types.
 *
 * The a11y-tree engine inspects a page through the browser's ACCESSIBILITY TREE
 * (via the Chrome DevTools Protocol `Accessibility.getFullAXTree`) — the same
 * computed tree that assistive technology consumes — rather than the raw DOM.
 * It complements the static rulesets, behavioral, Lighthouse, IBM and reflow
 * engines by catching two problems that are only visible once names/roles are
 * computed:
 *
 *   - WCAG 4.1.2 (Name, Role, Value, A): an element exposed to AT with an
 *     interactive role but NO accessible name — a screen-reader user cannot
 *     identify it. The AX tree is authoritative: it reflects the full ARIA /
 *     label / alt name computation and marks decorative / hidden nodes as
 *     `ignored`, so an emitted finding is a genuine gap.
 *   - WCAG 2.4.3 (Focus Order, A): a positive `tabindex` (> 0), which forces a
 *     focus order that diverges from the DOM / reading order — the definitive,
 *     deterministic form of a focus-order problem.
 *
 * Findings are emitted in the shared `Issue` shape (see ../types.ts) with
 * `runner === 'a11y-tree'` and WCAG codes that embed the criterion so the
 * downstream `extractCriterion()` regex `/(\d+)_(\d+)_(\d+)/` can map them.
 *
 * FREE / local only: drives the puppeteer Chrome that ships transitively with
 * pa11y; the only network access is loading the scanned page.
 */

import type { Issue } from '../types.js';

export interface A11yTreeOptions {
  /** Navigation/run timeout in ms (default 60000). */
  readonly timeout?: number;
  /** Extra HTTP headers to send with the page request. */
  readonly headers?: Record<string, string>;
  /** Extra chrome/puppeteer launch config, merged over the defaults. */
  readonly chromeLaunchConfig?: Record<string, unknown>;
}

export interface A11yTreeResult {
  readonly issues: readonly Issue[];
  readonly pagesChecked: number;
  readonly errors: ReadonlyArray<{ readonly url: string; readonly message: string }>;
}

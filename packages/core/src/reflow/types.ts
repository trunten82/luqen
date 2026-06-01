/**
 * Reflow / zoom-400% accessibility-engine types.
 *
 * The reflow engine complements pa11y's static checks, the behavioral engine,
 * the Lighthouse engine and the IBM Equal Access engine by checking how a page
 * behaves when content is reflowed to a 320 CSS-px wide viewport — equivalent to
 * 400% zoom of a 1280px desktop layout. It targets two success criteria that
 * static rulesets do NOT cover well because they are inherently visual/layout:
 *
 *   - WCAG 1.4.10 (Reflow, AA): content must not require horizontal scrolling at
 *     320 CSS px (no two-dimensional scrolling for a single column of content).
 *   - WCAG 1.4.4 (Resize text, AA): the page must allow zooming up to 200%; a
 *     viewport meta tag that locks zoom (user-scalable=no / maximum-scale<2)
 *     fails it.
 *
 * Findings are emitted in the shared `Issue` shape (see ../types.ts) with
 * `runner === 'reflow'` and WCAG codes that embed the criterion so the
 * downstream `extractCriterion()` regex `/(\d+)_(\d+)_(\d+)/` can map them.
 *
 * FREE / local only: the engine drives a locally-launched headless Chrome (the
 * puppeteer that ships transitively with pa11y). No API keys and no remote calls
 * beyond loading the scanned page.
 */

import type { Issue } from '../types.js';

export interface ReflowOptions {
  /** Navigation/run timeout in ms (default 60000). */
  readonly timeout?: number;
  /** Extra HTTP headers to send with the page request. */
  readonly headers?: Record<string, string>;
  /** Extra chrome/puppeteer launch config, merged over the defaults. */
  readonly chromeLaunchConfig?: Record<string, unknown>;
}

export interface ReflowResult {
  readonly issues: readonly Issue[];
  readonly pagesChecked: number;
  readonly errors: ReadonlyArray<{ readonly url: string; readonly message: string }>;
}

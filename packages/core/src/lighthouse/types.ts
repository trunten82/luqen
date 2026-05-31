/**
 * Lighthouse accessibility-engine types.
 *
 * The Lighthouse engine complements pa11y's static checks and the behavioral
 * engine by running Google Lighthouse's accessibility category (a curated set
 * of axe-core audits) against a real, fully-rendered page. Findings are emitted
 * in the shared `Issue` shape (see ../types.ts) with `runner === 'lighthouse'`
 * and WCAG codes that embed the criterion so the downstream
 * `extractCriterion()` regex `/(\d+)_(\d+)_(\d+)/` can map them.
 *
 * FREE / local only: Lighthouse runs entirely on a locally-launched headless
 * Chrome. No API keys and no remote calls beyond loading the scanned page.
 */

import type { Issue } from '../types.js';

export interface LighthouseOptions {
  /** Navigation/run timeout in ms (default 60000). Lighthouse is heavier than pa11y. */
  readonly timeout?: number;
  /** Extra HTTP headers to send with the page request. */
  readonly headers?: Record<string, string>;
  /** Extra chrome-launcher config, merged over the defaults. */
  readonly chromeLaunchConfig?: Record<string, unknown>;
}

export interface LighthouseResult {
  readonly issues: readonly Issue[];
  readonly pagesChecked: number;
  readonly errors: ReadonlyArray<{ readonly url: string; readonly message: string }>;
}

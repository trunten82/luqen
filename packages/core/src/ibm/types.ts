/**
 * IBM Equal Access accessibility-engine types.
 *
 * The IBM engine complements pa11y's static checks, the behavioral engine, and
 * the Lighthouse engine by running IBM's `accessibility-checker` (Equal Access
 * ruleset) against a real, fully-rendered page. It is a SECOND independent
 * ruleset (distinct from axe-core, which both pa11y/axe and Lighthouse use),
 * giving the multi-engine corroboration logic a genuinely independent signal.
 *
 * Findings are emitted in the shared `Issue` shape (see ../types.ts) with
 * `runner === 'ibm'` and WCAG codes that embed the criterion so the downstream
 * `extractCriterion()` regex `/(\d+)_(\d+)_(\d+)/` can map them.
 *
 * FREE / local only: the checker drives its own locally-launched headless
 * Chrome. No API keys and no remote calls beyond loading the scanned page.
 */

import type { Issue } from '../types.js';
import type { NetworkGuardPolicy } from '../net/ssrf-guard.js';
import type { SharedBrowser } from '../browser/shared-browser.js';

export interface IbmOptions {
  /** Navigation/run timeout in ms (default 60000). */
  readonly timeout?: number;
  /** Extra HTTP headers to send with the page request. */
  readonly headers?: Record<string, string>;
  /**
   * DEEP-SCAN-BROWSER-REUSE-1: when set, run on a lease from this per-scan
   * shared browser (a fresh isolated context + page) instead of launching an
   * own browser. `chromeLaunchConfig` is then ignored.
   */
  readonly sharedBrowser?: SharedBrowser;
  /** Extra chrome/puppeteer launch config, merged over the defaults. */
  readonly chromeLaunchConfig?: Record<string, unknown>;
  /**
   * SSRF guard for every request the loaded page makes (ENGINE-SSRF-1).
   * Default `{}` = strict: private / loopback targets are refused. Pass
   * `{ allowPrivate: true }` only on an explicit operator opt-out.
   */
  readonly guard?: NetworkGuardPolicy;
}

export interface IbmResult {
  readonly issues: readonly Issue[];
  readonly pagesChecked: number;
  readonly errors: ReadonlyArray<{ readonly url: string; readonly message: string }>;
}

/**
 * Behavioral accessibility-testing types.
 *
 * The behavioral engine complements pa11y's static checks by driving a real
 * browser (puppeteer) and observing keyboard/focus/dynamic-state behaviour.
 * Findings are emitted in the shared `Issue` shape (see ../types.ts) with
 * `runner === 'behavioral'` and WCAG codes that embed the criterion so the
 * downstream `extractCriterion()` regex `/(\d+)_(\d+)_(\d+)/` can map them.
 */

import type { Issue } from '../types.js';
import type { VisualContext } from './visual.js';

export interface BehavioralOptions {
  /** Navigation/goto timeout in ms (default 30000). */
  readonly timeout?: number;
  /** Extra HTTP headers to send with the page request. */
  readonly headers?: Record<string, string>;
  /** Max dynamic-state triggers to interact with (default 12). */
  readonly maxInteractions?: number;
  /** Max Tab presses during keyboard traversal (default 100). */
  readonly maxTabStops?: number;
  /** Extra puppeteer launch config, merged over the defaults. */
  readonly chromeLaunchConfig?: Record<string, unknown>;
  /**
   * Optional LLM-vision analyzer (Phase 84). When provided, the behavioral pass
   * captures the page's visual context (screenshot + heading outline + image
   * inventory) and hands it to this caller-supplied callback, merging any
   * returned issues. Dependency-injected so @luqen/core stays LLM-free; the
   * dashboard supplies a callback that calls the `analyse-visual` capability and
   * degrades to `[]` when no vision model is configured. Errors are caught by
   * the orchestrator and recorded as a non-fatal error.
   */
  readonly onVisualContext?: (
    ctx: VisualContext,
    url: string,
  ) => Promise<readonly Issue[]>;
}

export interface BehavioralResult {
  readonly issues: readonly Issue[];
  readonly pagesChecked: number;
  readonly errors: ReadonlyArray<{ readonly url: string; readonly message: string }>;
}

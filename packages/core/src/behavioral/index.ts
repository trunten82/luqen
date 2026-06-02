/**
 * Behavioral accessibility-testing engine — public entry point.
 *
 * Loads a URL once in a real browser and runs the keyboard and dynamic-state
 * checks against the same page, aggregating their findings. A single check
 * failure is captured in `errors` and never thrown out of the orchestrator.
 */

import { withPage } from './browser.js';
import { checkKeyboard } from './keyboard.js';
import { checkDynamicStates } from './dynamic-state.js';
import { captureVisualContext } from './visual.js';
import type { Issue } from '../types.js';
import type { BehavioralOptions, BehavioralResult } from './types.js';

export type { BehavioralOptions, BehavioralResult } from './types.js';
export {
  captureVisualContext,
  type VisualContext,
  type CapturedImage,
  type CapturedScreenshot,
  type CaptureVisualOptions,
} from './visual.js';

/**
 * Run all behavioral accessibility checks against a single URL.
 *
 * Returns a {@link BehavioralResult}. Never throws: if the page cannot be
 * loaded the result has `pagesChecked: 0` and a single load error; if an
 * individual check throws, its failure is recorded in `errors` while the other
 * check's findings are still returned.
 */
export async function runBehavioralChecks(
  url: string,
  opts: BehavioralOptions = {},
): Promise<BehavioralResult> {
  try {
    return await withPage(url, opts, async (page) => {
      const issues: Issue[] = [];
      const errors: Array<{ url: string; message: string }> = [];

      try {
        issues.push(...(await checkKeyboard(page, opts)));
      } catch (err) {
        errors.push({ url, message: `keyboard check failed: ${toMessage(err)}` });
      }

      try {
        issues.push(...(await checkDynamicStates(page, opts)));
      } catch (err) {
        errors.push({ url, message: `dynamic-state check failed: ${toMessage(err)}` });
      }

      // Optional LLM-vision pass (Phase 84). Captures the visual context with
      // the already-open page and delegates analysis to the injected callback.
      if (opts.onVisualContext) {
        try {
          const ctx = await captureVisualContext(page);
          issues.push(...(await opts.onVisualContext(ctx, url)));
        } catch (err) {
          errors.push({ url, message: `vision check failed: ${toMessage(err)}` });
        }
      }

      return { issues, pagesChecked: 1, errors };
    });
  } catch (err) {
    // Page failed to load (or browser failed to launch).
    return {
      issues: [],
      pagesChecked: 0,
      errors: [{ url, message: toMessage(err) }],
    };
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

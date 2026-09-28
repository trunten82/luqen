/**
 * DirectScanner — runs pa11y directly via the npm library instead of the webservice HTTP API.
 *
 * This is the default scan mode. The webservice path (WebserviceClient/Pool) remains
 * available as a fallback when `webserviceUrl` is explicitly configured.
 *
 * Browser resolution goes through the ONE shared resolver in
 * packages/core/src/browser/ (CHROMIUM-RESOLVE-1). A resolution failure
 * REJECTS the scan before pa11y runs — loud, per page — rather than falling
 * through to pa11y's own bundled-puppeteer default resolver.
 */

import { resolveChromium } from '../browser/resolve.js';
import { CHROMIUM_LAUNCH_ARGS } from '../browser/launch.js';

export interface DirectScanOptions {
  readonly standard: string;
  readonly timeout?: number;
  readonly wait?: number;
  readonly hideElements?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly actions?: readonly string[];
  readonly runner?: 'htmlcs' | 'axe';
  /** Deep scan: run multiple pa11y runners. Overrides `runner` when non-empty. */
  readonly runners?: readonly string[];
  readonly includeWarnings?: boolean;
  readonly includeNotices?: boolean;
}

export interface DirectScanResult {
  readonly url: string;
  readonly issues: ReadonlyArray<{
    readonly code: string;
    readonly type: string;
    readonly message: string;
    readonly selector: string;
    readonly context: string;
    readonly runner: string;
  }>;
}

export class DirectScanner {
  async scan(url: string, options: DirectScanOptions): Promise<DirectScanResult> {
    // pa11y is a CommonJS package — use dynamic import for ESM compatibility
    const pa11yModule = await import('pa11y');
    const pa11y = pa11yModule.default ?? pa11yModule;

    // A ChromiumNotFoundError propagates here, before pa11y ever runs.
    const { executablePath } = await resolveChromium();

    const result = await pa11y(url, {
      standard: options.standard || 'WCAG2AA',
      timeout: options.timeout || 30000,
      wait: options.wait || 0,
      hideElements: options.hideElements || undefined,
      headers: options.headers || {},
      actions: options.actions && options.actions.length > 0 ? [...options.actions] : [],
      runners: options.runners && options.runners.length > 0
        ? [...options.runners]
        : (options.runner === 'axe' ? ['axe'] : ['htmlcs']),
      includeWarnings: options.includeWarnings !== false,
      includeNotices: options.includeNotices !== false,
      chromeLaunchConfig: {
        executablePath,
        args: [...CHROMIUM_LAUNCH_ARGS],
      },
    });

    return {
      url: result.pageUrl || url,
      issues: (result.issues || []).map((issue: { code: string; type: string; message: string; selector: string; context: string; runner?: string }) => ({
        code: issue.code,
        type: issue.type,
        message: issue.message,
        selector: issue.selector,
        context: issue.context,
        runner: issue.runner || 'htmlcs',
      })),
    };
  }
}

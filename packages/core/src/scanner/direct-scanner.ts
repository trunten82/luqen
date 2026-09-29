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
 *
 * SSRF (ENGINE-SSRF-1): pa11y offers no request hook of its own, but it
 * accepts a pre-configured `browser` + `page` (its documented options). The
 * scanner launches Chromium itself, installs the shared request guard on the
 * page, and hands both to pa11y — so every redirect hop, subresource, frame
 * and fetch/XHR the scanned page makes is re-checked and private / loopback
 * targets are aborted. pa11y's own `headers` option is NOT used: its
 * interception handler resolves every request synchronously and would win the
 * race against the (async, DNS-resolving) guard. The guard applies the headers
 * to the first request instead, which is what pa11y did.
 */

import { resolveChromium } from '../browser/resolve.js';
import { launchChromium, safeCloseBrowser } from '../browser/launch.js';
import { guardPageRequests } from '../net/browser-request-guard.js';
import type { NetworkGuardPolicy } from '../net/ssrf-guard.js';

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
  /**
   * Per-scan SSRF guard override (ENGINE-SSRF-1). Falls back to the guard the
   * scanner was constructed with, then to `{}` (strict).
   */
  readonly guard?: NetworkGuardPolicy;
}

export interface DirectScannerOptions {
  /** Default SSRF guard for every scan (ENGINE-SSRF-1). Default `{}` = strict. */
  readonly guard?: NetworkGuardPolicy;
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
  private readonly guard: NetworkGuardPolicy;

  constructor(options: DirectScannerOptions = {}) {
    this.guard = options.guard ?? {};
  }

  async scan(url: string, options: DirectScanOptions): Promise<DirectScanResult> {
    // pa11y is a CommonJS package — use dynamic import for ESM compatibility
    const pa11yModule = await import('pa11y');
    const pa11y = pa11yModule.default ?? pa11yModule;

    // A ChromiumNotFoundError propagates here, before pa11y ever runs.
    const { executablePath } = await resolveChromium();

    const guard = options.guard ?? this.guard;
    // SCAN-EGRESS-PROXY-1: the browser's egress proxy enforces the same guard.
    const browser = await launchChromium({ executablePath, guard });
    let result: Awaited<ReturnType<typeof pa11y>>;
    try {
      const page = await browser.newPage();
      await guardPageRequests(page, guard, {
        firstRequestHeaders: options.headers ?? {},
      });
      result = await pa11y(url, {
        standard: options.standard || 'WCAG2AA',
        timeout: options.timeout || 30000,
        wait: options.wait || 0,
        hideElements: options.hideElements || undefined,
        headers: {},
        actions: options.actions && options.actions.length > 0 ? [...options.actions] : [],
        runners: options.runners && options.runners.length > 0
          ? [...options.runners]
          : (options.runner === 'axe' ? ['axe'] : ['htmlcs']),
        includeWarnings: options.includeWarnings !== false,
        includeNotices: options.includeNotices !== false,
        browser,
        page,
      });
    } finally {
      await safeCloseBrowser(browser);
    }

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

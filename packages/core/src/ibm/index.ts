/**
 * IBM Equal Access accessibility-testing engine — public entry point.
 *
 * Runs IBM's `accessibility-checker` (Equal Access ruleset) against a URL and
 * maps every actionable result (VIOLATION / RECOMMENDATION) to the shared
 * `Issue` shape (runner='ibm'). This is a SECOND independent ruleset alongside
 * axe-core (used by pa11y/axe and Lighthouse), strengthening multi-engine
 * corroboration. FREE / local only — the checker drives its own locally-launched
 * headless Chrome; the only network access is loading the scanned page.
 *
 * Mirrors the behavioral / Lighthouse engines' contract: NEVER throws. On any
 * config / launch / run failure the result has `pagesChecked: 0` and a single
 * error entry.
 *
 * No-litter: the checker writes report files to disk by default. We configure it
 * (via `setConfig`) with `outputFormat: ['disable']` and OS-temp folders so a
 * scan never writes junk into the repo / working directory.
 *
 * Browser launch: the checker's OWN bundled puppeteer launches Chrome WITHOUT
 * `--no-sandbox`, which fails when the service runs as root ("Running as root
 * without --no-sandbox is not supported"). To take full control of the launch
 * flags — mirroring how the Lighthouse engine drives chrome-launcher — we launch
 * our OWN puppeteer browser/page with `--no-sandbox --disable-setuid-sandbox`,
 * navigate it to the URL, and hand the puppeteer Page (not a URL string) to
 * `getCompliance`. The checker scans the supplied page in place and never spawns
 * its own Chrome. Chrome discovery goes through the ONE shared resolver in
 * packages/core/src/browser/ (CHROMIUM-RESOLVE-1).
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'puppeteer';
import { openEnginePage, type EnginePage } from '../browser/shared-browser.js';
import { guardPageRequests } from '../net/browser-request-guard.js';
import type { IbmOptions, IbmResult } from './types.js';
import { mapIbmResults, type IbmReport } from './map.js';

export type { IbmOptions, IbmResult } from './types.js';
export { mapIbmResults, IBM_WCAG_MAP, MAX_ISSUES } from './map.js';
export type { IbmReport, IbmReportResult } from './map.js';

const DEFAULT_TIMEOUT = 60_000;

/** Minimal shape of the accessibility-checker module we depend on. */
interface AceCheckerModule {
  setConfig(config: Record<string, unknown>): Promise<void>;
  getCompliance(
    content: unknown,
    label: string,
  ): Promise<{ report?: IbmReport } | undefined>;
  close(): Promise<void>;
}

let acePromise: Promise<AceCheckerModule> | undefined;

/** Lazily load the accessibility-checker runtime (ESM). */
async function loadAceChecker(): Promise<AceCheckerModule> {
  if (!acePromise) {
    acePromise = (async () => {
      const mod = (await import('accessibility-checker')) as unknown as {
        default?: AceCheckerModule;
      } & AceCheckerModule;
      return (mod.default ?? mod) as AceCheckerModule;
    })();
  }
  return acePromise;
}

/**
 * Build a no-litter checker config: disable on-disk report files and point all
 * scratch folders at an OS temp directory so the working tree stays clean.
 */
function buildCheckerConfig(): Record<string, unknown> {
  const base = join(tmpdir(), 'luqen-ibm-ace');
  return {
    outputFormat: ['disable'],
    outputFolder: base,
    baselineFolder: join(base, 'baselines'),
    cacheFolder: join(base, 'cache'),
    outputFilenameTimestamp: false,
    reportLevels: [
      'violation',
      'potentialviolation',
      'recommendation',
      'potentialrecommendation',
    ],
  };
}

/**
 * Run the IBM Equal Access engine against a single URL.
 *
 * Returns an {@link IbmResult}. Never throws: any config / launch / run failure
 * yields `pagesChecked: 0` and a single error entry.
 */
export async function runIbmChecks(
  url: string,
  opts: IbmOptions = {},
): Promise<IbmResult> {
  let checker: AceCheckerModule | undefined;
  let engine: EnginePage | undefined;
  try {
    // OUR OWN page (a shared-browser lease, or our own --no-sandbox browser) so
    // Chrome starts even when the service runs as root; the checker scans the
    // page we hand it rather than spawning its own (sandboxed) Chrome.
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    engine = await openEnginePage(opts); // SCAN-EGRESS-PROXY-1 / DEEP-SCAN-BROWSER-REUSE-1
    const page: Page = engine.page;
    await guardPageRequests(page, opts.guard ?? {}); // ENGINE-SSRF-1
    if (opts.headers && Object.keys(opts.headers).length > 0) {
      await page.setExtraHTTPHeaders({ ...opts.headers });
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    checker = await loadAceChecker();
    await checker.setConfig(buildCheckerConfig());

    const label = `luqen-ibm-${Date.now()}`;
    const result = await withTimeout(
      checker.getCompliance(page, label),
      timeout,
      url,
    );
    const report = result?.report;
    if (!report) {
      return {
        issues: [],
        pagesChecked: 0,
        errors: [{ url, message: 'IBM checker returned no report' }],
      };
    }
    const issues = mapIbmResults(report);
    return { issues, pagesChecked: 1, errors: [] };
  } catch (err) {
    return {
      issues: [],
      pagesChecked: 0,
      errors: [{ url, message: toMessage(err) }],
    };
  } finally {
    if (checker) {
      try {
        await checker.close();
      } catch {
        // Never let teardown failures mask the real result / error.
      }
    }
    await engine?.dispose();
  }
}

/** Reject if the promise does not settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`IBM checker timed out after ${ms}ms for ${url}`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

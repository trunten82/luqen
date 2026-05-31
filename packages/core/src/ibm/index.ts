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
 * Chrome discovery reuses the same strategy as the behavioral / Lighthouse
 * engines: an explicit env override / known system binary is exported via
 * `PUPPETEER_EXECUTABLE_PATH` so the checker's bundled puppeteer picks it up.
 */

import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IbmOptions, IbmResult } from './types.js';
import { mapIbmResults, type IbmReport } from './map.js';

export type { IbmOptions, IbmResult } from './types.js';
export { mapIbmResults, IBM_WCAG_MAP, MAX_ISSUES } from './map.js';
export type { IbmReport, IbmReportResult } from './map.js';

const DEFAULT_TIMEOUT = 60_000;

/** Scan a puppeteer-style chrome cache dir for an installed chrome binary. */
function findChromeInCache(cacheRoot: string): string | undefined {
  try {
    const chromeDir = join(cacheRoot, 'chrome');
    if (!existsSync(chromeDir)) return undefined;
    for (const entry of readdirSync(chromeDir)) {
      const candidate = join(chromeDir, entry, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Ignore — fall through to other discovery strategies.
  }
  return undefined;
}

/** Scan a playwright cache dir for an installed chromium binary. */
function findPlaywrightChromium(): string | undefined {
  const root = join(process.env['HOME'] ?? '/root', '.cache', 'ms-playwright');
  try {
    if (!existsSync(root)) return undefined;
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue;
      const candidate = join(root, entry, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Ignore.
  }
  return undefined;
}

/**
 * Find a Chromium/Chrome executable. Prefers an explicit env override and
 * system binaries (mirrors the pa11y scanner + behavioral / Lighthouse
 * engines), then falls back to puppeteer's own download cache and finally a
 * playwright chromium. Returns undefined to let the checker's puppeteer use its
 * own default.
 */
function findChromiumExecutable(): string | undefined {
  const explicit = [
    process.env['PUPPETEER_EXECUTABLE_PATH'],
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of explicit) {
    if (p && existsSync(p)) return p;
  }
  const home = process.env['HOME'] ?? '/root';
  return findChromeInCache(join(home, '.cache', 'puppeteer')) ?? findPlaywrightChromium();
}

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
  try {
    // Point the checker's bundled Chrome at a discovered system binary, if any.
    const chromePath = findChromiumExecutable();
    if (chromePath && !process.env['PUPPETEER_EXECUTABLE_PATH']) {
      process.env['PUPPETEER_EXECUTABLE_PATH'] = chromePath;
    }

    checker = await loadAceChecker();
    await checker.setConfig(buildCheckerConfig());

    const label = `luqen-ibm-${Date.now()}`;
    const result = await withTimeout(
      checker.getCompliance(url, label),
      opts.timeout ?? DEFAULT_TIMEOUT,
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

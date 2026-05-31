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
 * its own Chrome. Chrome discovery reuses the same strategy as the behavioral /
 * Lighthouse engines: an explicit env override / known system binary, then
 * puppeteer's own resolver / download cache, then a playwright chromium.
 */

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page, PuppeteerNode } from 'puppeteer';
import type { IbmOptions, IbmResult } from './types.js';
import { mapIbmResults, type IbmReport } from './map.js';

export type { IbmOptions, IbmResult } from './types.js';
export { mapIbmResults, IBM_WCAG_MAP, MAX_ISSUES } from './map.js';
export type { IbmReport, IbmReportResult } from './map.js';

const DEFAULT_TIMEOUT = 60_000;

/** Lazily-loaded puppeteer runtime (resolved through pa11y). */
let puppeteerPromise: Promise<PuppeteerNode> | undefined;

/**
 * Load the puppeteer runtime. Resolves the module through pa11y (the package
 * that actually depends on puppeteer), falling back to a bare specifier in case
 * puppeteer is hoisted to the top level in another environment. Mirrors the
 * behavioral browser helper's resolution strategy.
 */
async function loadPuppeteer(): Promise<PuppeteerNode> {
  if (!puppeteerPromise) {
    puppeteerPromise = (async () => {
      const require = createRequire(import.meta.url);
      let specifier = 'puppeteer';
      try {
        specifier = require.resolve('puppeteer');
      } catch {
        try {
          // Resolve via pa11y's module graph (its nested dependency).
          const pa11yRequire = createRequire(require.resolve('pa11y/package.json'));
          specifier = pa11yRequire.resolve('puppeteer');
        } catch {
          // Leave the bare specifier; the import below surfaces a clear error.
        }
      }
      const mod = (await import(specifier)) as { default?: PuppeteerNode } & PuppeteerNode;
      return (mod.default ?? mod) as PuppeteerNode;
    })();
  }
  return puppeteerPromise;
}

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
 * playwright chromium. Returns undefined when nothing is found on disk.
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

/**
 * Resolve the chromium executable. Order of preference (mirrors the behavioral
 * browser helper):
 *  1. explicit env / system binaries / cache scans (above),
 *  2. puppeteer's OWN resolver (`executablePath()`) — the chromium pa11y's
 *     puppeteer downloaded at install; the path that exists on the live server.
 * Returns undefined to let puppeteer.launch() use its built-in default.
 */
function resolveExecutablePath(puppeteer: PuppeteerNode): string | undefined {
  const explicit = findChromiumExecutable();
  if (explicit) return explicit;
  try {
    const own = puppeteer.executablePath();
    if (own && existsSync(own)) return own;
  } catch {
    // executablePath can throw if no browser is configured — fall through.
  }
  return undefined;
}

/**
 * Build the puppeteer launch options, merging caller overrides last. The
 * `--no-sandbox` / `--disable-setuid-sandbox` flags are essential when running
 * as root (the live server) — without them Chrome refuses to start.
 */
function buildLaunchOptions(
  puppeteer: PuppeteerNode,
  opts: IbmOptions,
): Record<string, unknown> {
  const executablePath = resolveExecutablePath(puppeteer);
  return {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    ...(executablePath ? { executablePath } : {}),
    ...(opts.chromeLaunchConfig ?? {}),
  };
}

/** Close a browser without throwing (best-effort teardown). */
async function safeCloseBrowser(browser: Browser | undefined): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // Never let teardown failures mask the real result / error.
  }
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
  let browser: Browser | undefined;
  try {
    // Launch OUR OWN puppeteer browser with --no-sandbox so Chrome starts even
    // when the service runs as root; the checker scans the page we hand it
    // rather than spawning its own (sandboxed) Chrome.
    const puppeteer = await loadPuppeteer();
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    browser = await puppeteer.launch(
      buildLaunchOptions(puppeteer, opts) as Parameters<PuppeteerNode['launch']>[0],
    );
    const page: Page = await browser.newPage();
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
    await safeCloseBrowser(browser);
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

/**
 * Browser lifecycle helpers for the behavioral engine.
 *
 * Launches puppeteer the same way the pa11y direct scanner does
 * (headless, --no-sandbox, --disable-dev-shm-usage) and guarantees the
 * browser is always torn down, even when the work function throws.
 *
 * Puppeteer is not a direct dependency of this package — it ships transitively
 * with pa11y. We therefore resolve the puppeteer runtime through pa11y's module
 * graph (via `createRequire`) rather than a bare `import 'puppeteer'`, which
 * would not resolve from this package's location. Types are imported type-only
 * from `'puppeteer'` (erased at compile time; resolved via tsconfig `paths`).
 */

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Browser, Page, PuppeteerNode } from 'puppeteer';
import type { BehavioralOptions } from './types.js';

const DEFAULT_TIMEOUT = 30000;

/** Lazily-loaded puppeteer runtime (resolved through pa11y). */
let puppeteerPromise: Promise<PuppeteerNode> | undefined;

/**
 * Load the puppeteer runtime. Resolves the module through pa11y (the package
 * that actually depends on puppeteer), falling back to a bare specifier in case
 * puppeteer is hoisted to the top level in another environment.
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
          // Leave the bare specifier; the import below will surface a clear error.
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
 * system binaries (mirrors the pa11y scanner), then falls back to puppeteer's
 * own download cache and finally any playwright-managed chromium.
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
  return (
    findChromeInCache(join(home, '.cache', 'puppeteer')) ??
    findPlaywrightChromium()
  );
}

/**
 * Resolve the chromium executable. Order of preference:
 *  1. explicit env / system binaries (mirrors the pa11y direct scanner),
 *  2. puppeteer's OWN resolver (`executablePath()`) — the chromium pa11y's
 *     puppeteer downloaded at install; this is the path that exists on the
 *     live server, where pa11y already runs,
 *  3. puppeteer/playwright cache scans (dev-box fallbacks).
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

/** Build the puppeteer launch options, merging caller overrides last. */
function buildLaunchOptions(
  puppeteer: PuppeteerNode,
  opts: BehavioralOptions,
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
async function safeClose(browser: Browser | undefined): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // Never let teardown failures mask the real result / error.
  }
}

/**
 * Launch a browser, run `fn`, and always close the browser afterwards.
 * The browser is never leaked, even if `fn` throws.
 */
export async function withBrowser<T>(
  opts: BehavioralOptions,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const puppeteer = await loadPuppeteer();
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch(
      buildLaunchOptions(puppeteer, opts) as Parameters<PuppeteerNode['launch']>[0],
    );
    return await fn(browser);
  } finally {
    await safeClose(browser);
  }
}

/**
 * Launch a browser, open a page, navigate to `url`, run `fn(page)`, and always
 * tear the browser down afterwards.
 */
export async function withPage<T>(
  url: string,
  opts: BehavioralOptions,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  return withBrowser(opts, async (browser) => {
    const page = await browser.newPage();
    if (opts.headers && Object.keys(opts.headers).length > 0) {
      await page.setExtraHTTPHeaders(opts.headers);
    }
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: opts.timeout ?? DEFAULT_TIMEOUT,
    });
    return fn(page);
  });
}

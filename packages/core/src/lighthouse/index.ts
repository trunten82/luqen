/**
 * Lighthouse accessibility-testing engine — public entry point.
 *
 * Launches a local headless Chrome, runs Google Lighthouse's accessibility
 * category against the URL, and maps every FAILING audit to the shared `Issue`
 * shape (runner='lighthouse'). FREE / local only — no API keys, and the only
 * network access is Lighthouse loading the scanned page.
 *
 * Mirrors the behavioral engine's contract: NEVER throws. On launch / load
 * failure the result has `pagesChecked: 0` and a single error entry.
 *
 * Chrome discovery reuses the same strategy as the pa11y direct scanner and the
 * behavioral browser helper: prefer an explicit env override / known system
 * binary, then puppeteer's (pa11y-bundled) cache, then a playwright cache.
 * The discovered binary is passed to chrome-launcher via `chromePath`.
 */

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Issue } from '../types.js';
import type { LighthouseOptions, LighthouseResult } from './types.js';
import { mapLighthouseAudits, type LhAudit } from './map.js';

export type { LighthouseOptions, LighthouseResult } from './types.js';
export { mapLighthouseAudits, AUDIT_WCAG_MAP, MAX_NODES_PER_AUDIT } from './map.js';

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
 * system binaries (mirrors the pa11y scanner + behavioral engine), then falls
 * back to puppeteer's own download cache and finally a playwright chromium.
 * Returns undefined to let chrome-launcher use its own discovery.
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

/** Minimal shape of the chrome-launcher module we depend on. */
interface ChromeLauncherModule {
  launch(opts: Record<string, unknown>): Promise<{
    port: number;
    kill(): Promise<void>;
  }>;
}

/** Minimal shape of the lighthouse default export we depend on. */
type LighthouseFn = (
  url: string,
  flags: Record<string, unknown>,
  config?: unknown,
) => Promise<{ lhr?: { audits?: Record<string, LhAudit> } } | undefined>;

let lighthousePromise: Promise<LighthouseFn> | undefined;
let chromeLauncherPromise: Promise<ChromeLauncherModule> | undefined;

/** Lazily load the lighthouse runtime (ESM default export). */
async function loadLighthouse(): Promise<LighthouseFn> {
  if (!lighthousePromise) {
    lighthousePromise = (async () => {
      const mod = (await import('lighthouse')) as unknown as {
        default?: LighthouseFn;
      } & LighthouseFn;
      return (mod.default ?? mod) as LighthouseFn;
    })();
  }
  return lighthousePromise;
}

/** Lazily load chrome-launcher (a lighthouse dependency). */
async function loadChromeLauncher(): Promise<ChromeLauncherModule> {
  if (!chromeLauncherPromise) {
    chromeLauncherPromise = (async () => {
      const require = createRequire(import.meta.url);
      let specifier = 'chrome-launcher';
      try {
        specifier = require.resolve('chrome-launcher');
      } catch {
        try {
          const lhRequire = createRequire(require.resolve('lighthouse/package.json'));
          specifier = lhRequire.resolve('chrome-launcher');
        } catch {
          // Leave bare specifier; import below surfaces a clear error.
        }
      }
      const mod = (await import(specifier)) as ChromeLauncherModule;
      return mod;
    })();
  }
  return chromeLauncherPromise;
}

/** Build chrome-launcher options, merging caller overrides last. */
function buildLaunchOptions(opts: LighthouseOptions): Record<string, unknown> {
  const chromePath = findChromiumExecutable();
  return {
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    ...(chromePath ? { chromePath } : {}),
    ...(opts.chromeLaunchConfig ?? {}),
  };
}

/**
 * Run Lighthouse's accessibility category against a single URL.
 *
 * Returns a {@link LighthouseResult}. Never throws: any launch / load / run
 * failure yields `pagesChecked: 0` and a single error entry.
 */
export async function runLighthouseChecks(
  url: string,
  opts: LighthouseOptions = {},
): Promise<LighthouseResult> {
  let chrome: { port: number; kill(): Promise<void> } | undefined;
  try {
    const launcher = await loadChromeLauncher();
    chrome = await launcher.launch(buildLaunchOptions(opts));

    const lighthouse = await loadLighthouse();
    const flags: Record<string, unknown> = {
      port: chrome.port,
      output: 'json',
      logLevel: 'silent',
      onlyCategories: ['accessibility'],
      maxWaitForLoad: opts.timeout ?? DEFAULT_TIMEOUT,
      ...(opts.headers && Object.keys(opts.headers).length > 0
        ? { extraHeaders: { ...opts.headers } }
        : {}),
    };

    const runnerResult = await lighthouse(url, flags);
    const audits = runnerResult?.lhr?.audits;
    const issues = mapLighthouseAudits(audits);
    return { issues, pagesChecked: 1, errors: [] };
  } catch (err) {
    return {
      issues: [],
      pagesChecked: 0,
      errors: [{ url, message: toMessage(err) }],
    };
  } finally {
    if (chrome) {
      try {
        await chrome.kill();
      } catch {
        // Never let teardown failures mask the real result / error.
      }
    }
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

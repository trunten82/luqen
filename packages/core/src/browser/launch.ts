/**
 * The ONE puppeteer `.launch()` call site for every browser-launching engine
 * in packages/*\/src (CHROMIUM-RESOLVE-1). Resolves the executable through
 * {@link resolveChromium} — a resolution failure PROPAGATES as
 * {@link ChromiumNotFoundError} and `puppeteer.launch()` is never called, so
 * there is no silent fall-through to puppeteer's own (often wrong) default
 * lookup.
 */

import type { Browser, PuppeteerNode } from 'puppeteer';
import { loadPuppeteer } from './puppeteer-runtime.js';
import { resolveChromium, type ResolveChromiumDeps } from './resolve.js';

/**
 * `--no-sandbox` / `--disable-setuid-sandbox` are essential when running as
 * root (the live server) — without them Chrome refuses to start.
 */
export const CHROMIUM_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
] as const;

export interface LaunchChromiumDeps {
  readonly puppeteer?: Pick<PuppeteerNode, 'launch'>;
  readonly resolve?: (deps?: ResolveChromiumDeps) => Promise<{ readonly executablePath: string }>;
}

export interface LaunchChromiumOverrides {
  readonly executablePath?: string;
  readonly headless?: boolean;
  readonly args?: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * Launch a Chromium browser through the shared resolver. An explicit
 * `overrides.executablePath` skips resolution entirely (used by callers that
 * already resolved once and want to avoid a second lookup).
 */
export async function launchChromium(
  overrides: LaunchChromiumOverrides = {},
  deps: LaunchChromiumDeps = {},
): Promise<Browser> {
  const puppeteer = deps.puppeteer ?? (await loadPuppeteer());
  const resolve = deps.resolve ?? resolveChromium;

  let executablePath = overrides.executablePath;
  if (!executablePath) {
    const resolved = await resolve();
    executablePath = resolved.executablePath;
  }

  const options = {
    headless: true, // MEASURED equivalent to 'new' in puppeteer-core 25.1.0
    args: [...CHROMIUM_LAUNCH_ARGS],
    executablePath,
    ...overrides,
  };

  return puppeteer.launch(options as Parameters<PuppeteerNode['launch']>[0]) as Promise<Browser>;
}

/** Close a browser without throwing (best-effort teardown). */
export async function safeCloseBrowser(browser: Browser | undefined | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // Never let teardown failures mask the real result / error.
  }
}

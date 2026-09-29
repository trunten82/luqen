/**
 * Browser lifecycle helpers for the behavioral engine.
 *
 * Launches through the ONE shared resolver/launcher in
 * packages/core/src/browser/ (CHROMIUM-RESOLVE-1) — no local Chromium
 * discovery, no bare `puppeteer.launch()`.
 */

import type { Browser, Page } from 'puppeteer';
import { launchChromium, safeCloseBrowser } from '../browser/launch.js';
import { guardPageRequests } from '../net/browser-request-guard.js';
import type { BehavioralOptions } from './types.js';

const DEFAULT_TIMEOUT = 30000;

/**
 * Launch a browser, run `fn`, and always close the browser afterwards.
 * The browser is never leaked, even if `fn` throws.
 */
export async function withBrowser<T>(
  opts: BehavioralOptions,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await launchChromium({ ...opts.chromeLaunchConfig, guard: opts.guard ?? {} }); // SCAN-EGRESS-PROXY-1
    return await fn(browser);
  } finally {
    await safeCloseBrowser(browser);
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
    await guardPageRequests(page, opts.guard ?? {}); // ENGINE-SSRF-1
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

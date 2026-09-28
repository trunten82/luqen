/**
 * Rendered-DOM BFS discovery crawler — the browser-based fallback used ONLY
 * when the fetch-based crawler (crawler.ts) flags a bot-protection challenge
 * (WAF-BROWSER-2). Lives in its own module (like scope.ts) so discover.test.ts
 * can `vi.mock` it without also mocking crawler.js.
 *
 * Mirrors crawlSite's BFS accounting exactly (visited set seeded with the
 * normalized start URL, queue loop while visited.size <= maxPages, per-link
 * filter order normalize -> isInDiscoveryScope -> not visited -> isHtmlUrl ->
 * isAllowed) with two differences: a page is only ever LOADED when it is
 * still within maxDepth/maxPages (loading it can add nothing otherwise), and
 * the whole crawl is bounded by a wall-clock budget in addition to the
 * per-page timeout.
 *
 * SSRF (DISCOVERY-SSRF-1): every queued URL is checked with the guard before
 * `goto`, and the default launcher turns on request interception so EVERY
 * request the page makes — redirect hops, subresources, frames, fetch/XHR —
 * is re-checked and aborted when it targets a private / loopback address.
 *
 * Never throws (any failure — launch, a page, or the budget — degrades to
 * "keep what was already found") and always closes every page and the
 * browser it opened.
 */

import { isWafChallenge } from './crawler.js';
import { isHtmlUrl, normalizeUrl } from './link-filters.js';
import { computeDiscoveryScope, isInDiscoveryScope } from './scope.js';
import { launchChromium, safeCloseBrowser } from '../browser/launch.js';
import { isPublicUrl, type NetworkGuardPolicy } from '../net/ssrf-guard.js';

/** 20 s per page load — bounds a single stuck page. */
export const BROWSER_DISCOVERY_PAGE_TIMEOUT_MS = 20_000;
/** 120 s total wall-clock budget for the whole browser discovery pass. */
export const BROWSER_DISCOVERY_BUDGET_MS = 120_000;

/** Structural seam — a page as the browser crawler needs it (not puppeteer's own type). */
export interface DiscoveryPage {
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  content(): Promise<string>;
  waitForNavigation(options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  /** Resolved `a[href]` hrefs as the browser sees them (base href applied). */
  readLinks(): Promise<string[]>;
  close(): Promise<void>;
}

/** Structural seam — a browser as the browser crawler needs it. */
export interface DiscoveryBrowser {
  newPage(): Promise<DiscoveryPage>;
  close(): Promise<void>;
}

export type DiscoveryBrowserLauncher = (guard: NetworkGuardPolicy) => Promise<DiscoveryBrowser>;

export interface BrowserCrawlOptions {
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly isAllowed: (url: string) => boolean;
  readonly headers?: Record<string, string>;
  readonly pageTimeoutMs?: number;
  readonly budgetMs?: number;
  /** SSRF guard for navigations and (default launcher) every page request. */
  readonly guard?: NetworkGuardPolicy;
}

export interface BrowserCrawlDeps {
  readonly launch?: DiscoveryBrowserLauncher;
  readonly now?: () => number;
}

export interface BrowserCrawlResult {
  readonly urls: string[];
  readonly error?: string;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const NON_NETWORK_SCHEMES = new Set(['data:', 'blob:', 'about:']);

/**
 * Decides whether the browser-discovery page may issue a request. Non-network
 * schemes (data:, blob:, about:) stay in-process and are allowed; http(s)
 * goes through the SSRF guard; every other scheme (file:, ftp:, ws: to an
 * unchecked host, chrome:) is refused.
 */
export async function isBrowserRequestAllowed(url: string, guard: NetworkGuardPolicy): Promise<boolean> {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return false;
  }
  if (NON_NETWORK_SCHEMES.has(protocol)) return true;
  return isPublicUrl(url, guard);
}

/** Minimal slice of puppeteer's HTTPRequest the interception handler needs. */
interface InterceptedRequest {
  url(): string;
  isInterceptResolutionHandled(): boolean;
  abort(errorCode?: 'blockedbyclient'): Promise<void>;
  continue(): Promise<void>;
}

/** Aborts (never throws) any request the guard refuses; continues the rest. */
export async function handleInterceptedRequest(request: InterceptedRequest, guard: NetworkGuardPolicy): Promise<void> {
  let allowed = false;
  try {
    allowed = await isBrowserRequestAllowed(request.url(), guard);
  } catch {
    allowed = false;
  }
  if (request.isInterceptResolutionHandled()) return;
  try {
    await (allowed ? request.continue() : request.abort('blockedbyclient'));
  } catch {
    // Ignore — the page may already be closed; the request never proceeds.
  }
}

/** Default launcher: launches a real Chromium through the shared resolver and adapts it. */
async function defaultLaunch(guard: NetworkGuardPolicy): Promise<DiscoveryBrowser> {
  const browser = await launchChromium();
  return {
    async newPage() {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (request) => { void handleInterceptedRequest(request, guard); });
      return {
        async setExtraHTTPHeaders(headers: Record<string, string>) {
          await page.setExtraHTTPHeaders(headers);
        },
        async goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }) {
          return page.goto(url, options);
        },
        async content() {
          return page.content();
        },
        async waitForNavigation(options: { waitUntil: 'domcontentloaded'; timeout: number }) {
          return page.waitForNavigation(options);
        },
        async readLinks(): Promise<string[]> {
          // Puppeteer's page.$$eval runs the callback inside the sandboxed
          // browser page context via CDP (not Node's global eval / vm) — the
          // documented way to read DOM state, per the plan's own spec.
          return page.$$eval('a[href]', (anchors) =>
            anchors.map((a) => (a as unknown as { href: string }).href),
          );
        },
        async close() {
          await page.close();
        },
      };
    },
    async close() {
      await safeCloseBrowser(browser);
    },
  };
}

export async function browserCrawlSite(
  startUrl: string,
  options: BrowserCrawlOptions,
  deps: BrowserCrawlDeps = {},
): Promise<BrowserCrawlResult> {
  const { maxPages, maxDepth, isAllowed, headers } = options;
  const guard = options.guard ?? {};
  const pageTimeoutMs = options.pageTimeoutMs ?? BROWSER_DISCOVERY_PAGE_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? BROWSER_DISCOVERY_BUDGET_MS;
  const launch = deps.launch ?? defaultLaunch;
  const now = deps.now ?? Date.now;

  const scope = computeDiscoveryScope(startUrl);
  const startNormalized = normalizeUrl(startUrl, startUrl);
  if (!startNormalized) return { urls: [] };

  const visited = new Set<string>([startNormalized]);
  const queue: Array<{ url: string; depth: number }> = [{ url: startNormalized, depth: 0 }];
  const startedAt = now();

  let browser: DiscoveryBrowser | undefined;
  try {
    browser = await launch(guard);

    while (queue.length > 0 && visited.size <= maxPages) {
      const item = queue.shift();
      if (!item) break;
      const { url, depth } = item;

      // A page is only worth loading when it can still contribute (its own
      // depth is within maxDepth and there's still room under maxPages).
      if (depth >= maxDepth || visited.size >= maxPages) continue;

      if (now() - startedAt > budgetMs) break;

      // DISCOVERY-SSRF-1: never navigate to a private / loopback target.
      if (!(await isPublicUrl(url, guard))) continue;

      const page = await browser.newPage();
      try {
        if (headers && Object.keys(headers).length > 0) {
          await page.setExtraHTTPHeaders(headers);
        }
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
        } catch {
          // A page that fails to load is skipped; the crawl continues.
          continue;
        }

        let html: string;
        let needsSettle = false;
        try {
          html = await page.content();
          needsSettle = isWafChallenge(html);
        } catch {
          needsSettle = true;
        }
        if (needsSettle) {
          try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
          } catch {
            // Ignore — read whatever links are present after the attempt.
          }
        }

        let links: string[];
        try {
          links = await page.readLinks();
        } catch {
          continue;
        }

        for (const href of links) {
          if (visited.size >= maxPages) break;
          const normalized = normalizeUrl(href, url);
          if (!normalized) continue;
          if (!isInDiscoveryScope(normalized, scope)) continue;
          if (visited.has(normalized)) continue;
          if (!isHtmlUrl(normalized)) continue;
          if (!isAllowed(normalized)) continue;
          visited.add(normalized);
          queue.push({ url: normalized, depth: depth + 1 });
        }
      } finally {
        try {
          await page.close();
        } catch {
          // Ignore — teardown failure never masks the crawl result.
        }
      }
    }

    return { urls: [...visited] };
  } catch (err) {
    return { urls: [...visited], error: toMessage(err) };
  } finally {
    if (browser) await browser.close();
  }
}

import type { DiscoveredUrl } from '../types.js';
import { fetchRobots } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { crawlSite } from './crawler.js';
import { computeDiscoveryScope, isInDiscoveryScope } from './scope.js';
import { browserCrawlSite } from './browser-crawler.js';
import type { NetworkGuardPolicy } from '../net/ssrf-guard.js';

interface DiscoverOptions {
  readonly maxPages: number;
  readonly crawlDepth: number;
  readonly alsoCrawl: boolean;
  readonly headers?: Record<string, string>;
  /**
   * SSRF guard (DISCOVERY-SSRF-1) for robots.txt, every sitemap / sitemap-index
   * child, every crawled page, every redirect hop, and every browser-fallback
   * request. Default `{}` = strict: private / loopback targets are refused.
   * Pass `{ allowPrivate: true }` only on an explicit operator opt-out.
   */
  readonly guard?: NetworkGuardPolicy;
}

/** Set only when the browser-based fallback (WAF-BROWSER-2) found pages beyond the start URL. */
export type DiscoveryFallback = 'browser';

/**
 * `wafWarning` present means discovery was blocked: the fetch-based crawl hit
 * a bot-protection challenge AND the browser fallback either found nothing
 * beyond the start URL, or itself failed. `discoveryFallback: 'browser'`
 * means a challenge was detected and the browser fallback found pages beyond
 * the start URL. The two never co-occur.
 */
export interface DiscoverResult {
  readonly urls: DiscoveredUrl[];
  readonly wafWarning?: string;
  readonly discoveryFallback?: DiscoveryFallback;
}

export async function discoverUrls(baseUrl: string, options: DiscoverOptions): Promise<DiscoveredUrl[]>;
export async function discoverUrls(baseUrl: string, options: DiscoverOptions, returnResult: true): Promise<DiscoverResult>;
export async function discoverUrls(baseUrl: string, options: DiscoverOptions, returnResult?: boolean): Promise<DiscoveredUrl[] | DiscoverResult> {
  const { maxPages, crawlDepth, alsoCrawl } = options;
  const guard = options.guard ?? {};
  const robots = await fetchRobots(baseUrl, guard);
  const scope = computeDiscoveryScope(baseUrl);

  let sitemapUrls: string[] = [];
  if (robots.sitemapUrls.length > 0) {
    const allUrls = await Promise.all(robots.sitemapUrls.map((url) => parseSitemap(url, guard)));
    sitemapUrls = allUrls.flat();
  } else {
    const defaultSitemapUrl = new URL('/sitemap.xml', baseUrl).href;
    sitemapUrls = await parseSitemap(defaultSitemapUrl, guard);
  }

  // DISCOVERY-SCOPE-3: scope-filter BEFORE hasSitemap is computed, so a
  // sitemap whose entries are all out of scope counts as no sitemap and the
  // crawl fallback still runs.
  sitemapUrls = sitemapUrls.filter((url) => isInDiscoveryScope(url, scope) && robots.isAllowed(url));
  const hasSitemap = sitemapUrls.length > 0;

  let crawledUrls: string[] = [];
  let wafWarning: string | undefined;
  if (!hasSitemap || alsoCrawl) {
    const rawResult = await crawlSite(baseUrl, { maxPages, maxDepth: crawlDepth, isAllowed: robots.isAllowed, headers: options.headers, guard }, true);
    // Handle both CrawlResult (new) and string[] (legacy/mock)
    if (Array.isArray(rawResult)) {
      crawledUrls = rawResult as unknown as string[];
    } else {
      crawledUrls = rawResult.urls;
      wafWarning = rawResult.wafWarning;
    }
  }

  // WAF-BROWSER-2: only when the fetch-based crawl flagged a challenge, try
  // the rendered-DOM browser fallback. browserCrawlSite never throws by
  // contract; the try/catch is belt-and-braces so a bug there can never turn
  // into a thrown discovery.
  let discoveryFallback: DiscoveryFallback | undefined;
  if (wafWarning) {
    try {
      const browserResult = await browserCrawlSite(baseUrl, {
        maxPages,
        maxDepth: crawlDepth,
        isAllowed: robots.isAllowed,
        headers: options.headers,
        guard,
      });
      // Re-filtered by isInDiscoveryScope here too — a second application of
      // the predicate, independent of the browser crawler's own filtering.
      const scopedBrowserUrls = browserResult.urls.filter((url) => isInDiscoveryScope(url, scope));
      const foundBeyondStart = scopedBrowserUrls.some((url) => url !== scope.startHref);
      if (foundBeyondStart) {
        crawledUrls = scopedBrowserUrls;
        wafWarning = undefined;
        discoveryFallback = 'browser';
      }
      // Otherwise: only the start URL (or nothing) was found — leave today's
      // blocked result (start URL + wafWarning) untouched.
    } catch {
      // Keep the blocked result — a browser-fallback bug is not evidence the
      // site was actually reachable.
    }
  }

  // Defence at the merge point too, independent of the crawler's own
  // filtering — a second predicate application at the second entry point.
  crawledUrls = crawledUrls.filter((url) => isInDiscoveryScope(url, scope));

  const seen = new Set<string>();
  const urls: DiscoveredUrl[] = [];
  for (const url of sitemapUrls) {
    if (!seen.has(url)) { seen.add(url); urls.push({ url, discoveryMethod: 'sitemap' }); }
  }
  for (const url of crawledUrls) {
    if (!seen.has(url)) { seen.add(url); urls.push({ url, discoveryMethod: 'crawl' }); }
  }
  const slicedUrls = urls.slice(0, maxPages);

  if (returnResult) {
    return {
      urls: slicedUrls,
      wafWarning,
      ...(discoveryFallback !== undefined ? { discoveryFallback } : {}),
    };
  }
  return slicedUrls;
}

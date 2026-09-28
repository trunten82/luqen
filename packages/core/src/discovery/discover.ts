import type { DiscoveredUrl } from '../types.js';
import { fetchRobots } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { crawlSite } from './crawler.js';
import { computeDiscoveryScope, isInDiscoveryScope } from './scope.js';

interface DiscoverOptions {
  readonly maxPages: number;
  readonly crawlDepth: number;
  readonly alsoCrawl: boolean;
  readonly headers?: Record<string, string>;
}

export interface DiscoverResult {
  readonly urls: DiscoveredUrl[];
  readonly wafWarning?: string;
}

export async function discoverUrls(baseUrl: string, options: DiscoverOptions): Promise<DiscoveredUrl[]>;
export async function discoverUrls(baseUrl: string, options: DiscoverOptions, returnResult: true): Promise<DiscoverResult>;
export async function discoverUrls(baseUrl: string, options: DiscoverOptions, returnResult?: boolean): Promise<DiscoveredUrl[] | DiscoverResult> {
  const { maxPages, crawlDepth, alsoCrawl } = options;
  const robots = await fetchRobots(baseUrl);
  const scope = computeDiscoveryScope(baseUrl);

  let sitemapUrls: string[] = [];
  if (robots.sitemapUrls.length > 0) {
    const allUrls = await Promise.all(robots.sitemapUrls.map((url) => parseSitemap(url)));
    sitemapUrls = allUrls.flat();
  } else {
    const defaultSitemapUrl = new URL('/sitemap.xml', baseUrl).href;
    sitemapUrls = await parseSitemap(defaultSitemapUrl);
  }

  // DISCOVERY-SCOPE-3: scope-filter BEFORE hasSitemap is computed, so a
  // sitemap whose entries are all out of scope counts as no sitemap and the
  // crawl fallback still runs.
  sitemapUrls = sitemapUrls.filter((url) => isInDiscoveryScope(url, scope) && robots.isAllowed(url));
  const hasSitemap = sitemapUrls.length > 0;

  let crawledUrls: string[] = [];
  let wafWarning: string | undefined;
  if (!hasSitemap || alsoCrawl) {
    const rawResult = await crawlSite(baseUrl, { maxPages, maxDepth: crawlDepth, isAllowed: robots.isAllowed, headers: options.headers }, true);
    // Handle both CrawlResult (new) and string[] (legacy/mock)
    if (Array.isArray(rawResult)) {
      crawledUrls = rawResult as unknown as string[];
    } else {
      crawledUrls = rawResult.urls;
      wafWarning = rawResult.wafWarning;
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

  if (returnResult) return { urls: slicedUrls, wafWarning };
  return slicedUrls;
}

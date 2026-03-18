import type { DiscoveredUrl } from '../types.js';
import { fetchRobots } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { crawlSite } from './crawler.js';

interface DiscoverOptions {
  readonly maxPages: number;
  readonly crawlDepth: number;
  readonly alsoCrawl: boolean;
}

export async function discoverUrls(baseUrl: string, options: DiscoverOptions): Promise<DiscoveredUrl[]> {
  const { maxPages, crawlDepth, alsoCrawl } = options;
  const robots = await fetchRobots(baseUrl);

  let sitemapUrls: string[] = [];
  if (robots.sitemapUrls.length > 0) {
    const allUrls = await Promise.all(robots.sitemapUrls.map((url) => parseSitemap(url)));
    sitemapUrls = allUrls.flat();
  } else {
    const defaultSitemapUrl = new URL('/sitemap.xml', baseUrl).href;
    sitemapUrls = await parseSitemap(defaultSitemapUrl);
  }

  sitemapUrls = sitemapUrls.filter((url) => robots.isAllowed(url));
  const hasSitemap = sitemapUrls.length > 0;

  let crawledUrls: string[] = [];
  if (!hasSitemap || alsoCrawl) {
    crawledUrls = await crawlSite(baseUrl, { maxPages, maxDepth: crawlDepth, isAllowed: robots.isAllowed });
  }

  const seen = new Set<string>();
  const results: DiscoveredUrl[] = [];
  for (const url of sitemapUrls) {
    if (!seen.has(url)) { seen.add(url); results.push({ url, discoveryMethod: 'sitemap' }); }
  }
  for (const url of crawledUrls) {
    if (!seen.has(url)) { seen.add(url); results.push({ url, discoveryMethod: 'crawl' }); }
  }
  return results.slice(0, maxPages);
}

import { parseStringPromise } from 'xml2js';
import { guardedFetch } from '../net/guarded-fetch.js';
import type { NetworkGuardPolicy } from '../net/ssrf-guard.js';

interface SitemapUrlset {
  urlset?: { url?: Array<{ loc?: string[] }> };
}

interface SitemapIndex {
  sitemapindex?: { sitemap?: Array<{ loc?: string[] }> };
}

async function fetchXml(url: string, guard: NetworkGuardPolicy): Promise<string | null> {
  try {
    const response = await guardedFetch(url, {}, guard);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

const MAX_SITEMAP_DEPTH = 3;

/**
 * Every sitemap and sitemap-index child is fetched through the SSRF guard
 * (DISCOVERY-SSRF-1); a refused child is skipped like an unreachable one.
 */
export async function parseSitemap(sitemapUrl: string, guard: NetworkGuardPolicy = {}): Promise<string[]> {
  const urls = new Set<string>();
  const visited = new Set<string>();

  async function processSitemap(url: string, depth: number): Promise<void> {
    if (depth > MAX_SITEMAP_DEPTH) return;
    if (visited.has(url)) return;
    visited.add(url);

    const xml = await fetchXml(url, guard);
    if (!xml) return;

    let parsed: SitemapUrlset & SitemapIndex;
    try {
      parsed = (await parseStringPromise(xml)) as SitemapUrlset & SitemapIndex;
    } catch {
      // Not valid XML (e.g. WAF/bot protection returning HTML) — skip
      return;
    }

    if (parsed.sitemapindex?.sitemap) {
      const childUrls = parsed.sitemapindex.sitemap
        .map((entry) => entry.loc?.[0])
        .filter((loc): loc is string => typeof loc === 'string');
      await Promise.all(childUrls.map((child) => processSitemap(child, depth + 1)));
      return;
    }

    if (parsed.urlset?.url) {
      for (const entry of parsed.urlset.url) {
        const loc = entry.loc?.[0];
        if (typeof loc === 'string') urls.add(loc);
      }
    }
  }

  await processSitemap(sitemapUrl, 0);
  return [...urls];
}

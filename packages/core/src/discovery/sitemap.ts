import { parseStringPromise } from 'xml2js';

interface SitemapUrlset {
  urlset?: { url?: Array<{ loc?: string[] }> };
}

interface SitemapIndex {
  sitemapindex?: { sitemap?: Array<{ loc?: string[] }> };
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

const MAX_SITEMAP_DEPTH = 3;

export async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  const urls = new Set<string>();
  const visited = new Set<string>();

  async function processSitemap(url: string, depth: number): Promise<void> {
    if (depth > MAX_SITEMAP_DEPTH) return;
    if (visited.has(url)) return;
    visited.add(url);

    const xml = await fetchXml(url);
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

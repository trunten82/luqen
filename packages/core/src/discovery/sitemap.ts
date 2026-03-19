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

export async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  const urls = new Set<string>();

  async function processSitemap(url: string): Promise<void> {
    const xml = await fetchXml(url);
    if (!xml) return;
    const parsed = (await parseStringPromise(xml)) as SitemapUrlset & SitemapIndex;

    if (parsed.sitemapindex?.sitemap) {
      const childUrls = parsed.sitemapindex.sitemap
        .map((entry) => entry.loc?.[0])
        .filter((loc): loc is string => typeof loc === 'string');
      await Promise.all(childUrls.map(processSitemap));
      return;
    }

    if (parsed.urlset?.url) {
      for (const entry of parsed.urlset.url) {
        const loc = entry.loc?.[0];
        if (typeof loc === 'string') urls.add(loc);
      }
    }
  }

  await processSitemap(sitemapUrl);
  return [...urls];
}

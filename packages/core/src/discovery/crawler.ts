import * as cheerio from 'cheerio';

const NON_HTML_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.css', '.js', '.json', '.xml',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.woff', '.woff2', '.ttf', '.eot',
]);

interface CrawlOptions {
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly isAllowed: (url: string) => boolean;
}

function isHtmlUrl(url: string): boolean {
  const pathname = new URL(url).pathname;
  const ext = pathname.slice(pathname.lastIndexOf('.'));
  return !NON_HTML_EXTENSIONS.has(ext.toLowerCase());
}

function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(href, baseUrl);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

export async function crawlSite(startUrl: string, options: CrawlOptions): Promise<string[]> {
  const { maxPages, maxDepth, isAllowed } = options;
  const baseOrigin = new URL(startUrl).origin;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];

  const startNormalized = normalizeUrl(startUrl, startUrl);
  if (!startNormalized) return [];

  queue.push({ url: startNormalized, depth: 0 });
  visited.add(startNormalized);

  while (queue.length > 0 && visited.size <= maxPages) {
    const item = queue.shift();
    if (!item) break;
    const { url, depth } = item;
    if (depth > maxDepth) continue;

    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) continue;
      const html = await response.text();
      const $ = cheerio.load(html);

      if (depth < maxDepth) {
        $('a[href]').each((_, el) => {
          if (visited.size >= maxPages) return false;
          const href = $(el).attr('href');
          if (!href) return;
          const normalized = normalizeUrl(href, url);
          if (!normalized) return;
          if (!normalized.startsWith(baseOrigin)) return;
          if (visited.has(normalized)) return;
          if (!isHtmlUrl(normalized)) return;
          if (!isAllowed(normalized)) return;
          visited.add(normalized);
          queue.push({ url: normalized, depth: depth + 1 });
        });
      }
    } catch { /* skip failed pages */ }
  }

  return [...visited];
}

import * as cheerio from 'cheerio';

const NON_HTML_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.css', '.js', '.json', '.xml',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.woff', '.woff2', '.ttf', '.eot',
]);

const WAF_SIGNATURES = [
  '_Incapsula_Resource',
  'cf-browser-verification',
  '__cf_chl',
  'challenge-platform',
];

const WAF_SIZE_THRESHOLD = 1000;

/** Returns true if the response body looks like a WAF/bot-protection challenge page. */
export function isWafChallenge(body: string): boolean {
  if (body.length >= WAF_SIZE_THRESHOLD) return false;
  return WAF_SIGNATURES.some((sig) => body.includes(sig));
}

interface CrawlOptions {
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly isAllowed: (url: string) => boolean;
  readonly headers?: Record<string, string>;
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

export interface CrawlResult {
  readonly urls: string[];
  readonly wafWarning?: string;
}

export async function crawlSite(startUrl: string, options: CrawlOptions): Promise<string[]>;
export async function crawlSite(startUrl: string, options: CrawlOptions, returnResult: true): Promise<CrawlResult>;
export async function crawlSite(startUrl: string, options: CrawlOptions, returnResult?: boolean): Promise<string[] | CrawlResult> {
  const { maxPages, maxDepth, isAllowed } = options;
  const baseOrigin = new URL(startUrl).origin;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];
  let wafWarning: string | undefined;

  const startNormalized = normalizeUrl(startUrl, startUrl);
  if (!startNormalized) return returnResult ? { urls: [], wafWarning: undefined } : [];

  queue.push({ url: startNormalized, depth: 0 });
  visited.add(startNormalized);

  while (queue.length > 0 && visited.size <= maxPages) {
    const item = queue.shift();
    if (!item) break;
    const { url, depth } = item;
    if (depth > maxDepth) continue;

    try {
      const response = await fetch(url, options.headers ? { headers: options.headers } : {});
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) continue;
      const html = await response.text();

      // Detect WAF challenge pages — only warn once, on the start URL
      if (depth === 0 && isWafChallenge(html)) {
        wafWarning =
          `Warning: WAF/bot protection detected on ${url}. Crawler cannot bypass JavaScript challenges. ` +
          `The pa11y webservice (Chromium-based) can still scan individual pages. ` +
          `Consider providing URLs manually or using --also-crawl with a sitemap.`;
        // Still include the start URL so at least the homepage gets scanned
        break;
      }

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

  const urls = [...visited];
  if (returnResult) return { urls, wafWarning };
  if (wafWarning) console.warn(wafWarning);
  return urls;
}

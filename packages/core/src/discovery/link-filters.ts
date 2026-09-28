/**
 * Link-filtering helpers shared by the fetch-based crawler (crawler.ts) and
 * the rendered-DOM browser crawler (browser-crawler.ts) — moved out of
 * crawler.ts verbatim so both crawlers share ONE extension list / URL
 * normalizer rather than risking a copy that drifts (WAF-BROWSER-2).
 */

export const NON_HTML_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.css', '.js', '.json', '.xml',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.woff', '.woff2', '.ttf', '.eot',
]);

export function isHtmlUrl(url: string): boolean {
  const pathname = new URL(url).pathname;
  const ext = pathname.slice(pathname.lastIndexOf('.'));
  return !NON_HTML_EXTENSIONS.has(ext.toLowerCase());
}

/** Resolves `href` against `baseUrl`, strips the hash, and returns null for unparseable URLs. */
export function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(href, baseUrl);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

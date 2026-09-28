/**
 * Discovery scope — the ONE origin+path-prefix predicate shared by the
 * crawler and by discover.ts's sitemap and crawled-URL filtering
 * (DISCOVERY-SCOPE-3).
 *
 * Must live in its own module (not exported from crawler.ts): discover.test.ts
 * auto-mocks crawler.js, so a predicate exported from crawler.ts would be
 * silently replaced by a mock in those tests.
 *
 * Prefix rule: a start-URL pathname ending in '/' is treated as a directory
 * and used as-is (e.g. https://example.com/dev/en-us/ -> prefix /dev/en-us/).
 * A pathname NOT ending in '/' is treated as a document and the prefix is its
 * parent directory (RFC 3986 section 5.2.3 relative-reference merge — the
 * same convention `wget --no-parent` documents): /dev/en-us/index.html ->
 * prefix /dev/en-us/; /dev/en-us -> prefix /dev/ (the parent, wider than the
 * "en-us" section — add a trailing slash to scope tightly to that section);
 * /about -> prefix / (whole-origin, exactly today's behaviour for a
 * document-style start URL like https://example.com/about). This never
 * narrows a scan below what the user could plausibly have meant; the
 * alternative (treating a slash-less last segment as a directory) would
 * silently shrink every existing /about-style full-site scan to one
 * subtree — coverage disappearing in the reassuring direction.
 *
 * Origin comparison uses WHATWG URL `.origin` (scheme + lowercased host +
 * port; userinfo excluded), never a string prefix — a string-prefix check
 * on `startUrl` admits userinfo tricks (https://example.com@127.0.0.1/),
 * lookalike hosts (https://example.com.evil.test/) and other ports
 * (https://example.com:8443/), none of which are same-origin.
 */

export interface DiscoveryScope {
  readonly origin: string;
  readonly pathPrefix: string;
  readonly startHref: string;
}

export function computeDiscoveryScope(startUrl: string): DiscoveryScope {
  const start = new URL(startUrl);
  start.hash = '';
  const pathname = start.pathname;
  const pathPrefix = pathname.endsWith('/')
    ? pathname
    : pathname.slice(0, pathname.lastIndexOf('/') + 1);
  return {
    origin: start.origin,
    pathPrefix,
    startHref: start.href,
  };
}

export function isInDiscoveryScope(url: string, scope: DiscoveryScope): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const withoutHash = new URL(parsed.href);
  withoutHash.hash = '';
  if (withoutHash.href === scope.startHref) return true;
  if (parsed.origin !== scope.origin) return false;
  return parsed.pathname.startsWith(scope.pathPrefix);
}

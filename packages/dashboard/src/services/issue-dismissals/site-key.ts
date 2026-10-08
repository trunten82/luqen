/**
 * toSiteKey — the normalised site key a dismissal is matched on (D-02).
 *
 * Prod already holds the same customer site as both `.../dev/en-us` and
 * `.../dev/en-us/` (measured 2026-10-08), so the key must not depend on a
 * trailing slash or host case. No existing normaliser was found to reuse
 * (searched 2026-10-08: only a private trailing-slash strip in routes/agent.ts:226).
 *
 * Rules: trim; for http/https return protocol + '//' + host + pathname (every
 * trailing '/' removed, so the root path becomes '') + search. Host lowercasing
 * and default-port removal come from URL itself; path case is preserved (paths
 * are case-sensitive); http and https stay distinct; the fragment and any
 * credentials are dropped. Unparseable or non-http(s) input returns the trimmed
 * input with trailing '/' removed. Never throws.
 */
function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function toSiteKey(siteUrl: string): string {
  const trimmed = typeof siteUrl === 'string' ? siteUrl.trim() : '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return stripTrailingSlashes(trimmed);
    }
    return `${url.protocol}//${url.host}${stripTrailingSlashes(url.pathname)}${url.search}`;
  } catch {
    return stripTrailingSlashes(trimmed);
  }
}

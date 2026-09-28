/**
 * The ONE function that turns a {@link DiscoverResult} into a human-readable
 * CLI notice — both `cli.ts` call sites use this instead of duplicating the
 * `if (wafWarning) console.warn(...)` check (WAF-BROWSER-2).
 */

import type { DiscoverResult } from './discover.js';

export function discoveryNotice(result: DiscoverResult, startUrl: string): string | undefined {
  if (result.wafWarning) {
    return result.wafWarning;
  }
  if (result.discoveryFallback === 'browser') {
    return `Bot protection detected on ${startUrl}; discovered ${result.urls.length} URL(s) by opening the site in a headless browser.`;
  }
  return undefined;
}

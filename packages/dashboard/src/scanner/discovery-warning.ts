/**
 * The ONE mapping from a core discovery/scan result to the persisted
 * `discovery_warning` code — called by BOTH orchestrator branches (standard
 * and incremental) so the two paths cannot diverge on which code they write
 * (WAF-BROWSER-2).
 */

import type { DiscoveryWarning } from '../db/types.js';

export interface DiscoveryWarningInput {
  readonly wafWarning?: unknown;
  readonly discoveryFallback?: unknown;
}

export function discoveryWarningFrom(result: DiscoveryWarningInput): DiscoveryWarning | undefined {
  if (typeof result.wafWarning === 'string' && result.wafWarning.length > 0) {
    return 'waf-blocked';
  }
  if (result.discoveryFallback === 'browser') {
    return 'waf-browser-discovery';
  }
  return undefined;
}

/**
 * The ONE mapping from a core discovery progress callback payload to the
 * dashboard's `discovery_progress` SSE event data (DISCOVERY-PROGRESS-1) —
 * used by BOTH orchestrator branches (standard via createScanner's
 * onDiscoveryProgress, incremental via discoverUrls' onProgress) so the two
 * paths cannot diverge on what they forward or drop.
 *
 * The payload crosses a module boundary (core is imported dynamically and
 * typed structurally), so it is validated here: an unknown phase, or a count
 * that is not a finite non-negative integer, is dropped rather than shown.
 */

export type DiscoveryProgressPhase = 'sitemap' | 'crawl' | 'browser';

export interface DiscoveryProgressData {
  readonly pagesFound: number;
  readonly discoveryPhase: DiscoveryProgressPhase;
}

const PHASES: ReadonlySet<string> = new Set<DiscoveryProgressPhase>(['sitemap', 'crawl', 'browser']);

export function discoveryProgressFrom(payload: unknown): DiscoveryProgressData | null {
  if (payload === null || typeof payload !== 'object') return null;
  const { phase, pagesFound } = payload as { phase?: unknown; pagesFound?: unknown };
  if (typeof phase !== 'string' || !PHASES.has(phase)) return null;
  if (typeof pagesFound !== 'number' || !Number.isInteger(pagesFound) || pagesFound < 0) return null;
  return { pagesFound, discoveryPhase: phase as DiscoveryProgressPhase };
}

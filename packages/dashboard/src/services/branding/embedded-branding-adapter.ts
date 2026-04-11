/**
 * EmbeddedBrandingAdapter — wraps the in-process @luqen/branding matcher
 * behind the BrandingAdapter contract.
 *
 * Refactor of the inline branding enrichment path that lived at
 * scanner/orchestrator.ts:541-594 in main as of Phase 17 start. This file
 * captures THAT logic — nothing more — behind the typed interface.
 *
 * Key differences from the inline path:
 *   1. Static import of BrandingMatcher (was dynamic `await import(...)`).
 *      Static import lets the bundler/typechecker see the dependency, makes
 *      tests trivially mockable, and removes the per-scan dynamic-import
 *      overhead.
 *   2. Caller (the orchestrator in Plan 17-03) is responsible for resolving
 *      the BrandGuideline. This adapter does NOT call
 *      `storage.branding.getGuidelineForSite` — keeping I/O concerns out of
 *      the adapter is what makes both adapters testable in isolation.
 *   3. The inline path swallowed errors as "non-fatal". This adapter THROWS
 *      on failure — the orchestrator decides whether to return a `degraded`
 *      result or propagate. Per the BrandingAdapter contract: empty result
 *      means "matched zero", NOT "failed to match".
 *
 * Same matcher, same output. Plan 18 will rewire scanner/orchestrator.ts to
 * call this class instead of the inline block.
 */

import { BrandingMatcher } from '@luqen/branding';
import type { BrandedIssue, BrandGuideline, MatchableIssue } from '@luqen/branding';
import type { BrandingAdapter, BrandingMatchContext } from './branding-adapter.js';

export class EmbeddedBrandingAdapter implements BrandingAdapter {
  private readonly matcher: BrandingMatcher;

  constructor() {
    this.matcher = new BrandingMatcher();
  }

  async matchForSite(
    issues: readonly MatchableIssue[],
    guideline: BrandGuideline,
    _context: BrandingMatchContext,
  ): Promise<readonly BrandedIssue[]> {
    // BrandingMatcher.match is synchronous; the async signature on the
    // interface accommodates the remote adapter, which IS async. We return a
    // resolved Promise rather than awaiting nothing to make the cost
    // explicit (one microtask, not a network round-trip).
    const branded = this.matcher.match(issues, guideline);
    return branded;
  }
}

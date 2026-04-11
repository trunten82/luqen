/**
 * BrandingAdapter — Phase 17 dual-mode contract.
 *
 * Both EmbeddedBrandingAdapter (in-process BrandingMatcher) and
 * RemoteBrandingAdapter (HTTP call to @luqen/branding) implement this
 * interface and return the SAME readonly BrandedIssue[] shape. Phase 18's
 * scanner consumer must not branch on which adapter ran — the BrandingAdapter
 * contract IS the boundary.
 *
 * The orchestrator (Plan 17-03) picks one of these per request based on
 * `orgs.branding_mode` from Phase 16's OrgRepository. There is NO caching at
 * any layer (PROJECT.md decision; honored end-to-end).
 *
 * NOTE: matching runs ONCE per scan. The orchestrator does NOT call match
 * twice (once for matching, once for scoring). Scoring (Phase 15
 * calculateBrandScore) consumes the BrandedIssue[] returned by this method.
 * See Pitfall #10 in .planning/research/PITFALLS.md.
 */

import type { BrandedIssue, BrandGuideline, MatchableIssue } from '@luqen/branding';

/**
 * Per-call routing context. Both adapters need orgId + siteUrl: the embedded
 * adapter for logging / future site-scoped behavior, the remote adapter to
 * forward as the X-Org-Id header on `POST /api/v1/match`. scanId is included
 * so error paths in the orchestrator can tag degraded results back to the
 * originating scan without a separate lookup.
 */
export interface BrandingMatchContext {
  readonly orgId: string;
  readonly siteUrl: string;
  readonly scanId: string;
}

/**
 * The single typed entry point. Implementations MUST:
 *   - Accept a non-null guideline (the orchestrator handles the null case
 *     before calling — see Plan 17-03's `no-guideline` short-circuit).
 *   - Return an array of BrandedIssue<MatchableIssue> in the SAME shape
 *     regardless of whether matching ran in-process or over HTTP.
 *   - Throw on failure. The orchestrator catches and produces a `degraded`
 *     result. Implementations MUST NOT swallow errors and return an empty
 *     array — empty must mean "matched zero", not "something went wrong".
 */
export interface BrandingAdapter {
  matchForSite(
    issues: readonly MatchableIssue[],
    guideline: BrandGuideline,
    context: BrandingMatchContext,
  ): Promise<readonly BrandedIssue[]>;
}

/**
 * BrandingOrchestrator — Phase 17 dual-mode dispatch + Phase 15 scoring wiring.
 *
 * Single entry point for "match brand-related accessibility issues + score
 * the result" at scan time and retag time. Phase 18's scanner orchestrator
 * will call `matchAndScore(...)` once per scan, replacing the inline branding
 * block currently at scanner/orchestrator.ts:541-594.
 *
 *   Architectural invariants (LOCKED — see PROJECT.md decisions, PITFALLS.md):
 *
 *   1. NO CACHING. Per-request reads only. `orgRepository.getBrandingMode`
 *      runs on EVERY call to `matchAndScore`. The orgs table is small and a
 *      single-row PK lookup is negligible vs. the cost of a scan. Admin
 *      flips mode -> next scan picks it up with zero invalidation logic.
 *      Acceptance criterion: `grep -ic "cache\|memo"` on this file returns 0.
 *
 *   2. NO SILENT CROSS-ROUTE FALLBACK. When the remote adapter throws (service
 *      outage, OAuth expiry, malformed response), the orchestrator returns a
 *      `degraded` result and DOES NOT call the embedded adapter. Crossing
 *      modes mid-flight would corrupt trend data with mode-mixed scores
 *      (PITFALLS.md #6). The dedicated unit test in this plan asserts the
 *      embedded adapter spy was called 0 times after a remote rejection.
 *
 *   3. ONE MATCH CALL PER SCAN. Phase 15's `calculateBrandScore` is a pure
 *      function over the already-matched `BrandedIssue[]`. The orchestrator
 *      does NOT make a second match call for scoring (PITFALLS.md #10).
 *      Latency cost is one mode read + one match call + one pure calculator
 *      invocation.
 *
 *   4. ServiceClientRegistry IS UNCHANGED. The orchestrator depends on a
 *      constructor-injected RemoteBrandingAdapter, which depends on a
 *      constructor-injected BrandingService, which is built in server.ts
 *      using the existing `getBrandingTokenManager()` getter. Zero new
 *      methods or modifications to the registry.
 */

import type { BrandedIssue, BrandGuideline, MatchableIssue } from '@luqen/branding';
import type { OrgRepository } from '../../db/interfaces/org-repository.js';
import type { ScoreResult } from '../scoring/types.js';
import { calculateBrandScore } from '../scoring/brand-score-calculator.js';
import type { BrandingAdapter } from './branding-adapter.js';
import { RemoteBrandingMalformedError } from './remote-branding-adapter.js';

// ─── Public input shape ─────────────────────────────────────────────────────

export interface MatchAndScoreInput {
  readonly orgId: string;
  readonly siteUrl: string;
  readonly scanId: string;
  readonly issues: readonly MatchableIssue[];
  readonly guideline: BrandGuideline | null;
}

// ─── Public result tagged union ─────────────────────────────────────────────

export type DegradedReason =
  | 'remote-unavailable'    // network error, OAuth failure, 5xx, etc.
  | 'remote-malformed'      // RemoteBrandingMalformedError
  | 'embedded-error';       // embedded adapter threw (rare; covers bugs)

export type MatchAndScoreResult =
  | {
      readonly kind: 'matched';
      readonly mode: 'embedded' | 'remote';
      readonly brandedIssues: readonly BrandedIssue[];
      readonly scoreResult: ScoreResult;
      readonly brandRelatedCount: number;
    }
  | {
      readonly kind: 'degraded';
      readonly mode: 'embedded' | 'remote';
      readonly reason: DegradedReason;
      readonly error: string;
    }
  | {
      readonly kind: 'no-guideline';
      readonly mode: 'embedded' | 'remote';
    };

// ─── Orchestrator ───────────────────────────────────────────────────────────

export class BrandingOrchestrator {
  constructor(
    private readonly orgRepository: OrgRepository,
    private readonly embeddedAdapter: BrandingAdapter,
    private readonly remoteAdapter: BrandingAdapter,
  ) {}

  /**
   * Single dual-mode dispatch + score entry point.
   *
   * Per-request mode read + one match call + one pure score call. NO caching,
   * NO cross-mode fallback. See class JSDoc for the locked invariants.
   */
  async matchAndScore(input: MatchAndScoreInput): Promise<MatchAndScoreResult> {
    // INVARIANT 1: per-request read of orgs.branding_mode. Never cached.
    const mode = await this.orgRepository.getBrandingMode(input.orgId);

    // No-guideline short-circuit. We tag the would-be-mode for observability
    // (an org in `remote` mode with no guideline still went through the
    // remote-mode code path conceptually, even though we never made the call).
    if (input.guideline === null) {
      return { kind: 'no-guideline', mode };
    }

    const adapter = mode === 'remote' ? this.remoteAdapter : this.embeddedAdapter;

    let brandedIssues: readonly BrandedIssue[];
    try {
      // INVARIANT 3: ONE match call. Score is computed from the result, not
      // via a second match round trip. Pitfall #10.
      brandedIssues = await adapter.matchForSite(input.issues, input.guideline, {
        orgId: input.orgId,
        siteUrl: input.siteUrl,
        scanId: input.scanId,
      });
    } catch (err) {
      // INVARIANT 2: degraded — DO NOT call the other adapter. The mode tag
      // tells downstream consumers (Phase 18 persistence, Phase 20 UI) which
      // mode the failure originated from so trend lines can render dashed
      // segments correctly (PITFALLS.md #6).
      const reason: DegradedReason =
        mode === 'embedded'
          ? 'embedded-error'
          : err instanceof RemoteBrandingMalformedError
            ? 'remote-malformed'
            : 'remote-unavailable';
      return {
        kind: 'degraded',
        mode,
        reason,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // INVARIANT 3 (cont.): pure calculator over already-matched data.
    const scoreResult = calculateBrandScore(brandedIssues, input.guideline);

    // brandRelatedCount: pre-computed here so Phase 18 persistence and
    // Phase 20 report panel (BSTORE-05 "X of Y issues are on brand elements")
    // don't need to walk the array a second time.
    let brandRelatedCount = 0;
    for (const b of brandedIssues) {
      if (b.brandMatch.matched === true) brandRelatedCount++;
    }

    return {
      kind: 'matched',
      mode,
      brandedIssues,
      scoreResult,
      brandRelatedCount,
    };
  }
}

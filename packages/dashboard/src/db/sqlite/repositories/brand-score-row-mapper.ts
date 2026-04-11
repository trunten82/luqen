/**
 * Shared row-to-ScoreResult mapper used by BOTH:
 *  - SqliteBrandScoreRepository.rowToScoreResult (Phase 16-02)
 *  - SqliteScanRepository.getTrendData LEFT JOIN reconstruction (Phase 18-05)
 *
 * Factored out so the tagged-union reconstruction lives in exactly one place.
 * If a future phase adds a new dimension, both consumers get it for free.
 *
 * Phase 16-02 decision (D-13 aware predicate):
 *   isTopLevelScored = row.overall !== null && row.subscore_details !== null
 * The per-dimension score columns (color_contrast, typography, components) are
 * denormalized caches; a scored top-level result may legitimately have NULL on
 * any one of them when the nested SubScore for that dimension is unscorable.
 * The subscore_details JSON is the authoritative per-dimension source on read.
 */

import type {
  ScoreResult,
  SubScore,
  CoverageProfile,
  UnscorableReason,
} from '../../../services/scoring/types.js';

// ---------------------------------------------------------------------------
// UnscorableReason literal whitelist (D-15 — defensive guard against schema
// drift; the SQLite column is plain TEXT so a bad write would otherwise be
// silently round-tripped)
// ---------------------------------------------------------------------------

export const KNOWN_UNSCORABLE_REASONS: ReadonlySet<UnscorableReason> = new Set<UnscorableReason>([
  'no-guideline',
  'empty-guideline',
  'no-branded-issues',
  'no-typography-data',
  'no-component-tokens',
  'all-subs-unscorable',
]);

export function assertUnscorableReason(value: string | null): UnscorableReason {
  if (value === null) {
    throw new Error('brand_scores row has NULL score columns but NULL unscorable_reason');
  }
  if (!KNOWN_UNSCORABLE_REASONS.has(value as UnscorableReason)) {
    throw new Error(`brand_scores row has unknown unscorable_reason: ${value}`);
  }
  return value as UnscorableReason;
}

/**
 * The minimal row shape needed for ScoreResult reconstruction. Both the direct
 * brand_scores SELECT (BrandScoreRow) and the scan-repository LEFT JOIN row
 * (ScanRowWithBrandScore) must provide these 4 columns under these exact names.
 *
 * Note: `coverage_profile` is declared `string | null` here to accommodate the
 * LEFT JOIN NULL case — the scan-repository caller must handle `brand_row_id IS
 * NULL` BEFORE invoking this mapper, so by the time we're here a scored row is
 * guaranteed to have a non-null coverage_profile. The function throws if a
 * scored row is missing coverage_profile to catch schema drift defensively.
 */
export interface BrandScoreRowLike {
  readonly overall: number | null;
  readonly subscore_details: string | null;
  readonly unscorable_reason: string | null;
  readonly coverage_profile: string | null;
}

export function brandScoreRowToResult(row: BrandScoreRowLike): ScoreResult {
  // A row is a top-level "scored" ScoreResult iff `overall` AND `subscore_details`
  // are both non-null. The per-dimension score columns (color_contrast, typography,
  // components) are denormalized caches of `subscore_details.*.value` for the
  // scored-sub case and are legitimately NULL when a nested sub-score is itself
  // unscorable (Phase 15 D-13 — the discriminated-union `SubScore` allows any
  // dimension to be unscorable inside an otherwise scored top-level result).
  // `subscore_details` is the authoritative per-dimension source on read.
  const isTopLevelScored = row.overall !== null && row.subscore_details !== null;

  if (!isTopLevelScored) {
    return {
      kind: 'unscorable',
      reason: assertUnscorableReason(row.unscorable_reason),
    };
  }

  // Type-narrowing assertions (already proven by the conjunction above)
  const overall = row.overall as number;
  const subscoreDetails = JSON.parse(row.subscore_details as string) as {
    readonly color: SubScore;
    readonly typography: SubScore;
    readonly components: SubScore;
  };

  if (row.coverage_profile === null) {
    throw new Error(
      'brand_scores row claims scored but coverage_profile is NULL — schema invariant violated',
    );
  }
  const coverage = JSON.parse(row.coverage_profile) as CoverageProfile;

  return {
    kind: 'scored',
    overall,
    color: subscoreDetails.color,
    typography: subscoreDetails.typography,
    components: subscoreDetails.components,
    coverage,
  };
}

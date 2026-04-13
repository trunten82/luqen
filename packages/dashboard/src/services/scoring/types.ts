/**
 * Brand score type contract for v2.11.0.
 *
 * Phase 15 lock: every place a number might be missing, use a discriminated
 * union — NEVER `number | null`, NEVER `null → 0` coercion. Absence of data is
 * `unscorable` with a `reason`. Zero is a legitimate score only when there is
 * at least one data point and all of it failed.
 *
 * Locked by CONTEXT decisions D-12 (ScoreResult), D-13 (SubScore),
 * D-14 (CoverageProfile), D-15 (UnscorableReason), D-16 (no number | null).
 */

// ---------------------------------------------------------------------------
// Unscorable reasons (D-15)
// ---------------------------------------------------------------------------

export type UnscorableReason =
  | 'no-guideline'
  | 'empty-guideline'
  | 'no-branded-issues'
  | 'no-typography-data'
  | 'no-component-tokens'
  | 'all-subs-unscorable';

// ---------------------------------------------------------------------------
// Per-dimension detail shapes (each discriminated by `dimension`)
// ---------------------------------------------------------------------------

export interface ColorSubScoreDetail {
  readonly dimension: 'color';
  readonly passes: number;
  readonly fails: number;
}

export interface TypographySubScoreDetail {
  readonly dimension: 'typography';
  readonly fontOk: boolean;
  readonly sizeOk: boolean;
  readonly lineHeightOk: boolean;
}

export interface ComponentsSubScoreDetail {
  readonly dimension: 'components';
  readonly matched: number;
  readonly total: number;
}

export type SubScoreDetail =
  | ColorSubScoreDetail
  | TypographySubScoreDetail
  | ComponentsSubScoreDetail;

// ---------------------------------------------------------------------------
// Sub-score tagged union (D-13)
// ---------------------------------------------------------------------------

export type SubScore =
  | { readonly kind: 'scored'; readonly value: number; readonly detail: SubScoreDetail }
  | { readonly kind: 'unscorable'; readonly reason: UnscorableReason };

// ---------------------------------------------------------------------------
// Coverage profile (D-14)
// ---------------------------------------------------------------------------

export interface CoverageProfile {
  readonly color: boolean;          // did we have any contrast issues to score?
  readonly typography: boolean;     // did we extract any typography data?
  readonly components: boolean;     // did guideline.colors[] have entries?
  readonly contributingWeight: number; // sum of weights for scored sub-scores (0..1)
}

// ---------------------------------------------------------------------------
// Top-level score result (D-12)
// ---------------------------------------------------------------------------

export type ScoreResult =
  | {
      readonly kind: 'scored';
      readonly overall: number;
      readonly color: SubScore;
      readonly typography: SubScore;
      readonly components: SubScore;
      readonly coverage: CoverageProfile;
    }
  | { readonly kind: 'unscorable'; readonly reason: UnscorableReason };

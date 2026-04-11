import type { ScoreResult } from '../../services/scoring/types.js';

/**
 * Per-row metadata supplied by the caller (Phase 17 orchestrator / Phase 18
 * scanner) alongside a ScoreResult on insert. The ScoreResult itself does NOT
 * carry scan / org / site identifiers — those live on the calling context and
 * are passed in here so the repository can populate the FK + index columns
 * declared by migration 043.
 *
 * `mode` is constrained to the same literal pair as the schema CHECK
 * constraint on `brand_scores.mode` — Phase 17 is the only writer that needs
 * to choose between them.
 */
export interface BrandScoreScanContext {
  readonly scanId: string;
  readonly orgId: string;
  readonly siteUrl: string;
  readonly guidelineId?: string;
  readonly guidelineVersion?: number;
  readonly mode: 'embedded' | 'remote';
  readonly brandRelatedCount: number;
  readonly totalIssues: number;
}

/**
 * One row of brand_scores history for a given site, mapped back to the typed
 * ScoreResult contract. `computedAt` is an ISO-8601 string (the same TEXT
 * representation used everywhere else in the dashboard storage layer).
 */
export interface BrandScoreHistoryEntry {
  readonly computedAt: string;
  readonly result: ScoreResult;
}

/**
 * Append-only repository over the brand_scores table.
 *
 * Contract notes:
 * - `insert` is the ONLY write path. There is intentionally NO update method:
 *   retags and re-scans append a new row, preserving the trend history. This
 *   matches PROJECT.md decision "no backfill, append-only" and BSTORE-03.
 * - `getLatestForScan` returns `null` when no row exists for the scan_id —
 *   this is distinct from a row whose ScoreResult kind is 'unscorable'.
 *   Callers MUST distinguish "no score recorded" from "score recorded as
 *   unscorable" because pre-v2.11.0 scans fall into the former bucket.
 * - `getHistoryForSite` returns rows ordered by `computedAt DESC` (newest
 *   first) and respects the supplied limit. Callers that want chronological
 *   order can `.slice().reverse()`.
 */
export interface BrandScoreRepository {
  /**
   * Append a new brand_scores row for a completed (or retagged) scan.
   * Persists the full ScoreResult — including per-dimension SubScoreDetail —
   * via the subscore_details JSON column added in migration 043.
   */
  insert(result: ScoreResult, context: BrandScoreScanContext): Promise<void>;

  /**
   * Returns the most recent brand_scores row for the given scan_id, or `null`
   * if no row exists. A returned ScoreResult may itself be `unscorable` —
   * that is a successful read of an unscorable scan, NOT the same as `null`.
   */
  getLatestForScan(scanId: string): Promise<ScoreResult | null>;

  /**
   * Returns up to `limit` rows of history for the given (orgId, siteUrl)
   * pair, ordered by computedAt DESC. Used by Phase 21 dashboard widget for
   * trend rendering.
   */
  getHistoryForSite(
    orgId: string,
    siteUrl: string,
    limit: number,
  ): Promise<readonly BrandScoreHistoryEntry[]>;
}

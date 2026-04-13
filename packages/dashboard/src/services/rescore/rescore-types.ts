/**
 * Types for the historical rescore engine (Phase 27).
 *
 * The rescore processes completed scans in batches, recalculating brand scores
 * using the embedded calculator. Progress is tracked in a database table for
 * resumability across server restarts.
 */

export type RescoreStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RescoreProgress {
  readonly id: string;
  readonly orgId: string;
  readonly status: RescoreStatus;
  readonly totalScans: number;
  readonly processedScans: number;
  readonly scoredCount: number;
  readonly skippedCount: number;
  readonly warningCount: number;
  readonly lastProcessedScanId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RescoreResult {
  readonly scored: number;
  readonly skipped: number;
  readonly warnings: number;
}

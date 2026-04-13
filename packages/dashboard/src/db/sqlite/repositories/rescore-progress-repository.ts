import type Database from 'better-sqlite3';
import type { RescoreProgressRepository } from '../../interfaces/rescore-progress-repository.js';
import type { RescoreProgress, RescoreStatus } from '../../../services/rescore/rescore-types.js';

// ---------------------------------------------------------------------------
// Private row type — mirrors rescore_progress column layout from migration 046
// ---------------------------------------------------------------------------

interface RescoreProgressRow {
  id: string;
  org_id: string;
  status: string;
  total_scans: number;
  processed_scans: number;
  scored_count: number;
  skipped_count: number;
  warning_count: number;
  last_processed_scan_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Row -> RescoreProgress mapping
// ---------------------------------------------------------------------------

function rowToProgress(row: RescoreProgressRow): RescoreProgress {
  return {
    id: row.id,
    orgId: row.org_id,
    status: row.status as RescoreStatus,
    totalScans: row.total_scans,
    processedScans: row.processed_scans,
    scoredCount: row.scored_count,
    skippedCount: row.skipped_count,
    warningCount: row.warning_count,
    lastProcessedScanId: row.last_processed_scan_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// SQL statements
// ---------------------------------------------------------------------------

const SELECT_BY_ORG_SQL = `
SELECT * FROM rescore_progress WHERE org_id = ?
`;

const UPSERT_SQL = `
INSERT OR REPLACE INTO rescore_progress (
  id, org_id, status, total_scans, processed_scans,
  scored_count, skipped_count, warning_count,
  last_processed_scan_id, error, created_at, updated_at
) VALUES (
  @id, @org_id, @status, @total_scans, @processed_scans,
  @scored_count, @skipped_count, @warning_count,
  @last_processed_scan_id, @error, @created_at, @updated_at
)
`;

const DELETE_BY_ORG_SQL = `
DELETE FROM rescore_progress WHERE org_id = ?
`;

// ---------------------------------------------------------------------------
// SqliteRescoreProgressRepository
// ---------------------------------------------------------------------------

export class SqliteRescoreProgressRepository implements RescoreProgressRepository {
  constructor(private readonly db: Database.Database) {}

  async getByOrgId(orgId: string): Promise<RescoreProgress | null> {
    const row = this.db.prepare(SELECT_BY_ORG_SQL).get(orgId) as RescoreProgressRow | undefined;
    if (row === undefined) {
      return null;
    }
    return rowToProgress(row);
  }

  async upsert(progress: RescoreProgress): Promise<void> {
    this.db.prepare(UPSERT_SQL).run({
      id: progress.id,
      org_id: progress.orgId,
      status: progress.status,
      total_scans: progress.totalScans,
      processed_scans: progress.processedScans,
      scored_count: progress.scoredCount,
      skipped_count: progress.skippedCount,
      warning_count: progress.warningCount,
      last_processed_scan_id: progress.lastProcessedScanId,
      error: progress.error,
      created_at: progress.createdAt,
      updated_at: progress.updatedAt,
    });
  }

  async deleteByOrgId(orgId: string): Promise<void> {
    this.db.prepare(DELETE_BY_ORG_SQL).run(orgId);
  }
}

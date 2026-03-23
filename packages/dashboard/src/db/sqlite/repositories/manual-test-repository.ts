import type Database from 'better-sqlite3';
import type { ManualTestRepository } from '../../interfaces/manual-test-repository.js';
import type { ManualTestResult, ManualTestStatus, UpsertManualTestInput } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type
// ---------------------------------------------------------------------------

interface ManualTestRow {
  id: string;
  scan_id: string;
  criterion_id: string;
  status: string;
  notes: string | null;
  tested_by: string | null;
  tested_at: string | null;
  org_id: string;
}

function rowToRecord(row: ManualTestRow): ManualTestResult {
  return {
    id: row.id,
    scanId: row.scan_id,
    criterionId: row.criterion_id,
    status: row.status as ManualTestStatus,
    notes: row.notes,
    testedBy: row.tested_by,
    testedAt: row.tested_at,
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// SqliteManualTestRepository
// ---------------------------------------------------------------------------

export class SqliteManualTestRepository implements ManualTestRepository {
  constructor(private readonly db: Database.Database) {}

  async getManualTests(scanId: string): Promise<ManualTestResult[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM manual_test_results WHERE scan_id = ? ORDER BY criterion_id',
    );
    const rows = stmt.all(scanId) as ManualTestRow[];
    return rows.map(rowToRecord);
  }

  async upsertManualTest(data: UpsertManualTestInput): Promise<ManualTestResult> {
    const now = new Date().toISOString();
    const id = `mt-${data.scanId}-${data.criterionId}`;

    const stmt = this.db.prepare(`
      INSERT INTO manual_test_results (id, scan_id, criterion_id, status, notes, tested_by, tested_at, org_id)
      VALUES (@id, @scanId, @criterionId, @status, @notes, @testedBy, @testedAt, @orgId)
      ON CONFLICT (scan_id, criterion_id)
      DO UPDATE SET status = @status, notes = @notes, tested_by = @testedBy, tested_at = @testedAt
    `);

    stmt.run({
      id,
      scanId: data.scanId,
      criterionId: data.criterionId,
      status: data.status,
      notes: data.notes ?? null,
      testedBy: data.testedBy ?? null,
      testedAt: data.testedAt ?? now,
      orgId: data.orgId ?? 'system',
    });

    return {
      id,
      scanId: data.scanId,
      criterionId: data.criterionId,
      status: data.status,
      notes: data.notes ?? null,
      testedBy: data.testedBy ?? null,
      testedAt: data.testedAt ?? now,
      orgId: data.orgId ?? 'system',
    };
  }
}

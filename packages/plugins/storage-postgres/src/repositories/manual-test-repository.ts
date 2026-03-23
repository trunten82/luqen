import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ManualTestStatus = 'untested' | 'pass' | 'fail' | 'na';

interface ManualTestResult {
  readonly id: string;
  readonly scanId: string;
  readonly criterionId: string;
  readonly status: ManualTestStatus;
  readonly notes: string | null;
  readonly testedBy: string | null;
  readonly testedAt: string | null;
  readonly orgId: string;
}

interface UpsertManualTestInput {
  readonly scanId: string;
  readonly criterionId: string;
  readonly status: ManualTestStatus;
  readonly notes?: string | null;
  readonly testedBy?: string | null;
  readonly testedAt?: string | null;
  readonly orgId?: string;
}

interface ManualTestRepository {
  getManualTests(scanId: string): Promise<ManualTestResult[]>;
  upsertManualTest(data: UpsertManualTestInput): Promise<ManualTestResult>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface ManualTestRow {
  id: string;
  scan_id: string;
  criterion_id: string;
  status: string;
  notes: string | null;
  tested_by: string | null;
  tested_at: string | Date | null;
  org_id: string;
}

function toIsoOrNull(val: string | Date | null): string | null {
  if (val === null) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function rowToRecord(row: ManualTestRow): ManualTestResult {
  return {
    id: row.id,
    scanId: row.scan_id,
    criterionId: row.criterion_id,
    status: row.status as ManualTestStatus,
    notes: row.notes,
    testedBy: row.tested_by,
    testedAt: toIsoOrNull(row.tested_at),
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// PgManualTestRepository
// ---------------------------------------------------------------------------

export class PgManualTestRepository implements ManualTestRepository {
  constructor(private readonly pool: pg.Pool) {}

  async getManualTests(scanId: string): Promise<ManualTestResult[]> {
    const result = await this.pool.query<ManualTestRow>(
      'SELECT * FROM manual_test_results WHERE scan_id = $1 ORDER BY criterion_id',
      [scanId],
    );
    return result.rows.map(rowToRecord);
  }

  async upsertManualTest(data: UpsertManualTestInput): Promise<ManualTestResult> {
    const now = new Date().toISOString();
    const id = `mt-${data.scanId}-${data.criterionId}`;

    await this.pool.query(
      `INSERT INTO manual_test_results (id, scan_id, criterion_id, status, notes, tested_by, tested_at, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (scan_id, criterion_id)
       DO UPDATE SET status = $4, notes = $5, tested_by = $6, tested_at = $7`,
      [
        id,
        data.scanId,
        data.criterionId,
        data.status,
        data.notes ?? null,
        data.testedBy ?? null,
        data.testedAt ?? now,
        data.orgId ?? 'system',
      ],
    );

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

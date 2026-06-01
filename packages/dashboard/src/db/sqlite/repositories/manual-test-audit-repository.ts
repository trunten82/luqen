import type Database from 'better-sqlite3';
import type { ManualTestAuditRepository } from '../../interfaces/manual-test-audit-repository.js';
import type {
  AppendManualTestAuditInput,
  ManualTestAuditRecord,
} from '../../types.js';

interface AuditRow {
  id: string;
  scan_id: string;
  criterion_id: string;
  from_status: string | null;
  to_status: string;
  comment: string | null;
  actor: string | null;
  created_at: string;
  org_id: string;
}

function rowToRecord(row: AuditRow): ManualTestAuditRecord {
  return {
    id: row.id,
    scanId: row.scan_id,
    criterionId: row.criterion_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    comment: row.comment,
    actor: row.actor,
    createdAt: row.created_at,
    orgId: row.org_id,
  };
}

export class SqliteManualTestAuditRepository implements ManualTestAuditRepository {
  constructor(private readonly db: Database.Database) {}

  async appendAudit(data: AppendManualTestAuditInput): Promise<ManualTestAuditRecord> {
    const now = new Date().toISOString();
    const id = `mta-${data.scanId}-${data.criterionId}-${now.replace(/[^0-9]/g, '')}-${Math.floor(Math.random() * 1e6)}`;
    const record: ManualTestAuditRecord = {
      id,
      scanId: data.scanId,
      criterionId: data.criterionId,
      fromStatus: data.fromStatus ?? null,
      toStatus: data.toStatus,
      comment: data.comment ?? null,
      actor: data.actor ?? null,
      createdAt: data.createdAt ?? now,
      orgId: data.orgId ?? 'system',
    };
    this.db
      .prepare(
        `INSERT INTO manual_test_audit
           (id, scan_id, criterion_id, from_status, to_status, comment, actor, created_at, org_id)
         VALUES (@id, @scanId, @criterionId, @fromStatus, @toStatus, @comment, @actor, @createdAt, @orgId)`,
      )
      .run(record);
    return record;
  }

  async listAudit(scanId: string): Promise<ManualTestAuditRecord[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM manual_test_audit WHERE scan_id = ? ORDER BY created_at DESC',
      )
      .all(scanId) as AuditRow[];
    return rows.map(rowToRecord);
  }

  async countReasonedChanges(scanId: string): Promise<number> {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM manual_test_audit WHERE scan_id = ? AND comment IS NOT NULL AND TRIM(comment) <> ''",
      )
      .get(scanId) as { n: number } | undefined;
    return row?.n ?? 0;
  }
}

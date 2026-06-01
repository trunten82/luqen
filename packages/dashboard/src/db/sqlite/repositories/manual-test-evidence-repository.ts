import type Database from 'better-sqlite3';
import type { ManualTestEvidenceRepository } from '../../interfaces/manual-test-evidence-repository.js';
import type {
  AddManualTestEvidenceInput,
  CriterionEvidenceCount,
  ManualTestEvidenceRecord,
} from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type
// ---------------------------------------------------------------------------

interface EvidenceRow {
  id: string;
  scan_id: string;
  criterion_id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  org_id: string;
}

function rowToRecord(row: EvidenceRow): ManualTestEvidenceRecord {
  return {
    id: row.id,
    scanId: row.scan_id,
    criterionId: row.criterion_id,
    filePath: row.file_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// SqliteManualTestEvidenceRepository
// ---------------------------------------------------------------------------

export class SqliteManualTestEvidenceRepository implements ManualTestEvidenceRepository {
  constructor(private readonly db: Database.Database) {}

  async listEvidence(scanId: string): Promise<ManualTestEvidenceRecord[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM manual_test_evidence WHERE scan_id = ? ORDER BY criterion_id, uploaded_at',
      )
      .all(scanId) as EvidenceRow[];
    return rows.map(rowToRecord);
  }

  async getEvidence(id: string): Promise<ManualTestEvidenceRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM manual_test_evidence WHERE id = ?')
      .get(id) as EvidenceRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async addEvidence(data: AddManualTestEvidenceInput): Promise<ManualTestEvidenceRecord> {
    const now = new Date().toISOString();
    // Unique, collision-resistant id without pulling in a uuid dependency.
    const id = `mte-${data.scanId}-${data.criterionId}-${now.replace(/[^0-9]/g, '')}-${Math.floor(Math.random() * 1e6)}`;
    const record: ManualTestEvidenceRecord = {
      id,
      scanId: data.scanId,
      criterionId: data.criterionId,
      filePath: data.filePath,
      fileName: data.fileName,
      mimeType: data.mimeType ?? null,
      fileSize: data.fileSize ?? null,
      uploadedBy: data.uploadedBy ?? null,
      uploadedAt: data.uploadedAt ?? now,
      orgId: data.orgId ?? 'system',
    };

    this.db
      .prepare(
        `INSERT INTO manual_test_evidence
           (id, scan_id, criterion_id, file_path, file_name, mime_type, file_size, uploaded_by, uploaded_at, org_id)
         VALUES (@id, @scanId, @criterionId, @filePath, @fileName, @mimeType, @fileSize, @uploadedBy, @uploadedAt, @orgId)`,
      )
      .run(record);

    return record;
  }

  async deleteEvidence(id: string): Promise<boolean> {
    const info = this.db.prepare('DELETE FROM manual_test_evidence WHERE id = ?').run(id);
    return info.changes > 0;
  }

  async countByCriterion(scanId: string): Promise<CriterionEvidenceCount[]> {
    const rows = this.db
      .prepare(
        'SELECT criterion_id AS criterionId, COUNT(*) AS count FROM manual_test_evidence WHERE scan_id = ? GROUP BY criterion_id',
      )
      .all(scanId) as Array<{ criterionId: string; count: number }>;
    return rows.map((r) => ({ criterionId: r.criterionId, count: r.count }));
  }
}

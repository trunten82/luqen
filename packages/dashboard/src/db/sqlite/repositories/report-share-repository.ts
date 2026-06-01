import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ReportShareRepository } from '../../interfaces/report-share-repository.js';
import type { AddReportShareInput, ReportShareRecord } from '../../types.js';

interface ShareRow {
  id: string;
  token: string;
  scan_id: string;
  org_id: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

function rowToRecord(row: ShareRow): ReportShareRecord {
  return {
    id: row.id,
    token: row.token,
    scanId: row.scan_id,
    orgId: row.org_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/** Default lifetime of a share link when the caller does not specify one. */
const DEFAULT_EXPIRY_DAYS = 90;

export class SqliteReportShareRepository implements ReportShareRepository {
  constructor(private readonly db: Database.Database) {}

  async createShare(data: AddReportShareInput): Promise<ReportShareRecord> {
    const now = new Date();
    const nowIso = now.toISOString();
    // 32 random bytes → URL-safe token. Unguessable; the token IS the secret.
    const token = randomBytes(32).toString('base64url');
    const days = data.expiresInDays === undefined ? DEFAULT_EXPIRY_DAYS : data.expiresInDays;
    const expiresAt =
      days === null
        ? null
        : new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

    const record: ReportShareRecord = {
      id: randomUUID(),
      token,
      scanId: data.scanId,
      orgId: data.orgId ?? 'system',
      createdBy: data.createdBy ?? null,
      createdAt: nowIso,
      expiresAt,
      revokedAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO report_shares
           (id, token, scan_id, org_id, created_by, created_at, expires_at, revoked_at)
         VALUES (@id, @token, @scanId, @orgId, @createdBy, @createdAt, @expiresAt, @revokedAt)`,
      )
      .run(record);

    return record;
  }

  async getByToken(token: string): Promise<ReportShareRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM report_shares WHERE token = ?')
      .get(token) as ShareRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async getShare(id: string): Promise<ReportShareRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM report_shares WHERE id = ?')
      .get(id) as ShareRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async listForScan(scanId: string): Promise<ReportShareRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM report_shares WHERE scan_id = ? ORDER BY created_at DESC')
      .all(scanId) as ShareRow[];
    return rows.map(rowToRecord);
  }

  async revoke(id: string): Promise<boolean> {
    const info = this.db
      .prepare('UPDATE report_shares SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), id);
    return info.changes > 0;
  }
}

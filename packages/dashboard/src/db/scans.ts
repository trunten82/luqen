import Database from 'better-sqlite3';
import { MigrationRunner } from './migrations.js';
import type { Migration } from './migrations.js';

export interface ScanRecord {
  readonly id: string;
  readonly siteUrl: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly standard: string;
  readonly jurisdictions: string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly pagesScanned?: number;
  readonly totalIssues?: number;
  readonly errors?: number;
  readonly warnings?: number;
  readonly notices?: number;
  readonly confirmedViolations?: number;
  readonly jsonReportPath?: string;
  readonly error?: string;
}

export interface ScanFilters {
  readonly status?: ScanRecord['status'];
  readonly createdBy?: string;
  readonly siteUrl?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export type ScanUpdateData = Partial<Omit<ScanRecord, 'id' | 'createdBy' | 'createdAt'>>;

interface ScanRow {
  id: string;
  site_url: string;
  status: string;
  standard: string;
  jurisdictions: string;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  pages_scanned: number | null;
  total_issues: number | null;
  errors: number | null;
  warnings: number | null;
  notices: number | null;
  confirmed_violations: number | null;
  json_report_path: string | null;
  error: string | null;
}

function rowToRecord(row: ScanRow): ScanRecord {
  const base: ScanRecord = {
    id: row.id,
    siteUrl: row.site_url,
    status: row.status as ScanRecord['status'],
    standard: row.standard,
    jurisdictions: JSON.parse(row.jurisdictions) as string[],
    createdBy: row.created_by,
    createdAt: row.created_at,
  };

  return {
    ...base,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    ...(row.pages_scanned !== null ? { pagesScanned: row.pages_scanned } : {}),
    ...(row.total_issues !== null ? { totalIssues: row.total_issues } : {}),
    ...(row.errors !== null ? { errors: row.errors } : {}),
    ...(row.warnings !== null ? { warnings: row.warnings } : {}),
    ...(row.notices !== null ? { notices: row.notices } : {}),
    ...(row.confirmed_violations !== null ? { confirmedViolations: row.confirmed_violations } : {}),
    ...(row.json_report_path !== null ? { jsonReportPath: row.json_report_path } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
  };
}

export const DASHBOARD_MIGRATIONS: readonly Migration[] = [
  {
    id: '001',
    name: 'create-scan-records',
    sql: `
CREATE TABLE IF NOT EXISTS scan_records (
  id TEXT PRIMARY KEY,
  site_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  standard TEXT NOT NULL DEFAULT 'WCAG2AA',
  jurisdictions TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  pages_scanned INTEGER,
  total_issues INTEGER,
  errors INTEGER,
  warnings INTEGER,
  notices INTEGER,
  confirmed_violations INTEGER,
  json_report_path TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_records_status ON scan_records(status);
CREATE INDEX IF NOT EXISTS idx_scan_records_created_by ON scan_records(created_by);
CREATE INDEX IF NOT EXISTS idx_scan_records_site_url ON scan_records(site_url);
CREATE INDEX IF NOT EXISTS idx_scan_records_created_at ON scan_records(created_at);
    `,
  },
];

export class ScanDb {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  initialize(): void {
    new MigrationRunner(this.db).run(DASHBOARD_MIGRATIONS);
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  createScan(data: {
    id: string;
    siteUrl: string;
    standard: string;
    jurisdictions: string[];
    createdBy: string;
    createdAt: string;
  }): ScanRecord {
    const stmt = this.db.prepare(`
      INSERT INTO scan_records (id, site_url, status, standard, jurisdictions, created_by, created_at)
      VALUES (@id, @siteUrl, 'queued', @standard, @jurisdictions, @createdBy, @createdAt)
    `);

    stmt.run({
      id: data.id,
      siteUrl: data.siteUrl,
      standard: data.standard,
      jurisdictions: JSON.stringify(data.jurisdictions),
      createdBy: data.createdBy,
      createdAt: data.createdAt,
    });

    const created = this.getScan(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve scan record after creation: ${data.id}`);
    }
    return created;
  }

  getScan(id: string): ScanRecord | null {
    const stmt = this.db.prepare('SELECT * FROM scan_records WHERE id = ?');
    const row = stmt.get(id) as ScanRow | undefined;
    return row !== undefined ? rowToRecord(row) : null;
  }

  listScans(filters: ScanFilters = {}): ScanRecord[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.status !== undefined) {
      conditions.push('status = @status');
      params['status'] = filters.status;
    }
    if (filters.createdBy !== undefined) {
      conditions.push('created_by = @createdBy');
      params['createdBy'] = filters.createdBy;
    }
    if (filters.siteUrl !== undefined) {
      conditions.push('site_url LIKE @siteUrl');
      params['siteUrl'] = `%${filters.siteUrl}%`;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit !== undefined ? `LIMIT ${filters.limit}` : '';
    const offset = filters.offset !== undefined ? `OFFSET ${filters.offset}` : '';

    const sql = `SELECT * FROM scan_records ${where} ORDER BY created_at DESC ${limit} ${offset}`.trim();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as ScanRow[];
    return rows.map(rowToRecord);
  }

  updateScan(id: string, data: ScanUpdateData): ScanRecord {
    const fieldMap: Record<string, string> = {
      status: 'status',
      siteUrl: 'site_url',
      standard: 'standard',
      completedAt: 'completed_at',
      pagesScanned: 'pages_scanned',
      totalIssues: 'total_issues',
      errors: 'errors',
      warnings: 'warnings',
      notices: 'notices',
      confirmedViolations: 'confirmed_violations',
      jsonReportPath: 'json_report_path',
      error: 'error',
    };

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      const col = fieldMap[key];
      if (col === undefined) continue;
      setClauses.push(`${col} = @${key}`);
      params[key] = key === 'jurisdictions' && Array.isArray(value)
        ? JSON.stringify(value)
        : value;
    }

    if (setClauses.length === 0) {
      const existing = this.getScan(id);
      if (existing === null) {
        throw new Error(`Scan record not found: ${id}`);
      }
      return existing;
    }

    const stmt = this.db.prepare(
      `UPDATE scan_records SET ${setClauses.join(', ')} WHERE id = @id`
    );
    stmt.run(params);

    const updated = this.getScan(id);
    if (updated === null) {
      throw new Error(`Scan record not found after update: ${id}`);
    }
    return updated;
  }

  deleteScan(id: string): void {
    const stmt = this.db.prepare('DELETE FROM scan_records WHERE id = ?');
    stmt.run(id);
  }

  close(): void {
    this.db.close();
  }
}

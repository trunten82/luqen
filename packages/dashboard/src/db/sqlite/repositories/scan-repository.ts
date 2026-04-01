import type Database from 'better-sqlite3';
import type { ScanRepository } from '../../interfaces/scan-repository.js';
import type { ScanRecord, ScanFilters, ScanUpdateData, CreateScanInput } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type and conversion
// ---------------------------------------------------------------------------

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
  json_report: string | null;
  error: string | null;
  org_id: string;
  branding_guideline_id: string | null;
  branding_guideline_version: number | null;
  brand_related_count: number | null;
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
    orgId: row.org_id,
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
    ...(row.json_report !== null ? { jsonReport: row.json_report } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    ...(row.branding_guideline_id !== null ? { brandingGuidelineId: row.branding_guideline_id } : {}),
    ...(row.branding_guideline_version !== null ? { brandingGuidelineVersion: row.branding_guideline_version } : {}),
    ...(row.brand_related_count !== null ? { brandRelatedCount: row.brand_related_count } : {}),
  };
}

// ---------------------------------------------------------------------------
// Filter builder (shared by listScans and countScans)
// ---------------------------------------------------------------------------

function buildFilterQuery(filters: ScanFilters): { where: string; params: Record<string, unknown> } {
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
  if (filters.orgId !== undefined) {
    conditions.push('org_id = @orgId');
    params['orgId'] = filters.orgId;
  }
  if (filters.from !== undefined) {
    conditions.push('created_at >= @from');
    params['from'] = filters.from;
  }
  if (filters.to !== undefined) {
    conditions.push('created_at <= @to');
    params['to'] = filters.to;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// ---------------------------------------------------------------------------
// SqliteScanRepository
// ---------------------------------------------------------------------------

export class SqliteScanRepository implements ScanRepository {
  constructor(private readonly db: Database.Database) {}

  async createScan(data: CreateScanInput): Promise<ScanRecord> {
    const stmt = this.db.prepare(`
      INSERT INTO scan_records (id, site_url, status, standard, jurisdictions, created_by, created_at, org_id)
      VALUES (@id, @siteUrl, 'queued', @standard, @jurisdictions, @createdBy, @createdAt, @orgId)
    `);

    stmt.run({
      id: data.id,
      siteUrl: data.siteUrl,
      standard: data.standard,
      jurisdictions: JSON.stringify(data.jurisdictions),
      createdBy: data.createdBy,
      createdAt: data.createdAt,
      orgId: data.orgId ?? 'system',
    });

    const created = await this.getScan(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve scan record after creation: ${data.id}`);
    }
    return created;
  }

  async getScan(id: string): Promise<ScanRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM scan_records WHERE id = ?');
    const row = stmt.get(id) as ScanRow | undefined;
    return row !== undefined ? rowToRecord(row) : null;
  }

  async listScans(filters: ScanFilters = {}): Promise<ScanRecord[]> {
    const { where, params } = buildFilterQuery(filters);
    const limit = filters.limit !== undefined ? `LIMIT ${filters.limit}` : '';
    const offset = filters.offset !== undefined ? `OFFSET ${filters.offset}` : '';

    const sql = `SELECT * FROM scan_records ${where} ORDER BY created_at DESC ${limit} ${offset}`.trim();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as ScanRow[];
    return rows.map(rowToRecord);
  }

  async countScans(filters: ScanFilters = {}): Promise<number> {
    const { where, params } = buildFilterQuery(filters);
    const sql = `SELECT COUNT(*) as count FROM scan_records ${where}`;
    const row = this.db.prepare(sql).get(params) as { count: number };
    return row.count;
  }

  async updateScan(id: string, data: ScanUpdateData): Promise<ScanRecord> {
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
      jsonReport: 'json_report',
      error: 'error',
      brandingGuidelineId: 'branding_guideline_id',
      brandingGuidelineVersion: 'branding_guideline_version',
      brandRelatedCount: 'brand_related_count',
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
      const existing = await this.getScan(id);
      if (existing === null) {
        throw new Error(`Scan record not found: ${id}`);
      }
      return existing;
    }

    const stmt = this.db.prepare(
      `UPDATE scan_records SET ${setClauses.join(', ')} WHERE id = @id`,
    );
    stmt.run(params);

    const updated = await this.getScan(id);
    if (updated === null) {
      throw new Error(`Scan record not found after update: ${id}`);
    }
    return updated;
  }

  async deleteScan(id: string): Promise<void> {
    this.db.prepare('DELETE FROM scan_records WHERE id = ?').run(id);
  }

  async deleteOrgScans(orgId: string): Promise<void> {
    this.db.prepare('DELETE FROM scan_records WHERE org_id = ?').run(orgId);
  }

  async getReport(id: string): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare('SELECT json_report FROM scan_records WHERE id = ?').get(id) as { json_report: string | null } | undefined;
    if (row === undefined || row.json_report === null) return null;
    try {
      return JSON.parse(row.json_report) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async getTrendData(orgId?: string): Promise<ScanRecord[]> {
    const conditions = ["status = 'completed'"];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM scan_records ${where} ORDER BY created_at ASC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as ScanRow[];
    return rows.map(rowToRecord);
  }

  async getLatestPerSite(orgId: string): Promise<ScanRecord[]> {
    const sql = `
      SELECT sr.* FROM scan_records sr
      INNER JOIN (
        SELECT site_url, MAX(created_at) as max_created_at
        FROM scan_records
        WHERE org_id = @orgId AND status = 'completed'
        GROUP BY site_url
      ) latest ON sr.site_url = latest.site_url AND sr.created_at = latest.max_created_at
      WHERE sr.org_id = @orgId AND sr.status = 'completed'
      ORDER BY sr.created_at DESC
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ orgId }) as ScanRow[];
    return rows.map(rowToRecord);
  }
}

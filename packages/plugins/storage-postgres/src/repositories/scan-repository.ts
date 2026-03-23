import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types (local copies — compatible with dashboard interfaces)
// ---------------------------------------------------------------------------

interface ScanRecord {
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
  readonly jsonReport?: string;
  readonly error?: string;
  readonly orgId: string;
}

interface ScanFilters {
  readonly status?: ScanRecord['status'];
  readonly createdBy?: string;
  readonly siteUrl?: string;
  readonly orgId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly from?: string;
  readonly to?: string;
}

type ScanUpdateData = Partial<Omit<ScanRecord, 'id' | 'createdBy' | 'createdAt'>>;

interface CreateScanInput {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly jurisdictions: string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly orgId?: string;
}

interface ScanRepository {
  createScan(data: CreateScanInput): Promise<ScanRecord>;
  getScan(id: string): Promise<ScanRecord | null>;
  listScans(filters?: ScanFilters): Promise<ScanRecord[]>;
  countScans(filters?: ScanFilters): Promise<number>;
  updateScan(id: string, data: ScanUpdateData): Promise<ScanRecord>;
  deleteScan(id: string): Promise<void>;
  deleteOrgScans(orgId: string): Promise<void>;
  getReport(id: string): Promise<Record<string, unknown> | null>;
  getTrendData(orgId?: string): Promise<ScanRecord[]>;
  getLatestPerSite(orgId: string): Promise<ScanRecord[]>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface ScanRow {
  id: string;
  site_url: string;
  status: string;
  standard: string;
  jurisdictions: string[] | string;
  created_by: string;
  created_at: string | Date;
  completed_at: string | Date | null;
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
}

function toIso(val: string | Date | null | undefined): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function rowToRecord(row: ScanRow): ScanRecord {
  const jurisdictions = Array.isArray(row.jurisdictions)
    ? row.jurisdictions
    : JSON.parse(row.jurisdictions as string) as string[];

  const base: ScanRecord = {
    id: row.id,
    siteUrl: row.site_url,
    status: row.status as ScanRecord['status'],
    standard: row.standard,
    jurisdictions,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at)!,
    orgId: row.org_id,
  };

  return {
    ...base,
    ...(row.completed_at !== null ? { completedAt: toIso(row.completed_at) } : {}),
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

// ---------------------------------------------------------------------------
// Filter builder
// ---------------------------------------------------------------------------

function buildFilterQuery(filters: ScanFilters): { where: string; params: unknown[]; paramIndex: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status !== undefined) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.createdBy !== undefined) {
    conditions.push(`created_by = $${idx++}`);
    params.push(filters.createdBy);
  }
  if (filters.siteUrl !== undefined) {
    conditions.push(`site_url LIKE $${idx++}`);
    params.push(`%${filters.siteUrl}%`);
  }
  if (filters.orgId !== undefined) {
    conditions.push(`org_id = $${idx++}`);
    params.push(filters.orgId);
  }
  if (filters.from !== undefined) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.from);
  }
  if (filters.to !== undefined) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params, paramIndex: idx };
}

// ---------------------------------------------------------------------------
// PgScanRepository
// ---------------------------------------------------------------------------

export class PgScanRepository implements ScanRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createScan(data: CreateScanInput): Promise<ScanRecord> {
    await this.pool.query(
      `INSERT INTO scan_records (id, site_url, status, standard, jurisdictions, created_by, created_at, org_id)
       VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7)`,
      [data.id, data.siteUrl, data.standard, JSON.stringify(data.jurisdictions), data.createdBy, data.createdAt, data.orgId ?? 'system'],
    );

    const created = await this.getScan(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve scan record after creation: ${data.id}`);
    }
    return created;
  }

  async getScan(id: string): Promise<ScanRecord | null> {
    const result = await this.pool.query<ScanRow>('SELECT * FROM scan_records WHERE id = $1', [id]);
    return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null;
  }

  async listScans(filters: ScanFilters = {}): Promise<ScanRecord[]> {
    const { where, params, paramIndex } = buildFilterQuery(filters);
    let sql = `SELECT * FROM scan_records ${where} ORDER BY created_at DESC`;

    if (filters.limit !== undefined) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(filters.limit);
    }
    if (filters.offset !== undefined) {
      sql += ` OFFSET $${paramIndex + (filters.limit !== undefined ? 1 : 0)}`;
      params.push(filters.offset);
    }

    const result = await this.pool.query<ScanRow>(sql, params);
    return result.rows.map(rowToRecord);
  }

  async countScans(filters: ScanFilters = {}): Promise<number> {
    const { where, params } = buildFilterQuery(filters);
    const sql = `SELECT COUNT(*) as count FROM scan_records ${where}`;
    const result = await this.pool.query<{ count: string }>(sql, params);
    return parseInt(result.rows[0].count, 10);
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
    };

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      const col = fieldMap[key];
      if (col === undefined) continue;
      setClauses.push(`${col} = $${idx++}`);
      params.push(key === 'jurisdictions' && Array.isArray(value) ? JSON.stringify(value) : value);
    }

    if (setClauses.length === 0) {
      const existing = await this.getScan(id);
      if (existing === null) {
        throw new Error(`Scan record not found: ${id}`);
      }
      return existing;
    }

    params.push(id);
    await this.pool.query(
      `UPDATE scan_records SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      params,
    );

    const updated = await this.getScan(id);
    if (updated === null) {
      throw new Error(`Scan record not found after update: ${id}`);
    }
    return updated;
  }

  async deleteScan(id: string): Promise<void> {
    await this.pool.query('DELETE FROM scan_records WHERE id = $1', [id]);
  }

  async deleteOrgScans(orgId: string): Promise<void> {
    await this.pool.query('DELETE FROM scan_records WHERE org_id = $1', [orgId]);
  }

  async getReport(id: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query<{ json_report: string | null }>(
      'SELECT json_report FROM scan_records WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0 || result.rows[0].json_report === null) return null;
    try {
      return JSON.parse(result.rows[0].json_report) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async getTrendData(orgId?: string): Promise<ScanRecord[]> {
    const conditions = ["status = 'completed'"];
    const params: unknown[] = [];
    let idx = 1;

    if (orgId !== undefined) {
      conditions.push(`org_id = $${idx++}`);
      params.push(orgId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const sql = `SELECT * FROM scan_records ${where} ORDER BY created_at ASC`;
    const result = await this.pool.query<ScanRow>(sql, params);
    return result.rows.map(rowToRecord);
  }

  async getLatestPerSite(orgId: string): Promise<ScanRecord[]> {
    const sql = `
      SELECT sr.* FROM scan_records sr
      INNER JOIN (
        SELECT site_url, MAX(created_at) as max_created_at
        FROM scan_records
        WHERE org_id = $1 AND status = 'completed'
        GROUP BY site_url
      ) latest ON sr.site_url = latest.site_url AND sr.created_at = latest.max_created_at
      WHERE sr.org_id = $1 AND sr.status = 'completed'
      ORDER BY sr.created_at DESC
    `;
    const result = await this.pool.query<ScanRow>(sql, [orgId]);
    return result.rows.map(rowToRecord);
  }
}

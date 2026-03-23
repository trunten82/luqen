import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanSchedule {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly scanMode: string;
  readonly jurisdictions: string[];
  readonly frequency: string;
  readonly nextRunAt: string;
  readonly lastRunAt: string | null;
  readonly enabled: boolean;
  readonly createdBy: string;
  readonly orgId: string;
  readonly runner: string | null;
  readonly incremental: boolean;
}

interface CreateScheduleInput {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly scanMode: string;
  readonly jurisdictions: string[];
  readonly frequency: string;
  readonly nextRunAt: string;
  readonly createdBy: string;
  readonly orgId: string;
  readonly runner?: string;
  readonly incremental?: boolean;
}

interface ScheduleRepository {
  listSchedules(orgId?: string): Promise<ScanSchedule[]>;
  getSchedule(id: string): Promise<ScanSchedule | null>;
  createSchedule(data: CreateScheduleInput): Promise<ScanSchedule>;
  updateSchedule(id: string, data: Partial<{ enabled: boolean; nextRunAt: string; lastRunAt: string }>): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  getDueSchedules(): Promise<ScanSchedule[]>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface ScheduleRow {
  id: string;
  site_url: string;
  standard: string;
  scan_mode: string;
  jurisdictions: string[] | string;
  frequency: string;
  next_run_at: string | Date;
  last_run_at: string | Date | null;
  enabled: boolean;
  created_by: string;
  org_id: string;
  runner: string | null;
  incremental: boolean;
}

function toIso(val: string | Date | null): string | null {
  if (val === null) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function scheduleRowToRecord(row: ScheduleRow): ScanSchedule {
  const jurisdictions = Array.isArray(row.jurisdictions)
    ? row.jurisdictions
    : JSON.parse(row.jurisdictions as string) as string[];

  return {
    id: row.id,
    siteUrl: row.site_url,
    standard: row.standard,
    scanMode: row.scan_mode,
    jurisdictions,
    frequency: row.frequency,
    nextRunAt: toIso(row.next_run_at as string | Date)!,
    lastRunAt: toIso(row.last_run_at as string | Date | null),
    enabled: row.enabled,
    createdBy: row.created_by,
    orgId: row.org_id,
    runner: row.runner,
    incremental: row.incremental,
  };
}

// ---------------------------------------------------------------------------
// PgScheduleRepository
// ---------------------------------------------------------------------------

export class PgScheduleRepository implements ScheduleRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listSchedules(orgId?: string): Promise<ScanSchedule[]> {
    if (orgId !== undefined) {
      const result = await this.pool.query<ScheduleRow>(
        'SELECT * FROM scan_schedules WHERE org_id = $1 ORDER BY next_run_at ASC',
        [orgId],
      );
      return result.rows.map(scheduleRowToRecord);
    }

    const result = await this.pool.query<ScheduleRow>(
      'SELECT * FROM scan_schedules ORDER BY next_run_at ASC',
    );
    return result.rows.map(scheduleRowToRecord);
  }

  async getSchedule(id: string): Promise<ScanSchedule | null> {
    const result = await this.pool.query<ScheduleRow>(
      'SELECT * FROM scan_schedules WHERE id = $1',
      [id],
    );
    return result.rows.length > 0 ? scheduleRowToRecord(result.rows[0]) : null;
  }

  async createSchedule(data: CreateScheduleInput): Promise<ScanSchedule> {
    await this.pool.query(
      `INSERT INTO scan_schedules (id, site_url, standard, scan_mode, jurisdictions, frequency, next_run_at, created_by, org_id, runner, incremental)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        data.id,
        data.siteUrl,
        data.standard,
        data.scanMode,
        JSON.stringify(data.jurisdictions),
        data.frequency,
        data.nextRunAt,
        data.createdBy,
        data.orgId,
        data.runner ?? 'htmlcs',
        data.incremental ?? false,
      ],
    );

    const created = await this.getSchedule(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve schedule after creation: ${data.id}`);
    }
    return created;
  }

  async updateSchedule(id: string, data: Partial<{ enabled: boolean; nextRunAt: string; lastRunAt: string }>): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.enabled !== undefined) {
      setClauses.push(`enabled = $${idx++}`);
      params.push(data.enabled);
    }
    if (data.nextRunAt !== undefined) {
      setClauses.push(`next_run_at = $${idx++}`);
      params.push(data.nextRunAt);
    }
    if (data.lastRunAt !== undefined) {
      setClauses.push(`last_run_at = $${idx++}`);
      params.push(data.lastRunAt);
    }

    if (setClauses.length === 0) return;

    params.push(id);
    await this.pool.query(
      `UPDATE scan_schedules SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      params,
    );
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.pool.query('DELETE FROM scan_schedules WHERE id = $1', [id]);
  }

  async getDueSchedules(): Promise<ScanSchedule[]> {
    const now = new Date().toISOString();
    const result = await this.pool.query<ScheduleRow>(
      'SELECT * FROM scan_schedules WHERE next_run_at <= $1 AND enabled = true',
      [now],
    );
    return result.rows.map(scheduleRowToRecord);
  }
}

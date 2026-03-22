import type Database from 'better-sqlite3';
import type { ScheduleRepository } from '../../interfaces/schedule-repository.js';
import type { ScanSchedule, CreateScheduleInput } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type and conversion
// ---------------------------------------------------------------------------

interface ScheduleRow {
  id: string;
  site_url: string;
  standard: string;
  scan_mode: string;
  jurisdictions: string;
  frequency: string;
  next_run_at: string;
  last_run_at: string | null;
  enabled: number;
  created_by: string;
  org_id: string;
  runner: string | null;
  incremental: number;
}

function scheduleRowToRecord(row: ScheduleRow): ScanSchedule {
  return {
    id: row.id,
    siteUrl: row.site_url,
    standard: row.standard,
    scanMode: row.scan_mode,
    jurisdictions: JSON.parse(row.jurisdictions) as string[],
    frequency: row.frequency,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    orgId: row.org_id,
    runner: row.runner,
    incremental: row.incremental === 1,
  };
}

// ---------------------------------------------------------------------------
// SqliteScheduleRepository
// ---------------------------------------------------------------------------

export class SqliteScheduleRepository implements ScheduleRepository {
  constructor(private readonly db: Database.Database) {}

  async listSchedules(orgId?: string): Promise<ScanSchedule[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM scan_schedules ${where} ORDER BY next_run_at ASC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as ScheduleRow[];
    return rows.map(scheduleRowToRecord);
  }

  async getSchedule(id: string): Promise<ScanSchedule | null> {
    const stmt = this.db.prepare('SELECT * FROM scan_schedules WHERE id = ?');
    const row = stmt.get(id) as ScheduleRow | undefined;
    return row !== undefined ? scheduleRowToRecord(row) : null;
  }

  async createSchedule(data: CreateScheduleInput): Promise<ScanSchedule> {
    const stmt = this.db.prepare(`
      INSERT INTO scan_schedules (id, site_url, standard, scan_mode, jurisdictions, frequency, next_run_at, created_by, org_id, runner, incremental)
      VALUES (@id, @siteUrl, @standard, @scanMode, @jurisdictions, @frequency, @nextRunAt, @createdBy, @orgId, @runner, @incremental)
    `);

    stmt.run({
      id: data.id,
      siteUrl: data.siteUrl,
      standard: data.standard,
      scanMode: data.scanMode,
      jurisdictions: JSON.stringify(data.jurisdictions),
      frequency: data.frequency,
      nextRunAt: data.nextRunAt,
      createdBy: data.createdBy,
      orgId: data.orgId,
      runner: data.runner ?? 'htmlcs',
      incremental: data.incremental ? 1 : 0,
    });

    const created = await this.getSchedule(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve schedule after creation: ${data.id}`);
    }
    return created;
  }

  async updateSchedule(id: string, data: Partial<{ enabled: boolean; nextRunAt: string; lastRunAt: string }>): Promise<void> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (data.enabled !== undefined) {
      setClauses.push('enabled = @enabled');
      params['enabled'] = data.enabled ? 1 : 0;
    }
    if (data.nextRunAt !== undefined) {
      setClauses.push('next_run_at = @nextRunAt');
      params['nextRunAt'] = data.nextRunAt;
    }
    if (data.lastRunAt !== undefined) {
      setClauses.push('last_run_at = @lastRunAt');
      params['lastRunAt'] = data.lastRunAt;
    }

    if (setClauses.length === 0) return;

    const stmt = this.db.prepare(
      `UPDATE scan_schedules SET ${setClauses.join(', ')} WHERE id = @id`,
    );
    stmt.run(params);
  }

  async deleteSchedule(id: string): Promise<void> {
    this.db.prepare('DELETE FROM scan_schedules WHERE id = ?').run(id);
  }

  async getDueSchedules(): Promise<ScanSchedule[]> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'SELECT * FROM scan_schedules WHERE next_run_at <= @now AND enabled = 1',
    );
    const rows = stmt.all({ now }) as ScheduleRow[];
    return rows.map(scheduleRowToRecord);
  }
}

import type Database from 'better-sqlite3';
import type { DigestRepository } from '../../interfaces/digest-repository.js';
import type { DigestSchedule, CreateDigestScheduleInput } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type and conversion
// ---------------------------------------------------------------------------

interface DigestRow {
  id: string;
  org_id: string;
  name: string;
  site_url: string | null;
  frequency: string;
  recipients: string;
  channels: string;         // JSON string
  enabled: number;
  next_send_at: string;
  last_sent_at: string | null;
  created_by: string;
  created_at: string;
}

function digestRowToRecord(row: DigestRow): DigestSchedule {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    siteUrl: row.site_url,
    frequency: row.frequency,
    recipients: row.recipients,
    channels: JSON.parse(row.channels) as string[],
    enabled: row.enabled === 1,
    nextSendAt: row.next_send_at,
    lastSentAt: row.last_sent_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteDigestRepository
// ---------------------------------------------------------------------------

export class SqliteDigestRepository implements DigestRepository {
  constructor(private readonly db: Database.Database) {}

  async listDigestSchedules(orgId?: string): Promise<DigestSchedule[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM digest_schedules ${where} ORDER BY next_send_at ASC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as DigestRow[];
    return rows.map(digestRowToRecord);
  }

  async getDigestSchedule(id: string): Promise<DigestSchedule | null> {
    const stmt = this.db.prepare('SELECT * FROM digest_schedules WHERE id = ?');
    const row = stmt.get(id) as DigestRow | undefined;
    return row !== undefined ? digestRowToRecord(row) : null;
  }

  async createDigestSchedule(data: CreateDigestScheduleInput): Promise<DigestSchedule> {
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO digest_schedules (id, org_id, name, site_url, frequency, recipients, channels, next_send_at, created_by, created_at)
      VALUES (@id, @orgId, @name, @siteUrl, @frequency, @recipients, @channels, @nextSendAt, @createdBy, @createdAt)
    `);

    stmt.run({
      id: data.id,
      orgId: data.orgId,
      name: data.name,
      siteUrl: data.siteUrl,
      frequency: data.frequency,
      recipients: data.recipients,
      channels: data.channels,
      nextSendAt: data.nextSendAt,
      createdBy: data.createdBy,
      createdAt,
    });

    const created = await this.getDigestSchedule(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve digest schedule after creation: ${data.id}`);
    }
    return created;
  }

  async updateDigestSchedule(id: string, data: Partial<{
    name: string;
    siteUrl: string | null;
    recipients: string;
    frequency: string;
    channels: string;
    nextSendAt: string;
    lastSentAt: string;
    enabled: boolean;
  }>): Promise<void> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (data.enabled !== undefined) {
      setClauses.push('enabled = @enabled');
      params['enabled'] = data.enabled ? 1 : 0;
    }
    if (data.name !== undefined) {
      setClauses.push('name = @name');
      params['name'] = data.name;
    }
    if (data.siteUrl !== undefined) {
      setClauses.push('site_url = @siteUrl');
      params['siteUrl'] = data.siteUrl;
    }
    if (data.recipients !== undefined) {
      setClauses.push('recipients = @recipients');
      params['recipients'] = data.recipients;
    }
    if (data.frequency !== undefined) {
      setClauses.push('frequency = @frequency');
      params['frequency'] = data.frequency;
    }
    if (data.channels !== undefined) {
      setClauses.push('channels = @channels');
      params['channels'] = data.channels;
    }
    if (data.nextSendAt !== undefined) {
      setClauses.push('next_send_at = @nextSendAt');
      params['nextSendAt'] = data.nextSendAt;
    }
    if (data.lastSentAt !== undefined) {
      setClauses.push('last_sent_at = @lastSentAt');
      params['lastSentAt'] = data.lastSentAt;
    }

    if (setClauses.length === 0) return;

    this.db
      .prepare(`UPDATE digest_schedules SET ${setClauses.join(', ')} WHERE id = @id`)
      .run(params);
  }

  async deleteDigestSchedule(id: string): Promise<void> {
    this.db.prepare('DELETE FROM digest_schedules WHERE id = ?').run(id);
  }

  async getDueDigestSchedules(): Promise<DigestSchedule[]> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'SELECT * FROM digest_schedules WHERE next_send_at <= @now AND enabled = 1',
    );
    const rows = stmt.all({ now }) as DigestRow[];
    return rows.map(digestRowToRecord);
  }
}

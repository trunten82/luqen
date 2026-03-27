import type Database from 'better-sqlite3';
import type { EmailRepository } from '../../interfaces/email-repository.js';
import type { SmtpConfig, SmtpConfigInput, EmailReport, CreateEmailReportInput } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row types and conversion
// ---------------------------------------------------------------------------

interface SmtpConfigRow {
  id: string;
  host: string;
  port: number;
  secure: number;
  username: string;
  password: string;
  from_address: string;
  from_name: string;
  org_id: string;
}

function smtpConfigRowToRecord(row: SmtpConfigRow): SmtpConfig {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    secure: row.secure === 1,
    username: row.username,
    password: row.password,
    fromAddress: row.from_address,
    fromName: row.from_name,
    orgId: row.org_id,
  };
}

interface EmailReportRow {
  id: string;
  name: string;
  site_url: string;
  recipients: string;
  frequency: string;
  format: string;
  include_csv: number;
  include_warnings: number | undefined;
  include_notices: number | undefined;
  next_send_at: string;
  last_sent_at: string | null;
  enabled: number;
  created_by: string;
  org_id: string;
  created_at_ts: string;
}

function emailReportRowToRecord(row: EmailReportRow): EmailReport & { includeWarnings: boolean; includeNotices: boolean } {
  return {
    id: row.id,
    name: row.name,
    siteUrl: row.site_url,
    recipients: row.recipients,
    frequency: row.frequency,
    format: row.format,
    includeCsv: row.include_csv === 1,
    includeWarnings: row.include_warnings !== 0,
    includeNotices: row.include_notices !== 0,
    nextSendAt: row.next_send_at,
    lastSentAt: row.last_sent_at,
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// SqliteEmailRepository
// ---------------------------------------------------------------------------

export class SqliteEmailRepository implements EmailRepository {
  constructor(private readonly db: Database.Database) {}

  async getSmtpConfig(orgId = 'system'): Promise<SmtpConfig | null> {
    const stmt = this.db.prepare(
      'SELECT * FROM smtp_config WHERE org_id = ? LIMIT 1',
    );
    const row = stmt.get(orgId) as SmtpConfigRow | undefined;
    return row !== undefined ? smtpConfigRowToRecord(row) : null;
  }

  async upsertSmtpConfig(data: SmtpConfigInput): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO smtp_config (id, host, port, secure, username, password, from_address, from_name, org_id)
      VALUES (@id, @host, @port, @secure, @username, @password, @fromAddress, @fromName, @orgId)
      ON CONFLICT (id)
      DO UPDATE SET host = @host, port = @port, secure = @secure, username = @username,
                    password = @password, from_address = @fromAddress, from_name = @fromName
    `);

    stmt.run({
      id: data.orgId ?? 'default',
      host: data.host,
      port: data.port,
      secure: data.secure ? 1 : 0,
      username: data.username,
      password: data.password,
      fromAddress: data.fromAddress,
      fromName: data.fromName ?? 'Luqen',
      orgId: data.orgId ?? 'system',
    });
  }

  async listEmailReports(orgId?: string): Promise<EmailReport[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM email_reports ${where} ORDER BY created_at_ts DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as EmailReportRow[];
    return rows.map(emailReportRowToRecord);
  }

  async getEmailReport(id: string): Promise<EmailReport | null> {
    const stmt = this.db.prepare('SELECT * FROM email_reports WHERE id = ?');
    const row = stmt.get(id) as EmailReportRow | undefined;
    return row !== undefined ? emailReportRowToRecord(row) : null;
  }

  async createEmailReport(data: CreateEmailReportInput): Promise<EmailReport> {
    const stmt = this.db.prepare(`
      INSERT INTO email_reports (id, name, site_url, recipients, frequency, format, include_csv, include_warnings, include_notices, next_send_at, enabled, created_by, org_id, created_at_ts)
      VALUES (@id, @name, @siteUrl, @recipients, @frequency, @format, @includeCsv, @includeWarnings, @includeNotices, @nextSendAt, 1, @createdBy, @orgId, @createdAtTs)
    `);

    stmt.run({
      id: data.id,
      name: data.name,
      siteUrl: data.siteUrl,
      recipients: data.recipients,
      frequency: data.frequency,
      format: data.format ?? 'pdf',
      includeCsv: data.includeCsv ? 1 : 0,
      includeWarnings: data.includeWarnings !== false ? 1 : 0,
      includeNotices: data.includeNotices !== false ? 1 : 0,
      nextSendAt: data.nextSendAt,
      createdBy: data.createdBy,
      orgId: data.orgId ?? 'system',
      createdAtTs: new Date().toISOString(),
    });

    const created = await this.getEmailReport(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve email report after creation: ${data.id}`);
    }
    return created;
  }

  async updateEmailReport(id: string, data: Partial<{
    name: string;
    siteUrl: string;
    recipients: string;
    frequency: string;
    format: string;
    includeCsv: boolean;
    includeWarnings: boolean;
    includeNotices: boolean;
    nextSendAt: string;
    lastSentAt: string;
    enabled: boolean;
  }>): Promise<void> {
    const fieldMap: Record<string, string> = {
      name: 'name',
      siteUrl: 'site_url',
      recipients: 'recipients',
      frequency: 'frequency',
      format: 'format',
      nextSendAt: 'next_send_at',
      lastSentAt: 'last_sent_at',
    };

    const booleanFields: Record<string, string> = {
      includeCsv: 'include_csv',
      includeWarnings: 'include_warnings',
      includeNotices: 'include_notices',
      enabled: 'enabled',
    };

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      const boolCol = booleanFields[key];
      if (boolCol !== undefined) {
        setClauses.push(`${boolCol} = @${key}`);
        params[key] = value ? 1 : 0;
      } else {
        const col = fieldMap[key];
        if (col === undefined) continue;
        setClauses.push(`${col} = @${key}`);
        params[key] = value;
      }
    }

    if (setClauses.length === 0) return;

    const stmt = this.db.prepare(
      `UPDATE email_reports SET ${setClauses.join(', ')} WHERE id = @id`,
    );
    stmt.run(params);
  }

  async deleteEmailReport(id: string): Promise<void> {
    this.db.prepare('DELETE FROM email_reports WHERE id = ?').run(id);
  }

  async getDueEmailReports(): Promise<EmailReport[]> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'SELECT * FROM email_reports WHERE next_send_at <= @now AND enabled = 1',
    );
    const rows = stmt.all({ now }) as EmailReportRow[];
    return rows.map(emailReportRowToRecord);
  }
}

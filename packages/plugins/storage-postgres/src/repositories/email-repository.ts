import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SmtpConfig {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly orgId: string;
}

interface SmtpConfigInput {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly orgId?: string;
}

interface EmailReport {
  readonly id: string;
  readonly name: string;
  readonly siteUrl: string;
  readonly recipients: string;
  readonly frequency: string;
  readonly format: string;
  readonly includeCsv: boolean;
  readonly nextSendAt: string;
  readonly lastSentAt: string | null;
  readonly enabled: boolean;
  readonly createdBy: string;
  readonly orgId: string;
}

interface CreateEmailReportInput {
  readonly id: string;
  readonly name: string;
  readonly siteUrl: string;
  readonly recipients: string;
  readonly frequency: string;
  readonly format?: string;
  readonly includeCsv?: boolean;
  readonly nextSendAt: string;
  readonly createdBy: string;
  readonly orgId?: string;
}

interface EmailRepository {
  getSmtpConfig(orgId?: string): Promise<SmtpConfig | null>;
  upsertSmtpConfig(data: SmtpConfigInput): Promise<void>;
  listEmailReports(orgId?: string): Promise<EmailReport[]>;
  getEmailReport(id: string): Promise<EmailReport | null>;
  createEmailReport(data: CreateEmailReportInput): Promise<EmailReport>;
  updateEmailReport(id: string, data: Partial<{
    name: string;
    siteUrl: string;
    recipients: string;
    frequency: string;
    format: string;
    includeCsv: boolean;
    nextSendAt: string;
    lastSentAt: string;
    enabled: boolean;
  }>): Promise<void>;
  deleteEmailReport(id: string): Promise<void>;
  getDueEmailReports(): Promise<EmailReport[]>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface SmtpConfigRow {
  id: string;
  host: string;
  port: number;
  secure: boolean;
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
    secure: row.secure,
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
  include_csv: boolean;
  next_send_at: string | Date;
  last_sent_at: string | Date | null;
  enabled: boolean;
  created_by: string;
  org_id: string;
}

function toIso(val: string | Date | null): string | null {
  if (val === null) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function emailReportRowToRecord(row: EmailReportRow): EmailReport {
  return {
    id: row.id,
    name: row.name,
    siteUrl: row.site_url,
    recipients: row.recipients,
    frequency: row.frequency,
    format: row.format,
    includeCsv: row.include_csv,
    nextSendAt: toIso(row.next_send_at)!,
    lastSentAt: toIso(row.last_sent_at),
    enabled: row.enabled,
    createdBy: row.created_by,
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// PgEmailRepository
// ---------------------------------------------------------------------------

export class PgEmailRepository implements EmailRepository {
  constructor(private readonly pool: pg.Pool) {}

  async getSmtpConfig(orgId = 'system'): Promise<SmtpConfig | null> {
    const result = await this.pool.query<SmtpConfigRow>(
      'SELECT * FROM smtp_config WHERE org_id = $1 LIMIT 1',
      [orgId],
    );
    return result.rows.length > 0 ? smtpConfigRowToRecord(result.rows[0]) : null;
  }

  async upsertSmtpConfig(data: SmtpConfigInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO smtp_config (id, host, port, secure, username, password, from_address, from_name, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id)
       DO UPDATE SET host = $2, port = $3, secure = $4, username = $5,
                     password = $6, from_address = $7, from_name = $8`,
      [
        data.orgId ?? 'default',
        data.host,
        data.port,
        data.secure,
        data.username,
        data.password,
        data.fromAddress,
        data.fromName ?? 'Luqen',
        data.orgId ?? 'system',
      ],
    );
  }

  async listEmailReports(orgId?: string): Promise<EmailReport[]> {
    if (orgId !== undefined) {
      const result = await this.pool.query<EmailReportRow>(
        'SELECT * FROM email_reports WHERE org_id = $1 ORDER BY created_at_ts DESC',
        [orgId],
      );
      return result.rows.map(emailReportRowToRecord);
    }

    const result = await this.pool.query<EmailReportRow>(
      'SELECT * FROM email_reports ORDER BY created_at_ts DESC',
    );
    return result.rows.map(emailReportRowToRecord);
  }

  async getEmailReport(id: string): Promise<EmailReport | null> {
    const result = await this.pool.query<EmailReportRow>(
      'SELECT * FROM email_reports WHERE id = $1',
      [id],
    );
    return result.rows.length > 0 ? emailReportRowToRecord(result.rows[0]) : null;
  }

  async createEmailReport(data: CreateEmailReportInput): Promise<EmailReport> {
    await this.pool.query(
      `INSERT INTO email_reports (id, name, site_url, recipients, frequency, format, include_csv, next_send_at, enabled, created_by, org_id, created_at_ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11)`,
      [
        data.id,
        data.name,
        data.siteUrl,
        data.recipients,
        data.frequency,
        data.format ?? 'pdf',
        data.includeCsv ?? false,
        data.nextSendAt,
        data.createdBy,
        data.orgId ?? 'system',
        new Date().toISOString(),
      ],
    );

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
      includeCsv: 'include_csv',
      nextSendAt: 'next_send_at',
      lastSentAt: 'last_sent_at',
      enabled: 'enabled',
    };

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      const col = fieldMap[key];
      if (col === undefined) continue;
      setClauses.push(`${col} = $${idx++}`);
      params.push(value);
    }

    if (setClauses.length === 0) return;

    params.push(id);
    await this.pool.query(
      `UPDATE email_reports SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      params,
    );
  }

  async deleteEmailReport(id: string): Promise<void> {
    await this.pool.query('DELETE FROM email_reports WHERE id = $1', [id]);
  }

  async getDueEmailReports(): Promise<EmailReport[]> {
    const now = new Date().toISOString();
    const result = await this.pool.query<EmailReportRow>(
      'SELECT * FROM email_reports WHERE next_send_at <= $1 AND enabled = true',
      [now],
    );
    return result.rows.map(emailReportRowToRecord);
  }
}

import Database from 'better-sqlite3';
import { MigrationRunner } from './migrations.js';
import type { Migration } from './migrations.js';
import type { ManualTestResult, ManualTestStatus } from '../manual-criteria.js';
import { ALL_PERMISSION_IDS, DEFAULT_ROLES } from '../permissions.js';

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
  readonly orgId: string;
}

export interface ScanFilters {
  readonly status?: ScanRecord['status'];
  readonly createdBy?: string;
  readonly siteUrl?: string;
  readonly orgId?: string;
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
  org_id: string;
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
  {
    id: '002',
    name: 'create-plugins',
    sql: `
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'inactive',
  installed_at TEXT NOT NULL,
  activated_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_plugins_type ON plugins(type);
CREATE INDEX IF NOT EXISTS idx_plugins_status ON plugins(status);
    `,
  },
  {
    id: '003',
    name: 'create-dashboard-users',
    sql: `
CREATE TABLE IF NOT EXISTS dashboard_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_username ON dashboard_users(username);
    `,
  },
  {
    id: '004',
    name: 'create-api-keys',
    sql: `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'default',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);
    `,
  },
  {
    id: '005',
    name: 'add-multi-tenancy',
    sql: `
ALTER TABLE scan_records ADD COLUMN org_id TEXT NOT NULL DEFAULT 'system';
CREATE INDEX IF NOT EXISTS idx_scan_records_org_id ON scan_records(org_id);

ALTER TABLE api_keys ADD COLUMN org_id TEXT NOT NULL DEFAULT 'system';
CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys(org_id);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
    `,
  },
  {
    id: '006',
    name: 'create-page-hashes',
    sql: `
CREATE TABLE IF NOT EXISTS page_hashes (
  site_url TEXT NOT NULL,
  page_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  last_scanned_at TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'system',
  PRIMARY KEY (site_url, page_url, org_id)
);
CREATE INDEX IF NOT EXISTS idx_page_hashes_site ON page_hashes(site_url, org_id);
    `,
  },
  {
    id: '007',
    name: 'create-manual-test-results',
    sql: `
CREATE TABLE IF NOT EXISTS manual_test_results (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scan_records(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'untested',
  notes TEXT,
  tested_by TEXT,
  tested_at TEXT,
  org_id TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_manual_tests_scan ON manual_test_results(scan_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_tests_unique ON manual_test_results(scan_id, criterion_id);
    `,
  },
  {
    id: '008',
    name: 'create-scan-schedules',
    sql: `
CREATE TABLE IF NOT EXISTS scan_schedules (
  id TEXT PRIMARY KEY,
  site_url TEXT NOT NULL,
  standard TEXT NOT NULL DEFAULT 'WCAG2AA',
  scan_mode TEXT NOT NULL DEFAULT 'single',
  jurisdictions TEXT NOT NULL DEFAULT '[]',
  frequency TEXT NOT NULL DEFAULT 'weekly',
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'system',
  runner TEXT DEFAULT 'htmlcs',
  incremental INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scan_schedules_next ON scan_schedules(next_run_at, enabled);
    `,
  },
  {
    id: '009',
    name: 'create-issue-assignments',
    sql: `
CREATE TABLE IF NOT EXISTS issue_assignments (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  issue_fingerprint TEXT NOT NULL,
  wcag_criterion TEXT,
  wcag_title TEXT,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  selector TEXT,
  page_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_issue_assignments_scan ON issue_assignments(scan_id);
CREATE INDEX IF NOT EXISTS idx_issue_assignments_status ON issue_assignments(status);
CREATE INDEX IF NOT EXISTS idx_issue_assignments_assigned ON issue_assignments(assigned_to);
    `,
  },
  {
    id: '010',
    name: 'create-connected-repos',
    sql: `
CREATE TABLE IF NOT EXISTS connected_repos (
  id TEXT PRIMARY KEY,
  site_url_pattern TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  repo_path TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  auth_token TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_connected_repos_site ON connected_repos(site_url_pattern, org_id);
    `,
  },
  {
    id: '011',
    name: 'create-roles',
    sql: `
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  org_id TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(org_id);
    `,
  },
  {
    id: '012',
    name: 'create-role-permissions-and-seed',
    sql: `
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

-- Seed default system roles
INSERT OR IGNORE INTO roles (id, name, description, is_system, org_id, created_at) VALUES
  ('admin', 'admin', 'Full system administrator with all permissions', 1, 'system', '2024-01-01T00:00:00.000Z'),
  ('developer', 'developer', 'Developer with technical access and fix capabilities', 1, 'system', '2024-01-01T00:00:00.000Z'),
  ('user', 'user', 'Standard user with scanning and reporting access', 1, 'system', '2024-01-01T00:00:00.000Z'),
  ('executive', 'executive', 'Executive with read-only access to reports and trends', 1, 'system', '2024-01-01T00:00:00.000Z');

-- Seed admin permissions (all)
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('admin', 'scans.create'),
  ('admin', 'scans.schedule'),
  ('admin', 'reports.view'),
  ('admin', 'reports.view_technical'),
  ('admin', 'reports.export'),
  ('admin', 'reports.delete'),
  ('admin', 'reports.compare'),
  ('admin', 'issues.assign'),
  ('admin', 'issues.fix'),
  ('admin', 'manual_testing'),
  ('admin', 'repos.manage'),
  ('admin', 'trends.view'),
  ('admin', 'admin.users'),
  ('admin', 'admin.roles'),
  ('admin', 'admin.system');

-- Seed developer permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('developer', 'scans.create'),
  ('developer', 'reports.view'),
  ('developer', 'reports.view_technical'),
  ('developer', 'reports.export'),
  ('developer', 'reports.delete'),
  ('developer', 'reports.compare'),
  ('developer', 'issues.assign'),
  ('developer', 'issues.fix'),
  ('developer', 'manual_testing'),
  ('developer', 'repos.manage'),
  ('developer', 'trends.view');

-- Seed user permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('user', 'scans.create'),
  ('user', 'scans.schedule'),
  ('user', 'reports.view'),
  ('user', 'reports.export'),
  ('user', 'reports.delete'),
  ('user', 'reports.compare'),
  ('user', 'issues.assign'),
  ('user', 'manual_testing'),
  ('user', 'trends.view');

-- Seed executive permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('executive', 'reports.view'),
  ('executive', 'reports.export'),
  ('executive', 'trends.view');
    `,
  },
  {
    id: '013',
    name: 'create-email-reports-and-smtp',
    sql: `
CREATE TABLE IF NOT EXISTS email_reports (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  recipients TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'weekly',
  format TEXT NOT NULL DEFAULT 'pdf',
  include_csv INTEGER NOT NULL DEFAULT 0,
  next_send_at TEXT NOT NULL,
  last_sent_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'system',
  created_at_ts TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_email_reports_next ON email_reports(next_send_at, enabled);

CREATE TABLE IF NOT EXISTS smtp_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  secure INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT 'Pally Dashboard',
  org_id TEXT NOT NULL DEFAULT 'system'
);
    `,
  },
];

export interface SmtpConfig {
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

export interface SmtpConfigInput {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly orgId?: string;
}

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

export interface EmailReport {
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

export interface CreateEmailReportInput {
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

interface EmailReportRow {
  id: string;
  name: string;
  site_url: string;
  recipients: string;
  frequency: string;
  format: string;
  include_csv: number;
  next_send_at: string;
  last_sent_at: string | null;
  enabled: number;
  created_by: string;
  org_id: string;
  created_at_ts: string;
}

function emailReportRowToRecord(row: EmailReportRow): EmailReport {
  return {
    id: row.id,
    name: row.name,
    siteUrl: row.site_url,
    recipients: row.recipients,
    frequency: row.frequency,
    format: row.format,
    includeCsv: row.include_csv === 1,
    nextSendAt: row.next_send_at,
    lastSentAt: row.last_sent_at,
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    orgId: row.org_id,
  };
}

export interface ConnectedRepo {
  readonly id: string;
  readonly siteUrlPattern: string;
  readonly repoUrl: string;
  readonly repoPath: string | null;
  readonly branch: string;
  readonly authToken: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly orgId: string;
}

export interface Role {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly orgId: string;
  readonly createdAt: string;
  readonly permissions: readonly string[];
}

interface RoleRow {
  id: string;
  name: string;
  description: string;
  is_system: number;
  org_id: string;
  created_at: string;
}

interface ConnectedRepoRow {
  id: string;
  site_url_pattern: string;
  repo_url: string;
  repo_path: string | null;
  branch: string;
  auth_token: string | null;
  created_by: string;
  created_at: string;
  org_id: string;
}

function repoRowToRecord(row: ConnectedRepoRow): ConnectedRepo {
  return {
    id: row.id,
    siteUrlPattern: row.site_url_pattern,
    repoUrl: row.repo_url,
    repoPath: row.repo_path,
    branch: row.branch,
    authToken: row.auth_token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    orgId: row.org_id,
  };
}

export type IssueAssignmentStatus = 'open' | 'assigned' | 'in-progress' | 'fixed' | 'verified';

export interface IssueAssignment {
  readonly id: string;
  readonly scanId: string;
  readonly issueFingerprint: string;
  readonly wcagCriterion: string | null;
  readonly wcagTitle: string | null;
  readonly severity: string;
  readonly message: string;
  readonly selector: string | null;
  readonly pageUrl: string | null;
  readonly status: IssueAssignmentStatus;
  readonly assignedTo: string | null;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly orgId: string;
}

export interface AssignmentFilters {
  readonly scanId?: string;
  readonly status?: IssueAssignmentStatus;
  readonly assignedTo?: string;
  readonly orgId?: string;
}

export interface AssignmentStats {
  readonly open: number;
  readonly assigned: number;
  readonly inProgress: number;
  readonly fixed: number;
  readonly verified: number;
  readonly total: number;
}

interface AssignmentRow {
  id: string;
  scan_id: string;
  issue_fingerprint: string;
  wcag_criterion: string | null;
  wcag_title: string | null;
  severity: string;
  message: string;
  selector: string | null;
  page_url: string | null;
  status: string;
  assigned_to: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  org_id: string;
}

function assignmentRowToRecord(row: AssignmentRow): IssueAssignment {
  return {
    id: row.id,
    scanId: row.scan_id,
    issueFingerprint: row.issue_fingerprint,
    wcagCriterion: row.wcag_criterion,
    wcagTitle: row.wcag_title,
    severity: row.severity,
    message: row.message,
    selector: row.selector,
    pageUrl: row.page_url,
    status: row.status as IssueAssignmentStatus,
    assignedTo: row.assigned_to,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orgId: row.org_id,
  };
}

export interface ScanSchedule {
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

export interface CreateScheduleInput {
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

export interface PageHashEntry {
  readonly siteUrl: string;
  readonly pageUrl: string;
  readonly hash: string;
  readonly orgId: string;
}

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
    orgId?: string;
  }): ScanRecord {
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
    if (filters.orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = filters.orgId;
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

  deleteOrgScans(orgId: string): void {
    this.db.prepare('DELETE FROM scan_records WHERE org_id = ?').run(orgId);
  }

  getTrendData(orgId?: string): ScanRecord[] {
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

  getPageHashes(siteUrl: string, orgId: string): Map<string, string> {
    const stmt = this.db.prepare(
      'SELECT page_url, content_hash FROM page_hashes WHERE site_url = @siteUrl AND org_id = @orgId'
    );
    const rows = stmt.all({ siteUrl, orgId }) as Array<{ page_url: string; content_hash: string }>;
    const result = new Map<string, string>();
    for (const row of rows) {
      result.set(row.page_url, row.content_hash);
    }
    return result;
  }

  upsertPageHash(siteUrl: string, pageUrl: string, hash: string, orgId: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO page_hashes (site_url, page_url, content_hash, last_scanned_at, org_id)
      VALUES (@siteUrl, @pageUrl, @hash, @lastScannedAt, @orgId)
      ON CONFLICT (site_url, page_url, org_id)
      DO UPDATE SET content_hash = @hash, last_scanned_at = @lastScannedAt
    `);
    stmt.run({
      siteUrl,
      pageUrl,
      hash,
      lastScannedAt: new Date().toISOString(),
      orgId,
    });
  }

  upsertPageHashes(entries: ReadonlyArray<PageHashEntry>): void {
    const stmt = this.db.prepare(`
      INSERT INTO page_hashes (site_url, page_url, content_hash, last_scanned_at, org_id)
      VALUES (@siteUrl, @pageUrl, @hash, @lastScannedAt, @orgId)
      ON CONFLICT (site_url, page_url, org_id)
      DO UPDATE SET content_hash = @hash, last_scanned_at = @lastScannedAt
    `);

    const upsertMany = this.db.transaction((rows: ReadonlyArray<PageHashEntry>) => {
      const now = new Date().toISOString();
      for (const entry of rows) {
        stmt.run({
          siteUrl: entry.siteUrl,
          pageUrl: entry.pageUrl,
          hash: entry.hash,
          lastScannedAt: now,
          orgId: entry.orgId,
        });
      }
    });

    upsertMany(entries);
  }

  // ── Manual test results ───────────────────────────────────────────────

  getManualTests(scanId: string): ManualTestResult[] {
    const stmt = this.db.prepare(
      'SELECT * FROM manual_test_results WHERE scan_id = ? ORDER BY criterion_id'
    );
    const rows = stmt.all(scanId) as Array<{
      id: string;
      scan_id: string;
      criterion_id: string;
      status: string;
      notes: string | null;
      tested_by: string | null;
      tested_at: string | null;
      org_id: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      scanId: row.scan_id,
      criterionId: row.criterion_id,
      status: row.status as ManualTestStatus,
      notes: row.notes,
      testedBy: row.tested_by,
      testedAt: row.tested_at,
      orgId: row.org_id,
    }));
  }

  upsertManualTest(data: {
    readonly scanId: string;
    readonly criterionId: string;
    readonly status: ManualTestStatus;
    readonly notes?: string;
    readonly testedBy: string;
    readonly orgId?: string;
  }): ManualTestResult {
    const now = new Date().toISOString();
    const id = `mt-${data.scanId}-${data.criterionId}`;

    const stmt = this.db.prepare(`
      INSERT INTO manual_test_results (id, scan_id, criterion_id, status, notes, tested_by, tested_at, org_id)
      VALUES (@id, @scanId, @criterionId, @status, @notes, @testedBy, @testedAt, @orgId)
      ON CONFLICT (scan_id, criterion_id)
      DO UPDATE SET status = @status, notes = @notes, tested_by = @testedBy, tested_at = @testedAt
    `);

    stmt.run({
      id,
      scanId: data.scanId,
      criterionId: data.criterionId,
      status: data.status,
      notes: data.notes ?? null,
      testedBy: data.testedBy,
      testedAt: now,
      orgId: data.orgId ?? 'system',
    });

    return {
      id,
      scanId: data.scanId,
      criterionId: data.criterionId,
      status: data.status,
      notes: data.notes ?? null,
      testedBy: data.testedBy,
      testedAt: now,
      orgId: data.orgId ?? 'system',
    };
  }

  // ── Scan schedules ──────────────────────────────────────────────────

  listSchedules(orgId?: string): ScanSchedule[] {
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

  getSchedule(id: string): ScanSchedule | null {
    const stmt = this.db.prepare('SELECT * FROM scan_schedules WHERE id = ?');
    const row = stmt.get(id) as ScheduleRow | undefined;
    return row !== undefined ? scheduleRowToRecord(row) : null;
  }

  createSchedule(data: CreateScheduleInput): ScanSchedule {
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

    const created = this.getSchedule(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve schedule after creation: ${data.id}`);
    }
    return created;
  }

  updateSchedule(id: string, data: Partial<{ enabled: boolean; nextRunAt: string; lastRunAt: string }>): void {
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
      `UPDATE scan_schedules SET ${setClauses.join(', ')} WHERE id = @id`
    );
    stmt.run(params);
  }

  deleteSchedule(id: string): void {
    this.db.prepare('DELETE FROM scan_schedules WHERE id = ?').run(id);
  }

  getDueSchedules(): ScanSchedule[] {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'SELECT * FROM scan_schedules WHERE next_run_at <= @now AND enabled = 1'
    );
    const rows = stmt.all({ now }) as ScheduleRow[];
    return rows.map(scheduleRowToRecord);
  }

  // ── Issue assignments ─────────────────────────────────────────────

  listAssignments(filters: AssignmentFilters = {}): IssueAssignment[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.scanId !== undefined) {
      conditions.push('scan_id = @scanId');
      params['scanId'] = filters.scanId;
    }
    if (filters.status !== undefined) {
      conditions.push('status = @status');
      params['status'] = filters.status;
    }
    if (filters.assignedTo !== undefined) {
      conditions.push('assigned_to = @assignedTo');
      params['assignedTo'] = filters.assignedTo;
    }
    if (filters.orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = filters.orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM issue_assignments ${where} ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as AssignmentRow[];
    return rows.map(assignmentRowToRecord);
  }

  getAssignment(id: string): IssueAssignment | null {
    const stmt = this.db.prepare('SELECT * FROM issue_assignments WHERE id = ?');
    const row = stmt.get(id) as AssignmentRow | undefined;
    return row !== undefined ? assignmentRowToRecord(row) : null;
  }

  getAssignmentByFingerprint(scanId: string, fingerprint: string): IssueAssignment | null {
    const stmt = this.db.prepare(
      'SELECT * FROM issue_assignments WHERE scan_id = @scanId AND issue_fingerprint = @fingerprint'
    );
    const row = stmt.get({ scanId, fingerprint }) as AssignmentRow | undefined;
    return row !== undefined ? assignmentRowToRecord(row) : null;
  }

  createAssignment(data: {
    readonly id: string;
    readonly scanId: string;
    readonly issueFingerprint: string;
    readonly wcagCriterion?: string;
    readonly wcagTitle?: string;
    readonly severity: string;
    readonly message: string;
    readonly selector?: string;
    readonly pageUrl?: string;
    readonly assignedTo?: string;
    readonly notes?: string;
    readonly createdBy: string;
    readonly orgId?: string;
  }): IssueAssignment {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO issue_assignments (id, scan_id, issue_fingerprint, wcag_criterion, wcag_title, severity, message, selector, page_url, status, assigned_to, notes, created_by, created_at, updated_at, org_id)
      VALUES (@id, @scanId, @issueFingerprint, @wcagCriterion, @wcagTitle, @severity, @message, @selector, @pageUrl, @status, @assignedTo, @notes, @createdBy, @createdAt, @updatedAt, @orgId)
    `);

    const assignedTo = data.assignedTo?.trim() || null;
    const status: IssueAssignmentStatus = assignedTo !== null ? 'assigned' : 'open';

    stmt.run({
      id: data.id,
      scanId: data.scanId,
      issueFingerprint: data.issueFingerprint,
      wcagCriterion: data.wcagCriterion ?? null,
      wcagTitle: data.wcagTitle ?? null,
      severity: data.severity,
      message: data.message,
      selector: data.selector ?? null,
      pageUrl: data.pageUrl ?? null,
      status,
      assignedTo,
      notes: data.notes ?? null,
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
      orgId: data.orgId ?? 'system',
    });

    const created = this.getAssignment(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve assignment after creation: ${data.id}`);
    }
    return created;
  }

  updateAssignment(id: string, data: { status?: IssueAssignmentStatus; assignedTo?: string; notes?: string }): void {
    const setClauses: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { id, updatedAt: new Date().toISOString() };

    if (data.status !== undefined) {
      setClauses.push('status = @status');
      params['status'] = data.status;
    }
    if (data.assignedTo !== undefined) {
      setClauses.push('assigned_to = @assignedTo');
      params['assignedTo'] = data.assignedTo.trim() || null;
    }
    if (data.notes !== undefined) {
      setClauses.push('notes = @notes');
      params['notes'] = data.notes.trim() || null;
    }

    const stmt = this.db.prepare(
      `UPDATE issue_assignments SET ${setClauses.join(', ')} WHERE id = @id`
    );
    stmt.run(params);
  }

  getAssignmentStats(scanId: string): AssignmentStats {
    const stmt = this.db.prepare(
      'SELECT status, COUNT(*) as cnt FROM issue_assignments WHERE scan_id = ? GROUP BY status'
    );
    const rows = stmt.all(scanId) as Array<{ status: string; cnt: number }>;

    const stats: AssignmentStats = {
      open: 0,
      assigned: 0,
      inProgress: 0,
      fixed: 0,
      verified: 0,
      total: 0,
    };

    let total = 0;
    const result = { ...stats };
    for (const row of rows) {
      total += row.cnt;
      switch (row.status) {
        case 'open': result.open = row.cnt; break;
        case 'assigned': result.assigned = row.cnt; break;
        case 'in-progress': result.inProgress = row.cnt; break;
        case 'fixed': result.fixed = row.cnt; break;
        case 'verified': result.verified = row.cnt; break;
      }
    }

    return { ...result, total };
  }

  // ── Connected repos ──────────────────────────────────────────────────

  listRepos(orgId?: string): ConnectedRepo[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM connected_repos ${where} ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as ConnectedRepoRow[];
    return rows.map(repoRowToRecord);
  }

  getRepo(id: string): ConnectedRepo | null {
    const stmt = this.db.prepare('SELECT * FROM connected_repos WHERE id = ?');
    const row = stmt.get(id) as ConnectedRepoRow | undefined;
    return row !== undefined ? repoRowToRecord(row) : null;
  }

  findRepoForUrl(siteUrl: string, orgId: string): ConnectedRepo | null {
    const stmt = this.db.prepare(
      'SELECT * FROM connected_repos WHERE @siteUrl LIKE site_url_pattern AND org_id = @orgId ORDER BY created_at DESC LIMIT 1'
    );
    const row = stmt.get({ siteUrl, orgId }) as ConnectedRepoRow | undefined;
    return row !== undefined ? repoRowToRecord(row) : null;
  }

  createRepo(data: {
    readonly id: string;
    readonly siteUrlPattern: string;
    readonly repoUrl: string;
    readonly repoPath?: string;
    readonly branch?: string;
    readonly authToken?: string;
    readonly createdBy: string;
    readonly orgId?: string;
  }): ConnectedRepo {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO connected_repos (id, site_url_pattern, repo_url, repo_path, branch, auth_token, created_by, created_at, org_id)
      VALUES (@id, @siteUrlPattern, @repoUrl, @repoPath, @branch, @authToken, @createdBy, @createdAt, @orgId)
    `);

    stmt.run({
      id: data.id,
      siteUrlPattern: data.siteUrlPattern,
      repoUrl: data.repoUrl,
      repoPath: data.repoPath ?? null,
      branch: data.branch ?? 'main',
      authToken: data.authToken ?? null,
      createdBy: data.createdBy,
      createdAt: now,
      orgId: data.orgId ?? 'system',
    });

    const created = this.getRepo(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve connected repo after creation: ${data.id}`);
    }
    return created;
  }

  deleteRepo(id: string): void {
    this.db.prepare('DELETE FROM connected_repos WHERE id = ?').run(id);
  }

  // ── Roles & Permissions ──────────────────────────────────────────────

  private roleRowToRecord(row: RoleRow): Role {
    const permissions = this.getRolePermissions(row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isSystem: row.is_system === 1,
      orgId: row.org_id,
      createdAt: row.created_at,
      permissions,
    };
  }

  listRoles(orgId?: string): Role[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push("(org_id = @orgId OR org_id = 'system')");
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM roles ${where} ORDER BY is_system DESC, name ASC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as RoleRow[];
    return rows.map((row) => this.roleRowToRecord(row));
  }

  getRole(id: string): Role | null {
    const stmt = this.db.prepare('SELECT * FROM roles WHERE id = ?');
    const row = stmt.get(id) as RoleRow | undefined;
    return row !== undefined ? this.roleRowToRecord(row) : null;
  }

  getRoleByName(name: string): Role | null {
    const stmt = this.db.prepare('SELECT * FROM roles WHERE name = ?');
    const row = stmt.get(name) as RoleRow | undefined;
    return row !== undefined ? this.roleRowToRecord(row) : null;
  }

  getRolePermissions(roleId: string): string[] {
    const stmt = this.db.prepare(
      'SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission',
    );
    const rows = stmt.all(roleId) as Array<{ permission: string }>;
    return rows.map((r) => r.permission);
  }

  createRole(data: {
    readonly name: string;
    readonly description: string;
    readonly permissions: readonly string[];
    readonly orgId: string;
  }): Role {
    const id = `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const insertRole = this.db.prepare(`
      INSERT INTO roles (id, name, description, is_system, org_id, created_at)
      VALUES (@id, @name, @description, 0, @orgId, @createdAt)
    `);

    const insertPerm = this.db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (@roleId, @permission)',
    );

    this.db.transaction(() => {
      insertRole.run({
        id,
        name: data.name,
        description: data.description,
        orgId: data.orgId,
        createdAt: now,
      });

      for (const permission of data.permissions) {
        insertPerm.run({ roleId: id, permission });
      }
    })();

    const created = this.getRole(id);
    if (created === null) {
      throw new Error(`Failed to retrieve role after creation: ${id}`);
    }
    return created;
  }

  updateRole(id: string, data: {
    readonly name?: string;
    readonly description?: string;
    readonly permissions?: readonly string[];
  }): void {
    const role = this.getRole(id);
    if (role === null) {
      throw new Error(`Role not found: ${id}`);
    }

    this.db.transaction(() => {
      // Update role fields (name only if not system)
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { id };

      if (data.description !== undefined) {
        setClauses.push('description = @description');
        params['description'] = data.description;
      }
      if (data.name !== undefined && !role.isSystem) {
        setClauses.push('name = @name');
        params['name'] = data.name;
      }

      if (setClauses.length > 0) {
        this.db.prepare(
          `UPDATE roles SET ${setClauses.join(', ')} WHERE id = @id`,
        ).run(params);
      }

      // Update permissions if provided
      if (data.permissions !== undefined) {
        this.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
        const insertPerm = this.db.prepare(
          'INSERT INTO role_permissions (role_id, permission) VALUES (@roleId, @permission)',
        );
        for (const permission of data.permissions) {
          insertPerm.run({ roleId: id, permission });
        }
      }
    })();
  }

  deleteRole(id: string): void {
    const role = this.getRole(id);
    if (role === null) {
      throw new Error(`Role not found: ${id}`);
    }
    if (role.isSystem) {
      throw new Error('Cannot delete system roles');
    }
    this.db.prepare('DELETE FROM roles WHERE id = ? AND is_system = 0').run(id);
  }

  getUserPermissions(userId: string): Set<string> {
    // Look up the user's role from dashboard_users table
    const userRow = this.db.prepare(
      'SELECT role FROM dashboard_users WHERE id = ?',
    ).get(userId) as { role: string } | undefined;

    if (userRow === undefined) {
      // Fall back to 'user' role permissions
      const fallbackRole = this.getRoleByName('user');
      return new Set(fallbackRole?.permissions ?? []);
    }

    const role = this.getRoleByName(userRow.role);
    if (role === null) {
      // Fall back to 'user' role permissions
      const fallbackRole = this.getRoleByName('user');
      return new Set(fallbackRole?.permissions ?? []);
    }

    // For admin role, grant all permissions
    if (role.name === 'admin') {
      return new Set(ALL_PERMISSION_IDS);
    }

    return new Set(role.permissions);
  }

  // ── Email reports & SMTP config ──────────────────────────────────

  getSmtpConfig(orgId = 'system'): SmtpConfig | null {
    const stmt = this.db.prepare(
      'SELECT * FROM smtp_config WHERE org_id = ? LIMIT 1',
    );
    const row = stmt.get(orgId) as SmtpConfigRow | undefined;
    return row !== undefined ? smtpConfigRowToRecord(row) : null;
  }

  upsertSmtpConfig(data: SmtpConfigInput): void {
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
      fromName: data.fromName ?? 'Pally Dashboard',
      orgId: data.orgId ?? 'system',
    });
  }

  listEmailReports(orgId?: string): EmailReport[] {
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

  getEmailReport(id: string): EmailReport | null {
    const stmt = this.db.prepare('SELECT * FROM email_reports WHERE id = ?');
    const row = stmt.get(id) as EmailReportRow | undefined;
    return row !== undefined ? emailReportRowToRecord(row) : null;
  }

  createEmailReport(data: CreateEmailReportInput): EmailReport {
    const stmt = this.db.prepare(`
      INSERT INTO email_reports (id, name, site_url, recipients, frequency, format, include_csv, next_send_at, enabled, created_by, org_id, created_at_ts)
      VALUES (@id, @name, @siteUrl, @recipients, @frequency, @format, @includeCsv, @nextSendAt, 1, @createdBy, @orgId, @createdAtTs)
    `);

    stmt.run({
      id: data.id,
      name: data.name,
      siteUrl: data.siteUrl,
      recipients: data.recipients,
      frequency: data.frequency,
      format: data.format ?? 'pdf',
      includeCsv: data.includeCsv ? 1 : 0,
      nextSendAt: data.nextSendAt,
      createdBy: data.createdBy,
      orgId: data.orgId ?? 'system',
      createdAtTs: new Date().toISOString(),
    });

    const created = this.getEmailReport(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve email report after creation: ${data.id}`);
    }
    return created;
  }

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
  }>): void {
    const fieldMap: Record<string, string> = {
      name: 'name',
      siteUrl: 'site_url',
      recipients: 'recipients',
      frequency: 'frequency',
      format: 'format',
      nextSendAt: 'next_send_at',
      lastSentAt: 'last_sent_at',
    };

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      if (key === 'includeCsv') {
        setClauses.push('include_csv = @includeCsv');
        params['includeCsv'] = value ? 1 : 0;
      } else if (key === 'enabled') {
        setClauses.push('enabled = @enabled');
        params['enabled'] = value ? 1 : 0;
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

  deleteEmailReport(id: string): void {
    this.db.prepare('DELETE FROM email_reports WHERE id = ?').run(id);
  }

  getDueEmailReports(): EmailReport[] {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'SELECT * FROM email_reports WHERE next_send_at <= @now AND enabled = 1',
    );
    const rows = stmt.all({ now }) as EmailReportRow[];
    return rows.map(emailReportRowToRecord);
  }

  close(): void {
    this.db.close();
  }
}

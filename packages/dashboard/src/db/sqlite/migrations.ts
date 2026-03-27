import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Migration types
// ---------------------------------------------------------------------------

export interface Migration {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly id: string;
  readonly name: string;
  readonly applied_at: string;
}

// ---------------------------------------------------------------------------
// MigrationRunner
// ---------------------------------------------------------------------------

const CREATE_SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export class MigrationRunner {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  run(migrations: readonly Migration[]): void {
    this.db.exec(CREATE_SCHEMA_MIGRATIONS_SQL);

    const appliedIds = new Set(
      (this.db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>)
        .map((row) => row.id),
    );

    const insert = this.db.prepare(
      'INSERT INTO schema_migrations (id, name, applied_at) VALUES (@id, @name, @applied_at)',
    );

    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) {
        continue;
      }

      this.db.transaction(() => {
        this.db.exec(migration.sql);
        insert.run({
          id: migration.id,
          name: migration.name,
          applied_at: new Date().toISOString(),
        });
      })();
    }
  }

  getApplied(): AppliedMigration[] {
    const rows = this.db
      .prepare('SELECT id, name, applied_at FROM schema_migrations ORDER BY id')
      .all() as Array<{ id: string; name: string; applied_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      applied_at: row.applied_at,
    }));
  }
}

// ---------------------------------------------------------------------------
// Dashboard migrations (SQLite-specific)
// ---------------------------------------------------------------------------

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
  from_name TEXT NOT NULL DEFAULT 'Luqen',
  org_id TEXT NOT NULL DEFAULT 'system'
);
    `,
  },
  {
    id: '014',
    name: 'create-teams',
    sql: `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  org_id TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (team_id, user_id)
);
    `,
  },
  {
    id: '015',
    name: 'add-user-management-permissions',
    sql: `
-- Add granular user management permissions for admin role
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('admin', 'users.create'),
  ('admin', 'users.delete'),
  ('admin', 'users.activate'),
  ('admin', 'users.reset_password'),
  ('admin', 'users.roles');
    `,
  },
  {
    id: '016',
    name: 'create-audit-log',
    sql: `
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  org_id TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
    `,
  },
  {
    id: '017',
    name: 'add-audit-view-permission',
    sql: `
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'audit.view');
    `,
  },
  {
    id: '018',
    name: 'add-json-report-column',
    sql: `
ALTER TABLE scan_records ADD COLUMN json_report TEXT;
    `,
  },
  {
    id: '019',
    name: 'add-api-key-role',
    sql: `
ALTER TABLE api_keys ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
    `,
  },
  {
    id: '020',
    name: 'add-plugin-checksum',
    sql: `
ALTER TABLE plugins ADD COLUMN checksum TEXT;
    `,
  },
  {
    id: '021',
    name: 'rbac-org-scoped-roles',
    sql: `
-- Recreate roles table without the UNIQUE constraint on name alone.
-- SQLite cannot drop a column-level UNIQUE, so we use copy-rename.
-- We must preserve role_permissions data because the FK CASCADE on the
-- old roles table would delete them when we drop it.

-- 1. Back up role_permissions
CREATE TABLE _rp_backup AS SELECT * FROM role_permissions;

-- 2. Drop role_permissions (removes FK dependency on old roles table)
DROP TABLE role_permissions;

-- 3. Recreate roles without the name-only UNIQUE constraint
CREATE TABLE roles_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  org_id TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);
INSERT INTO roles_new SELECT id, name, description, is_system, org_id, created_at FROM roles;
DROP TABLE roles;
ALTER TABLE roles_new RENAME TO roles;

-- 4. Restore indexes on roles
CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_org ON roles(name, org_id);

-- 5. Recreate role_permissions with FK to the new roles table
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
INSERT INTO role_permissions SELECT role_id, permission FROM _rp_backup;
DROP TABLE _rp_backup;

-- 6. Add role_id column to teams (nullable FK to roles)
ALTER TABLE teams ADD COLUMN role_id TEXT REFERENCES roles(id) ON DELETE SET NULL;

-- 7. Add org_id column to plugins table (for future org-scoped plugin config)
ALTER TABLE plugins ADD COLUMN org_id TEXT NOT NULL DEFAULT 'system';
    `,
  },
  {
    id: '022',
    name: 'migrate-direct-members-to-teams',
    sql: `
-- For each org that has direct members, create a "Direct Members" team,
-- assign the org-scoped "Member" role to it, and move all direct members
-- into that team. This ensures all org access flows through teams.

-- 1. Create "Direct Members" teams for every org that has direct members.
--    Use org_id as a deterministic team id suffix to avoid collisions.
INSERT INTO teams (id, name, description, org_id, role_id, created_at)
  SELECT
    'team-dm-' || om.org_id,
    'Direct Members',
    'Auto-created team for migrated direct organization members',
    om.org_id,
    (SELECT r.id FROM roles r WHERE r.name = 'Member' AND r.org_id = om.org_id LIMIT 1),
    datetime('now')
  FROM org_members om
  GROUP BY om.org_id;

-- 2. Move direct members into their corresponding "Direct Members" team.
INSERT OR IGNORE INTO team_members (team_id, user_id, role)
  SELECT
    'team-dm-' || om.org_id,
    om.user_id,
    om.role
  FROM org_members om;

-- 3. Clear the org_members table (all access now goes through teams).
DELETE FROM org_members;
    `,
  },
];

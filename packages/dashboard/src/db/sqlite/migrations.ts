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
  {
    id: '023',
    name: 'add-email-report-warning-notice-flags',
    sql: `
ALTER TABLE email_reports ADD COLUMN include_warnings INTEGER NOT NULL DEFAULT 1;
ALTER TABLE email_reports ADD COLUMN include_notices INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    id: '024',
    name: 'backfill-default-org-roles',
    sql: `
-- Backfill default org-scoped roles for existing orgs that don't have them.
-- New orgs already get these via createOrg(), but orgs created before RBAC
-- (migration 021) have no org-scoped roles, so migration 022's "Direct
-- Members" teams have NULL role_id.

-- 1. Create the 4 default roles for each org missing an "Owner" role.
--    Use deterministic IDs: 'role-<level>-<org_id>' so this is idempotent.

INSERT OR IGNORE INTO roles (id, name, description, is_system, org_id, created_at)
  SELECT
    'role-owner-' || o.id,
    'Owner',
    'Full organization owner with all permissions',
    0,
    o.id,
    datetime('now')
  FROM organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM roles r WHERE r.name = 'Owner' AND r.org_id = o.id
  );

INSERT OR IGNORE INTO roles (id, name, description, is_system, org_id, created_at)
  SELECT
    'role-admin-' || o.id,
    'Admin',
    'Manage teams, run scans, view reports, configure plugins',
    0,
    o.id,
    datetime('now')
  FROM organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM roles r WHERE r.name = 'Admin' AND r.org_id = o.id
  );

INSERT OR IGNORE INTO roles (id, name, description, is_system, org_id, created_at)
  SELECT
    'role-member-' || o.id,
    'Member',
    'Run scans and view reports',
    0,
    o.id,
    datetime('now')
  FROM organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM roles r WHERE r.name = 'Member' AND r.org_id = o.id
  );

INSERT OR IGNORE INTO roles (id, name, description, is_system, org_id, created_at)
  SELECT
    'role-viewer-' || o.id,
    'Viewer',
    'View reports only',
    0,
    o.id,
    datetime('now')
  FROM organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM roles r WHERE r.name = 'Viewer' AND r.org_id = o.id
  );

-- 2. Insert permissions for Owner role (per org)
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT 'role-owner-' || o.id, p.permission
  FROM organizations o
  CROSS JOIN (
    SELECT 'scans.create' AS permission UNION ALL
    SELECT 'scans.schedule' UNION ALL
    SELECT 'reports.view' UNION ALL
    SELECT 'reports.view_technical' UNION ALL
    SELECT 'reports.export' UNION ALL
    SELECT 'reports.delete' UNION ALL
    SELECT 'reports.compare' UNION ALL
    SELECT 'issues.assign' UNION ALL
    SELECT 'issues.fix' UNION ALL
    SELECT 'manual_testing' UNION ALL
    SELECT 'repos.manage' UNION ALL
    SELECT 'trends.view' UNION ALL
    SELECT 'admin.roles' UNION ALL
    SELECT 'admin.teams' UNION ALL
    SELECT 'admin.system' UNION ALL
    SELECT 'users.create' UNION ALL
    SELECT 'users.delete' UNION ALL
    SELECT 'users.activate' UNION ALL
    SELECT 'users.reset_password' UNION ALL
    SELECT 'users.roles' UNION ALL
    SELECT 'audit.view'
  ) p
  WHERE EXISTS (SELECT 1 FROM roles r WHERE r.id = 'role-owner-' || o.id);

-- 3. Insert permissions for Admin role (per org)
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT 'role-admin-' || o.id, p.permission
  FROM organizations o
  CROSS JOIN (
    SELECT 'scans.create' AS permission UNION ALL
    SELECT 'scans.schedule' UNION ALL
    SELECT 'reports.view' UNION ALL
    SELECT 'reports.view_technical' UNION ALL
    SELECT 'reports.export' UNION ALL
    SELECT 'reports.delete' UNION ALL
    SELECT 'reports.compare' UNION ALL
    SELECT 'issues.assign' UNION ALL
    SELECT 'issues.fix' UNION ALL
    SELECT 'manual_testing' UNION ALL
    SELECT 'repos.manage' UNION ALL
    SELECT 'trends.view' UNION ALL
    SELECT 'admin.teams'
  ) p
  WHERE EXISTS (SELECT 1 FROM roles r WHERE r.id = 'role-admin-' || o.id);

-- 4. Insert permissions for Member role (per org)
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT 'role-member-' || o.id, p.permission
  FROM organizations o
  CROSS JOIN (
    SELECT 'scans.create' AS permission UNION ALL
    SELECT 'reports.view' UNION ALL
    SELECT 'reports.export' UNION ALL
    SELECT 'reports.compare' UNION ALL
    SELECT 'trends.view'
  ) p
  WHERE EXISTS (SELECT 1 FROM roles r WHERE r.id = 'role-member-' || o.id);

-- 5. Insert permissions for Viewer role (per org)
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT 'role-viewer-' || o.id, p.permission
  FROM organizations o
  CROSS JOIN (
    SELECT 'reports.view' AS permission
  ) p
  WHERE EXISTS (SELECT 1 FROM roles r WHERE r.id = 'role-viewer-' || o.id);

-- 6. Fix "Direct Members" teams from migration 022 that have NULL role_id.
--    Point them at the org-scoped "Member" role.
UPDATE teams
  SET role_id = (
    SELECT r.id FROM roles r
    WHERE r.name = 'Member' AND r.org_id = teams.org_id
    LIMIT 1
  )
  WHERE name = 'Direct Members'
    AND role_id IS NULL
    AND org_id != 'system';

-- 7. Add admin.plugins permission to system admin role and org Owner/Admin roles
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'admin.plugins');

INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'admin.plugins'
  FROM roles r
  WHERE r.name IN ('Owner', 'Admin') AND r.org_id != 'system';
    `,
  },
  {
    id: '025',
    name: 'fix-migrated-members-role-preservation',
    sql: `
-- Migration 022 put ALL direct members into a single "Direct Members" team
-- with the "Member" role, regardless of their original role (owner/admin/viewer).
-- This fix creates per-role teams and moves users to the correct one.

-- 1. For each org, create Owner/Admin/Viewer teams for members who had those roles.
--    (Member team already exists as "Direct Members".)

-- Owner teams
INSERT OR IGNORE INTO teams (id, name, description, org_id, role_id, created_at)
  SELECT DISTINCT
    'team-owners-' || t.org_id,
    'Owners',
    'Organization owners (migrated from direct membership)',
    t.org_id,
    (SELECT r.id FROM roles r WHERE r.name = 'Owner' AND r.org_id = t.org_id LIMIT 1),
    datetime('now')
  FROM teams t
  JOIN team_members tm ON tm.team_id = t.id
  WHERE t.name = 'Direct Members' AND tm.role = 'owner' AND t.org_id != 'system';

-- Admin teams
INSERT OR IGNORE INTO teams (id, name, description, org_id, role_id, created_at)
  SELECT DISTINCT
    'team-admins-' || t.org_id,
    'Admins',
    'Organization admins (migrated from direct membership)',
    t.org_id,
    (SELECT r.id FROM roles r WHERE r.name = 'Admin' AND r.org_id = t.org_id LIMIT 1),
    datetime('now')
  FROM teams t
  JOIN team_members tm ON tm.team_id = t.id
  WHERE t.name = 'Direct Members' AND tm.role = 'admin' AND t.org_id != 'system';

-- Viewer teams
INSERT OR IGNORE INTO teams (id, name, description, org_id, role_id, created_at)
  SELECT DISTINCT
    'team-viewers-' || t.org_id,
    'Viewers',
    'Organization viewers (migrated from direct membership)',
    t.org_id,
    (SELECT r.id FROM roles r WHERE r.name = 'Viewer' AND r.org_id = t.org_id LIMIT 1),
    datetime('now')
  FROM teams t
  JOIN team_members tm ON tm.team_id = t.id
  WHERE t.name = 'Direct Members' AND tm.role = 'viewer' AND t.org_id != 'system';

-- 2. Move users from "Direct Members" to their correct role-based team.

-- Move owners
INSERT OR IGNORE INTO team_members (team_id, user_id, role)
  SELECT 'team-owners-' || t.org_id, tm.user_id, 'owner'
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE t.name = 'Direct Members' AND tm.role = 'owner' AND t.org_id != 'system';

-- Move admins
INSERT OR IGNORE INTO team_members (team_id, user_id, role)
  SELECT 'team-admins-' || t.org_id, tm.user_id, 'admin'
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE t.name = 'Direct Members' AND tm.role = 'admin' AND t.org_id != 'system';

-- Move viewers
INSERT OR IGNORE INTO team_members (team_id, user_id, role)
  SELECT 'team-viewers-' || t.org_id, tm.user_id, 'viewer'
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE t.name = 'Direct Members' AND tm.role = 'viewer' AND t.org_id != 'system';

-- 3. Remove non-member users from "Direct Members" team (they've been moved).
DELETE FROM team_members
  WHERE team_id IN (SELECT id FROM teams WHERE name = 'Direct Members')
    AND role != 'member';

-- 4. Add admin.plugins to Owner role permissions (was missing from migration 024 step 2)
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'admin.plugins'
  FROM roles r
  WHERE r.name = 'Owner' AND r.org_id != 'system';

-- 5. Add admin.plugins to Admin role permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'admin.plugins'
  FROM roles r
  WHERE r.name = 'Admin' AND r.org_id != 'system';
    `,
  },
  {
    id: '026',
    name: 'remove-global-permissions-from-org-roles',
    sql: `
-- Org Owner/Admin roles should NOT have global-admin permissions.
-- admin.system, users.* are for the global admin role only.

DELETE FROM role_permissions
  WHERE permission IN (
    'admin.system',
    'users.create',
    'users.delete',
    'users.activate',
    'users.reset_password',
    'users.roles',
    'admin.users'
  )
  AND role_id IN (
    SELECT r.id FROM roles r WHERE r.org_id != 'system'
  );
    `,
  },
  {
    id: '027',
    name: 'add-admin-org-and-compliance-permissions',
    sql: `
-- 1. Add new permissions to system admin role
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'admin.plugins');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'admin.org');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'compliance.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'compliance.manage');

-- 2. Add admin.org to org Owner roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'admin.org' FROM roles r WHERE r.name = 'Owner' AND r.org_id != 'system';

-- 3. Add users.create to org Owner and Admin roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'users.create' FROM roles r WHERE r.name IN ('Owner', 'Admin') AND r.org_id != 'system';

-- 4. Add compliance.view to ALL org roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'compliance.view' FROM roles r WHERE r.org_id != 'system';

-- 5. Add compliance.manage to org Owner and Admin roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'compliance.manage' FROM roles r WHERE r.name IN ('Owner', 'Admin') AND r.org_id != 'system';

-- 6. Promote Admin role: add missing operational permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, p.perm FROM roles r
  CROSS JOIN (
    SELECT 'repos.manage' AS perm UNION ALL
    SELECT 'issues.assign' UNION ALL
    SELECT 'issues.fix' UNION ALL
    SELECT 'scans.schedule' UNION ALL
    SELECT 'reports.delete'
  ) p
  WHERE r.name = 'Admin' AND r.org_id != 'system';

-- 8. Add reports.view_technical + manual_testing to Member role
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, p.perm FROM roles r
  CROSS JOIN (
    SELECT 'reports.view_technical' AS perm UNION ALL
    SELECT 'manual_testing'
  ) p
  WHERE r.name = 'Member' AND r.org_id != 'system';

-- 9. Add trends.view to Viewer role
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'trends.view' FROM roles r WHERE r.name = 'Viewer' AND r.org_id != 'system';
    `,
  },
  {
    id: '028',
    name: 'add-compliance-client-to-orgs',
    sql: `
ALTER TABLE organizations ADD COLUMN compliance_client_id TEXT;
ALTER TABLE organizations ADD COLUMN compliance_client_secret TEXT;
    `,
  },
  {
    id: '029',
    name: 'add-user-management-to-org-owner-admin',
    sql: `
-- Add user management permissions to org Owner and Admin roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, p.perm FROM roles r
  CROSS JOIN (
    SELECT 'users.delete' AS perm UNION ALL
    SELECT 'users.activate' UNION ALL
    SELECT 'users.reset_password' UNION ALL
    SELECT 'users.roles'
  ) p
  WHERE r.name = 'Owner' AND r.org_id != 'system';

INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, p.perm FROM roles r
  CROSS JOIN (
    SELECT 'users.delete' AS perm UNION ALL
    SELECT 'users.activate' UNION ALL
    SELECT 'users.reset_password'
  ) p
  WHERE r.name = 'Admin' AND r.org_id != 'system';
    `,
  },
  {
    id: '030',
    name: 'remove-users-roles-from-org-owner',
    sql: `
-- users.roles allows changing dashboard-level roles (admin/user/etc.)
-- This is a global admin action, not org-scoped. Remove from org roles.
DELETE FROM role_permissions
  WHERE permission = 'users.roles'
  AND role_id IN (SELECT r.id FROM roles r WHERE r.org_id != 'system');
    `,
  },
  {
    id: '031',
    name: 'restore-users-roles-for-org-owners',
    sql: `
-- Org owners and admins should be able to change non-admin dashboard roles
-- within their organization. The server-side handler prevents assigning 'admin'.
-- Re-add users.roles to org-scoped owner and admin roles that have users.create.
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT rp.role_id, 'users.roles'
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  WHERE rp.permission = 'users.create'
  AND r.org_id != 'system';
    `,
  },
  {
    id: '032',
    name: 'git-host-configs-and-developer-credentials',
    sql: `
CREATE TABLE IF NOT EXISTS git_host_configs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  plugin_type TEXT NOT NULL,
  host_url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, plugin_type, host_url)
);
CREATE INDEX IF NOT EXISTS idx_git_host_configs_org ON git_host_configs(org_id);

CREATE TABLE IF NOT EXISTS developer_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  git_host_config_id TEXT NOT NULL REFERENCES git_host_configs(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  validated_username TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, git_host_config_id)
);
CREATE INDEX IF NOT EXISTS idx_developer_credentials_user ON developer_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_developer_credentials_host ON developer_credentials(git_host_config_id);

ALTER TABLE connected_repos ADD COLUMN git_host_config_id TEXT REFERENCES git_host_configs(id);
    `,
  },
  {
    id: '033',
    name: 'add-repos-credentials-permission',
    sql: `
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'repos.credentials'
  FROM roles r
  WHERE r.name IN ('Owner', 'Admin', 'Member')
  AND r.org_id != 'system';

INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'repos.credentials'
  FROM roles r
  WHERE r.name IN ('admin', 'developer')
  AND r.org_id = 'system';
    `,
  },
  {
    id: '034',
    name: 'branding-guidelines-tables',
    sql: `
CREATE TABLE IF NOT EXISTS branding_guidelines (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branding_guidelines_org ON branding_guidelines(org_id);

CREATE TABLE IF NOT EXISTS branding_colors (
  id TEXT PRIMARY KEY,
  guideline_id TEXT NOT NULL REFERENCES branding_guidelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hex_value TEXT NOT NULL,
  usage TEXT,
  context TEXT
);
CREATE INDEX IF NOT EXISTS idx_branding_colors_guideline ON branding_colors(guideline_id);

CREATE TABLE IF NOT EXISTS branding_fonts (
  id TEXT PRIMARY KEY,
  guideline_id TEXT NOT NULL REFERENCES branding_guidelines(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  weights TEXT,
  usage TEXT,
  context TEXT
);
CREATE INDEX IF NOT EXISTS idx_branding_fonts_guideline ON branding_fonts(guideline_id);

CREATE TABLE IF NOT EXISTS branding_selectors (
  id TEXT PRIMARY KEY,
  guideline_id TEXT NOT NULL REFERENCES branding_guidelines(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_branding_selectors_guideline ON branding_selectors(guideline_id);

CREATE TABLE IF NOT EXISTS site_branding (
  site_url TEXT NOT NULL,
  guideline_id TEXT NOT NULL REFERENCES branding_guidelines(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  PRIMARY KEY (site_url, org_id)
);
CREATE INDEX IF NOT EXISTS idx_site_branding_guideline ON site_branding(guideline_id);

ALTER TABLE scan_records ADD COLUMN branding_guideline_id TEXT;
ALTER TABLE scan_records ADD COLUMN branding_guideline_version INTEGER;
ALTER TABLE scan_records ADD COLUMN brand_related_count INTEGER DEFAULT 0;
    `,
  },
  {
    id: '035',
    name: 'branding-permissions',
    sql: `
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'branding.view'
  FROM roles r
  WHERE r.name IN ('Owner', 'Admin', 'Member', 'Viewer')
  AND r.org_id != 'system';

INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'branding.manage'
  FROM roles r
  WHERE r.name IN ('Owner', 'Admin')
  AND r.org_id != 'system';

INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'branding.view'
  FROM roles r
  WHERE r.name IN ('admin', 'developer', 'user', 'viewer', 'executive')
  AND r.org_id = 'system';

INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'branding.manage'
  FROM roles r
  WHERE r.name IN ('admin', 'developer')
  AND r.org_id = 'system';
    `,
  },
  {
    id: '036',
    name: 'add-branding-client-to-orgs',
    sql: `
ALTER TABLE organizations ADD COLUMN branding_client_id TEXT;
ALTER TABLE organizations ADD COLUMN branding_client_secret TEXT;
    `,
  },
  {
    id: '037',
    name: 'add-branding-guideline-image',
    sql: `
ALTER TABLE branding_guidelines ADD COLUMN image_path TEXT;
    `,
  },
  {
    id: '038',
    name: 'create-service-connections',
    sql: `
CREATE TABLE IF NOT EXISTS service_connections (
  service_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  client_secret_encrypted TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
    `,
  },
  {
    id: '039',
    name: 'add_scan_records_regulations_column',
    sql: `
ALTER TABLE scan_records ADD COLUMN regulations TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    id: '040',
    name: 'add_branding_guidelines_cloned_from_system_guideline_id',
    sql: `
ALTER TABLE branding_guidelines ADD COLUMN cloned_from_system_guideline_id TEXT;
    `,
  },
  {
    id: '041',
    name: 'add-llm-client-to-orgs',
    sql: `
ALTER TABLE organizations ADD COLUMN llm_client_id TEXT;
ALTER TABLE organizations ADD COLUMN llm_client_secret TEXT;
    `,
  },
  {
    id: '042',
    name: 'add-api-key-expires-at',
    sql: `
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
    `,
  },
  {
    id: '043',
    name: 'brand-scores-and-org-branding-mode',
    sql: `
CREATE TABLE IF NOT EXISTS brand_scores (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scan_records(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  guideline_id TEXT,
  guideline_version INTEGER,
  overall INTEGER,
  color_contrast INTEGER,
  typography INTEGER,
  components INTEGER,
  coverage_profile TEXT NOT NULL,
  subscore_details TEXT,
  unscorable_reason TEXT,
  brand_related_count INTEGER NOT NULL DEFAULT 0,
  total_issues INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL CHECK (mode IN ('embedded','remote')),
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brand_scores_scan ON brand_scores(scan_id);
CREATE INDEX IF NOT EXISTS idx_brand_scores_org_site ON brand_scores(org_id, site_url, computed_at);

ALTER TABLE organizations
  ADD COLUMN branding_mode TEXT NOT NULL DEFAULT 'embedded';
    `,
  },
  {
    id: '044',
    name: 'org-brand-score-target',
    sql: `ALTER TABLE organizations ADD COLUMN brand_score_target INTEGER;`,
  },
  {
    id: '045',
    name: 'branding-fonts-metrics',
    sql: `
      ALTER TABLE branding_fonts ADD COLUMN x_height INTEGER;
      ALTER TABLE branding_fonts ADD COLUMN cap_height INTEGER;
      ALTER TABLE branding_fonts ADD COLUMN units_per_em INTEGER;
    `,
  },
];

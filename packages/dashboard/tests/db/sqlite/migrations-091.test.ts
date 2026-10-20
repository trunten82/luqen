/**
 * Phase 89 Plan 09 (FP-18, D-16) — migration 091: the issues.dismiss grant for EXISTING orgs.
 *
 * New orgs get the permission from DEFAULT_ORG_ROLES at creation. Orgs that already exist need
 * a row per Owner and Admin role, and only those: 091 copies migration 088's org-roles statement
 * and nothing else (no global 'admin' row — that role resolves the whole catalogue already).
 *
 * "Existing" is modelled honestly: the migration list WITHOUT 091 runs first, the orgs and their
 * roles are seeded with plain INSERTs (as migrations-054.test.ts does), then the full list runs.
 * The MigrationRunner skips applied ids, so the second run applies 091 alone.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from '../../../src/db/sqlite/migrations.js';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';

const PERM = 'issues.dismiss';
const BEFORE_091 = DASHBOARD_MIGRATIONS.filter((m) => m.id !== '091');
const PKG_JSON = resolve(__dirname, '../../../package.json');
const READBACK = resolve(__dirname, '../../../scripts/dismissal-permission-readback.mjs');
const DEFAULT_NAMES = ['Owner', 'Admin', 'Member', 'Executive', 'Viewer'] as const;

class PreGrantDb {
  readonly dir = mkdtempSync(join(tmpdir(), 'migrations-091-'));
  readonly path = join(this.dir, 'dashboard.db');
  readonly db: Database.Database;
  private readonly now = new Date().toISOString();

  constructor() {
    this.db = new Database(this.path);
    this.db.pragma('journal_mode = WAL');
    new MigrationRunner(this.db).run(BEFORE_091);
  }

  /** An org that exists before 091, with its five default roles. Role ids are `<org>:<name>`. */
  org(orgId: string): void {
    this.db
      .prepare('INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
      .run(orgId, `Fabrikam ${orgId}`, `fabrikam-${orgId}`, this.now);
    for (const name of DEFAULT_NAMES) this.role(`${orgId}:${name}`, name, orgId);
  }

  role(id: string, name: string, orgId: string): void {
    this.db
      .prepare('INSERT INTO roles (id, name, description, is_system, org_id, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(id, name, '', orgId, this.now);
    // Every role carries something already, so "091 adds only issues.dismiss" is measurable.
    this.db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run(id, 'reports.view');
  }

  rowsFor(roleId: string): number {
    return (this.db
      .prepare('SELECT COUNT(*) AS n FROM role_permissions WHERE role_id = ? AND permission = ?')
      .get(roleId, PERM) as { n: number }).n;
  }

  totalRows(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM role_permissions').get() as { n: number }).n;
  }

  /** Every role id that carries issues.dismiss, sorted. */
  holders(): string[] {
    return (this.db
      .prepare('SELECT role_id FROM role_permissions WHERE permission = ? ORDER BY role_id')
      .all(PERM) as Array<{ role_id: string }>).map((r) => r.role_id);
  }

  migrateAll(): void {
    new MigrationRunner(this.db).run(DASHBOARD_MIGRATIONS);
  }

  close(): void {
    if (this.db.open) this.db.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

let fx: PreGrantDb;
beforeEach(() => {
  fx = new PreGrantDb();
});
afterEach(() => {
  fx.close();
});

describe('migration 091: grant issues.dismiss to existing orgs\' Owner and Admin roles', () => {
  it('091 is registered', () => {
    const mig = DASHBOARD_MIGRATIONS.find((m) => m.id === '091');
    expect(mig).toBeDefined();
    expect(mig!.name).toBe('grant-issues-dismiss-to-org-owner-admin');
    // Only 092 and 093 (one nullable column each, on issue_dismissals and oauth_user_consents; no role rows) are registered after the grant,
    // so the "existing DB" model below (every migration except 091 first) still runs 091 against the
    // same role rows. A further migration must be checked against that model before it is added here.
    const after = DASHBOARD_MIGRATIONS.slice(DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '091') + 1);
    expect(after.map((m) => m.id)).toEqual(['092', '093']);
  });

  it('existing orgs\' Owner and Admin roles receive issues.dismiss', () => {
    fx.org('org-a');
    fx.org('org-b');
    expect(fx.holders()).toEqual([]);
    const before = fx.totalRows();

    fx.migrateAll();

    for (const org of ['org-a', 'org-b']) {
      expect(fx.rowsFor(`${org}:Owner`), `${org} Owner`).toBe(1);
      expect(fx.rowsFor(`${org}:Admin`), `${org} Admin`).toBe(1);
    }
    // Exactly one new row per Owner/Admin role and nothing else.
    expect(fx.totalRows() - before).toBe(4);
  });

  it('Member, Executive and Viewer roles, system-org roles and custom roles do not receive issues.dismiss', () => {
    fx.org('org-a');
    fx.role('org-a:support', 'Support', 'org-a');
    // A system-org role carrying a default org-role NAME: the org_id filter, not the name, keeps it out.
    fx.role('system:Owner', 'Owner', 'system');

    fx.migrateAll();

    for (const name of ['Member', 'Executive', 'Viewer']) {
      expect(fx.rowsFor(`org-a:${name}`), `org-a ${name}`).toBe(0);
    }
    expect(fx.rowsFor('org-a:support'), 'custom org role').toBe(0);
    expect(fx.rowsFor('system:Owner'), 'system-org role named Owner').toBe(0);
    for (const systemRole of ['admin', 'developer', 'user', 'executive']) {
      expect(fx.rowsFor(systemRole), `system role ${systemRole}`).toBe(0);
    }
    // The complete holder set is the org's Owner and Admin, nothing else.
    expect(fx.holders()).toEqual(['org-a:Admin', 'org-a:Owner']);
  });

  it('running 091 twice changes nothing', () => {
    fx.org('org-a');
    fx.migrateAll();
    const rowsAfterFirst = fx.totalRows();
    const holdersAfterFirst = fx.holders();

    // Layer 1: the runner skips an applied id.
    fx.migrateAll();
    expect(fx.totalRows()).toBe(rowsAfterFirst);

    // Layer 2: the statement itself is INSERT OR IGNORE, so a forced re-execution adds nothing.
    const sql = DASHBOARD_MIGRATIONS.find((m) => m.id === '091')!.sql;
    fx.db.exec(sql);
    expect(fx.totalRows()).toBe(rowsAfterFirst);
    expect(fx.holders()).toEqual(holdersAfterFirst);
  });
});

describe('an org created after the grant (DEFAULT_ORG_ROLES)', () => {
  it('an org created after the grant has Owner and Admin with issues.dismiss and Member and Viewer without', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-091-neworg-'));
    const storage = new SqliteStorageAdapter(join(dir, 'dashboard.db'));
    try {
      await storage.migrate();
      const org = await storage.organizations.createOrg({ name: 'Northwind', slug: `northwind-${randomUUID().slice(0, 8)}` });
      const has = async (name: string): Promise<boolean> => {
        const role = await storage.roles.getRoleByNameAndOrg(name, org.id);
        expect(role, `role ${name}`).not.toBeNull();
        return (role?.permissions ?? []).includes(PERM);
      };
      expect(await has('Owner')).toBe(true);
      expect(await has('Admin')).toBe(true);
      expect(await has('Member')).toBe(false);
      expect(await has('Executive')).toBe(false);
      expect(await has('Viewer')).toBe(false);
    } finally {
      await storage.disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

interface Readback {
  readonly status: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly json: any;
}

function readback(dbPath: string, args: readonly string[]): Readback {
  const res = spawnSync(process.execPath, [READBACK, '--db', dbPath, '--require-root', PKG_JSON, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  let json: unknown = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

describe('migration 091 against the Plan 03 read-back instrument', () => {
  it('the read-back instrument reports a database migrated through 091 as granted and not dark', () => {
    fx.org('org-a');
    fx.org('org-b');
    fx.role('org-a:support', 'Support', 'org-a');
    // An active Owner in a team, so the instrument measures someone (exit 3 is "measured nothing").
    const now = new Date().toISOString();
    fx.db
      .prepare('INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .run('u-owner', 'fabrikam-owner', 'x', 'user', now);
    fx.db
      .prepare('INSERT INTO teams (id, name, description, org_id, created_at, role_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run('t-owner', 'Fabrikam owners', '', 'org-a', now, 'org-a:Owner');
    fx.db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run('t-owner', 'u-owner', 'member');

    fx.migrateAll();
    fx.db.close();

    // The owner's D-15 Q3 answer (custom roles may carry it) is the flag the post-grant read-back uses.
    const granted = readback(fx.path, ['--expect', 'granted', '--allow-custom-roles', 'true']);
    expect(granted.status).toBe(0);
    expect(granted.json.violations).toEqual([]);
    expect(granted.json.ownerAdminRoles).toEqual({ total: 4, withRow: 4, missing: 0 });

    const dark = readback(fx.path, ['--expect', 'dark']);
    expect(dark.status).toBe(4);
    expect(dark.json.violations).toEqual(['latent-org-owner-admin']);
  });
});

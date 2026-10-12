/**
 * Phase 89 plan 03 (D-14 / D-17, FP-18): the read-back instrument for issues.dismiss holders.
 *
 * Every test builds a real-schema database (the real DASHBOARD_MIGRATIONS), seeds it, and SPAWNS the
 * committed script. Known-bad databases must exit 4; known-good ones 0; so the instrument has been
 * watched to say "dirty" before it is ever pointed at production.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DASHBOARD_MIGRATIONS, MigrationRunner } from '../../src/db/sqlite/migrations.js';

const PKG_JSON = resolve(__dirname, '../../package.json');
const SCRIPT = resolve(__dirname, '../../scripts/dismissal-permission-readback.mjs');
const PERM = 'issues.dismiss';
const SENTINEL = `zq${randomUUID().replace(/-/g, '').slice(0, 12)}`;

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly json: any;
}

function run(dbPath: string, args: readonly string[] = ['--expect', 'dark'], withDb = true): RunResult {
  const argv = [SCRIPT, ...(withDb ? ['--db', dbPath] : []), '--require-root', PKG_JSON, ...args];
  const res = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 60_000 });
  let json: unknown = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

/** A migrated database plus tiny seeding helpers. Roles/teams/users use plain INSERTs, as migrations-054.test.ts does. */
class Fixture {
  readonly dir = mkdtempSync(join(tmpdir(), 'readback-'));
  readonly path = join(this.dir, 'dashboard.db');
  readonly db: Database.Database;
  private readonly now = new Date().toISOString();

  constructor(walNoCheckpoint = false) {
    this.db = new Database(this.path);
    if (walNoCheckpoint) {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('wal_autocheckpoint = 0');
    }
    new MigrationRunner(this.db).run(DASHBOARD_MIGRATIONS);
  }

  org(orgId: string): void {
    this.db
      .prepare('INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
      .run(orgId, `${SENTINEL}-org-${orgId}`, `${SENTINEL}-slug-${orgId}`, this.now);
  }

  /** The five default org roles for an org (no permissions). Ids are `<org>:<name>`. */
  defaultRoles(orgId: string): void {
    this.org(orgId);
    for (const name of ['Owner', 'Admin', 'Member', 'Executive', 'Viewer']) this.role(`${orgId}:${name}`, name, orgId);
  }

  role(id: string, name: string, orgId: string, isSystem = 0): void {
    this.db
      .prepare('INSERT INTO roles (id, name, description, is_system, org_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, '', isSystem, orgId, this.now);
  }

  grant(roleId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)').run(roleId, PERM);
  }

  user(id: string, role: string, active = 1): void {
    this.db
      .prepare('INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, `${SENTINEL}-user-${id}`, 'x', role, active, this.now);
  }

  team(teamId: string, orgId: string, roleId: string | null): void {
    this.db
      .prepare('INSERT INTO teams (id, name, description, org_id, created_at, role_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(teamId, `${SENTINEL}-team-${teamId}`, '', orgId, this.now, roleId);
  }

  member(teamId: string, userId: string): void {
    this.db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, userId, 'member');
  }

  link(teamId: string, orgId: string): void {
    this.db.prepare('INSERT INTO team_org_links (team_id, org_id, linked_at) VALUES (?, ?, ?)').run(teamId, orgId, this.now);
  }

  key(id: string, opts: { org?: string; role?: string; active?: number; expiresAt?: string | null } = {}): void {
    this.db
      .prepare(
        'INSERT INTO api_keys (id, key_hash, label, active, created_at, org_id, role, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, `hash-${id}`, `${SENTINEL}-label-${id}`, opts.active ?? 1, this.now, opts.org ?? 'system', opts.role ?? 'admin', opts.expiresAt ?? null);
  }

  audit(action: string, actorId: string, details: string, timestamp = this.now): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (id, timestamp, actor, actor_id, action, resource_type, details, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), timestamp, `${SENTINEL}-actor`, actorId, action, 'session', details, 'system');
  }

  /** An org with its default roles and an Owner user in a team: the clean dark baseline. */
  baseline(orgId = 'org-a'): void {
    this.defaultRoles(orgId);
    this.user(`owner-${orgId}`, 'user');
    this.team(`team-${orgId}`, orgId, `${orgId}:Owner`);
    this.member(`team-${orgId}`, `owner-${orgId}`);
  }

  /** Every Owner and Admin default role of an org carries the permission (the post-grant state). */
  grantOwnerAdmin(orgId = 'org-a'): void {
    this.grant(`${orgId}:Owner`);
    this.grant(`${orgId}:Admin`);
  }

  close(): void {
    if (this.db.open) this.db.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

let fx: Fixture;
beforeEach(() => {
  fx = new Fixture();
});
afterEach(() => {
  fx.close();
});

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('dismissal-permission-readback: tracer (latent role rows)', () => {
  it('a clean migrated database measures dark with no violation', () => {
    fx.baseline();
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(0);
    expect(res.json.roleRows.total).toBe(0);
    expect(res.json.violations).toEqual([]);
    expect(res.json.expect).toBe('dark');
  });

  it('a custom org role carrying issues.dismiss is flagged as latent', () => {
    fx.baseline();
    fx.role('org-a:support', 'Support', 'org-a');
    fx.grant('org-a:support');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(4);
    expect(res.json.violations).toContain('latent-org-custom-role');
    expect(res.json.roleRows.orgCustom).toBe(1);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString();
const daysAhead = (n: number): string => new Date(Date.now() + n * DAY_MS).toISOString();

describe('dismissal-permission-readback: dark mode (D-14, pre-grant)', () => {
  it('a Member role carrying issues.dismiss is flagged as latent in dark mode', () => {
    fx.baseline();
    fx.grant('org-a:Member');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(4);
    expect(res.json.violations).toEqual(['latent-org-member-viewer-executive']);
  });

  it('a non-admin global role carrying issues.dismiss is flagged in dark mode', () => {
    fx.baseline();
    fx.grant('developer');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(4);
    expect(res.json.violations).toEqual(['latent-system-role']);
    expect(res.json.roleRows.systemOther).toBe(1);
  });

  it('the system admin role row alone is not a violation in dark mode', () => {
    fx.baseline();
    fx.grant('admin');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(0);
    expect(res.json.roleRows.systemAdmin).toBe(1);
    expect(res.json.violations).toEqual([]);
  });

  it('an Owner or Admin row before the grant is flagged as latent (the grant must not be applied out of order)', () => {
    fx.baseline();
    fx.grant('org-a:Owner');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(4);
    expect(res.json.violations).toEqual(['latent-org-owner-admin']);
  });

  it('a global admin who is a member of a customer-org team is flagged', () => {
    fx.baseline();
    fx.user('root-1', 'admin');
    fx.member('team-org-a', 'root-1');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(4);
    expect(res.json.violations).toContain('global-admin-in-customer-org-team');
    expect(res.json.globalAdmins).toEqual({ total: 1, inCustomerOrgTeam: 1 });
  });

  it('a global admin reaching a customer org only through a team_org_links row is flagged', () => {
    fx.baseline();
    fx.user('root-1', 'admin');
    fx.team('team-sys', 'system', null);
    fx.member('team-sys', 'root-1');
    fx.link('team-sys', 'org-a');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(4);
    expect(res.json.violations).toContain('global-admin-in-customer-org-team');
  });

  it('a global admin in a system-org team, and an inactive admin in a customer team, are not flagged', () => {
    fx.baseline();
    fx.user('root-1', 'admin');
    fx.team('team-sys', 'system', null);
    fx.member('team-sys', 'root-1');
    fx.user('root-2', 'admin', 0);
    fx.member('team-org-a', 'root-2');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(0);
    expect(res.json.globalAdmins).toEqual({ total: 1, inCustomerOrgTeam: 0 });
    expect(res.json.needsHumanConfirmation).toEqual(['globalAdminIdentities']);
  });

  it('users reached by each flagged role are counted', () => {
    fx.baseline();
    fx.role('org-a:support', 'Support', 'org-a');
    fx.grant('org-a:support');
    fx.team('team-support', 'org-a', 'org-a:support');
    fx.user('u1', 'user');
    fx.user('u2', 'user');
    fx.member('team-support', 'u1');
    fx.member('team-support', 'u2');
    fx.grant('developer');
    fx.user('d1', 'developer');
    fx.user('d2', 'developer');
    fx.user('d3', 'developer', 0);
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(4);
    expect(res.json.reach.orgCustom).toEqual({ teamMembers: 2, globalRoleUsers: 0 });
    expect(res.json.reach.systemOther).toEqual({ teamMembers: 0, globalRoleUsers: 2 });
  });
});

describe('dismissal-permission-readback: api keys and login history', () => {
  it('api keys are bucketed by scope and role and expired or inactive keys are excluded', () => {
    fx.baseline();
    fx.org('org-b');
    fx.key('k-sys-admin', { org: 'system', role: 'admin' });
    fx.key('k-sys-admin-future', { org: 'system', role: 'admin', expiresAt: daysAhead(10) });
    fx.key('k-sys-ro', { org: 'system', role: 'read-only' });
    fx.key('k-org-admin', { org: 'org-a', role: 'admin' });
    fx.key('k-org-scan', { org: 'org-b', role: 'scan-only' });
    fx.key('k-org-admin-expired', { org: 'org-a', role: 'admin', expiresAt: daysAgo(1) });
    fx.key('k-sys-admin-inactive', { org: 'system', role: 'admin', active: 0 });
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(0);
    expect(res.json.apiKeys).toMatchObject({ active: 5, systemAdmin: 2, systemOther: 1, orgAdmin: 1, orgOther: 1 });
    expect(res.json.apiKeys.orgAdminKeysHoldViaOwnerCap).toBe(1);
  });

  it('api-key login history is counted and live sessions are declared unmeasurable', () => {
    fx.baseline();
    fx.audit('login.success', 'api-key', 'API key login', daysAgo(40));
    fx.audit('login.success', 'api-key', 'API key login', daysAgo(2));
    fx.audit('login.success', 'api-key', 'API key login', daysAgo(1));
    fx.audit('login.success', 'someone-else', 'Password login', daysAgo(1));
    fx.audit('login.failure', 'unknown', 'API key refused for dashboard login (org-scoped)', daysAgo(3));
    fx.audit('login.failure', 'unknown', 'API key refused for dashboard login (not-admin)', daysAgo(3));
    fx.audit('login.failure', 'unknown', 'Invalid API key', daysAgo(3));
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(0);
    expect(res.json.apiKeyLogins).toEqual({ loginSuccess: { total: 3, last30Days: 2 }, loginRefused: 2 });
    expect(res.json.unmeasurable).toEqual(['apiKeyLoginSessions']);
    expect(typeof res.json.unmeasurableReasons.apiKeyLoginSessions).toBe('string');
  });

  it('an empty identity set measures nothing', () => {
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(3);
    expect(res.stderr).toContain('measured nothing');
    expect(res.json.identities).toEqual({ activeUsers: 0, activeApiKeys: 0 });
  });

  it('a violation outranks measured-nothing so a dirty empty database cannot read as nothing-to-see', () => {
    fx.defaultRoles('org-a');
    fx.grant('org-a:Member');
    fx.db.close();
    const res = run(fx.path);
    expect(res.status).toBe(4);
  });
});

describe('dismissal-permission-readback: granted mode (D-17, post-grant)', () => {
  it('granted mode passes when every Owner and Admin role carries the permission', () => {
    fx.baseline('org-a');
    fx.baseline('org-b');
    fx.grantOwnerAdmin('org-a');
    fx.grantOwnerAdmin('org-b');
    fx.key('k-org-admin', { org: 'org-a', role: 'admin' });
    fx.db.close();
    const res = run(fx.path, ['--expect', 'granted']);
    expect(res.status).toBe(0);
    expect(res.json.violations).toEqual([]);
    expect(res.json.ownerAdminRoles).toEqual({ total: 4, withRow: 4, missing: 0 });
    expect(res.json.apiKeys.orgAdminKeysHoldViaOwnerCap).toBe(1);
  });

  it('granted mode flags a missing Admin row as grant-incomplete', () => {
    fx.baseline('org-a');
    fx.grant('org-a:Owner');
    fx.db.close();
    const res = run(fx.path, ['--expect', 'granted']);
    expect(res.status).toBe(4);
    expect(res.json.violations).toEqual(['grant-incomplete']);
    expect(res.json.ownerAdminRoles).toEqual({ total: 2, withRow: 1, missing: 1 });
  });

  it('granted mode flags a custom role unless custom roles are allowed', () => {
    fx.baseline('org-a');
    fx.grantOwnerAdmin('org-a');
    fx.role('org-a:support', 'Support', 'org-a');
    fx.grant('org-a:support');
    fx.db.close();
    const refused = run(fx.path, ['--expect', 'granted']);
    expect(refused.status).toBe(4);
    expect(refused.json.violations).toEqual(['granted-to-custom-role']);
    const allowed = run(fx.path, ['--expect', 'granted', '--allow-custom-roles', 'true']);
    expect(allowed.status).toBe(0);
    expect(allowed.json.violations).toEqual([]);
    expect(allowed.json.allowCustomRoles).toBe(true);
    expect(allowed.json.roleRows.orgCustom).toBe(1);
  });

  it('granted mode flags issues.dismiss on Member, Viewer, Executive or a non-admin system role', () => {
    for (const [roleId, check] of [
      ['org-a:Member', 'granted-to-member-viewer-executive'],
      ['org-a:Viewer', 'granted-to-member-viewer-executive'],
      ['org-a:Executive', 'granted-to-member-viewer-executive'],
      ['developer', 'granted-to-system-role'],
    ] as const) {
      const f = new Fixture();
      try {
        f.baseline('org-a');
        f.grantOwnerAdmin('org-a');
        f.grant(roleId);
        f.db.close();
        const res = run(f.path, ['--expect', 'granted', '--allow-custom-roles', 'true']);
        expect(res.status, roleId).toBe(4);
        expect(res.json.violations, roleId).toEqual([check]);
      } finally {
        f.close();
      }
    }
  });

  it('granted mode still flags a global admin in a customer-org team', () => {
    fx.baseline('org-a');
    fx.grantOwnerAdmin('org-a');
    fx.user('root-1', 'admin');
    fx.member('team-org-a', 'root-1');
    fx.db.close();
    const res = run(fx.path, ['--expect', 'granted']);
    expect(res.status).toBe(4);
    expect(res.json.violations).toEqual(['global-admin-in-customer-org-team']);
  });
});

describe('dismissal-permission-readback: arguments and failures', () => {
  it('bad arguments exit 2', () => {
    fx.baseline();
    fx.db.close();
    expect(run(fx.path, []).status, 'missing --expect').toBe(2);
    expect(run(fx.path, ['--expect', 'dark', '--bogus', 'x']).status, 'unknown option').toBe(2);
    expect(run(fx.path, ['--expect', 'maybe']).status, 'expect outside dark|granted').toBe(2);
    expect(run(fx.path, ['--expect', 'granted', '--allow-custom-roles', 'yes']).status, 'non-boolean value').toBe(2);
    expect(run(fx.path, ['--expect', 'dark', '--allow-custom-roles', 'true']).status, 'inert flag in dark mode').toBe(2);
    expect(run(fx.path, ['--expect', 'dark'], false).status, 'missing --db').toBe(2);
  });

  it('a missing database file is fatal and prints only the error name and code', () => {
    const missing = join(fx.dir, `${SENTINEL}-nope.db`);
    const res = run(missing);
    expect(res.status).toBe(1);
    expect(res.stderr.trim()).toBe('fatal: SqliteError SQLITE_CANTOPEN');
    expect(res.stdout).toBe('');
  });

  it('a missing schema column is fatal and names table.column only', () => {
    const bare = join(fx.dir, 'bare.db');
    const b = new Database(bare);
    b.exec('CREATE TABLE roles (id TEXT, name TEXT)');
    b.close();
    const res = run(bare);
    expect(res.status).toBe(1);
    expect(res.stderr.trim()).toBe('fatal: SchemaGap roles.is_system');
  });

  it('a read-only database file is measured without writing', () => {
    // Root bypasses file modes, so 0444 alone cannot prove a read-only open here. The discriminating
    // control is a WAL database with an un-checkpointed -wal: a writable open+close folds the WAL into
    // the main file, a read-only open leaves both files byte-identical.
    const src = new Fixture(true);
    const dirs: string[] = [];
    try {
      src.baseline();
      src.role('org-a:support', 'Support', 'org-a');
      src.grant('org-a:support');
      const copyTo = (mode: number): string => {
        const dir = mkdtempSync(join(tmpdir(), 'readback-copy-'));
        dirs.push(dir);
        const main = join(dir, 'dashboard.db');
        copyFileSync(src.path, main);
        copyFileSync(`${src.path}-wal`, `${main}-wal`);
        chmodSync(main, mode);
        chmodSync(`${main}-wal`, mode);
        return main;
      };
      expect(statSync(`${src.path}-wal`).size, 'premise: rows live only in the WAL').toBeGreaterThan(0);
      const readOnlyCopy = copyTo(0o444);
      const writableCopy = copyTo(0o644);
      const digest = (main: string): string[] =>
        [main, `${main}-wal`].map((f) => (existsSync(f) ? sha256(f) : 'MISSING'));
      const before = digest(readOnlyCopy);
      const a = run(readOnlyCopy);
      const b = run(writableCopy);
      expect(a.status).toBe(4);
      expect(a.json.violations).toContain('latent-org-custom-role');
      expect(a.json).toEqual(b.json);
      expect(digest(readOnlyCopy)).toEqual(before);
      expect(digest(writableCopy)).toEqual(before);
    } finally {
      src.close();
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('dismissal-permission-readback: output discipline', () => {
  it('no seeded identifier appears in the output', () => {
    fx.defaultRoles(`${SENTINEL}-org`);
    fx.org(`${SENTINEL}-org-b`);
    fx.role(`${SENTINEL}-role`, `${SENTINEL}-custom-role`, `${SENTINEL}-org`);
    fx.grant(`${SENTINEL}-role`);
    fx.grant(`${SENTINEL}-org:Member`);
    fx.user(`${SENTINEL}-root`, 'admin');
    fx.user(`${SENTINEL}-u1`, 'user');
    fx.team(`${SENTINEL}-team`, `${SENTINEL}-org`, `${SENTINEL}-role`);
    fx.member(`${SENTINEL}-team`, `${SENTINEL}-u1`);
    fx.member(`${SENTINEL}-team`, `${SENTINEL}-root`);
    fx.link(`${SENTINEL}-team`, `${SENTINEL}-org-b`);
    fx.key(`${SENTINEL}-key`, { org: `${SENTINEL}-org`, role: 'admin' });
    fx.key(`${SENTINEL}-key-sys`, { org: 'system', role: 'admin' });
    fx.audit('login.success', 'api-key', `${SENTINEL} details`);
    fx.audit('login.failure', 'unknown', `${SENTINEL} (org-scoped)`);
    const seeded = fx.db
      .prepare('SELECT (SELECT COUNT(*) FROM dashboard_users WHERE username LIKE ?) + (SELECT COUNT(*) FROM api_keys WHERE label LIKE ?) AS n')
      .get(`%${SENTINEL}%`, `%${SENTINEL}%`) as { n: number };
    expect(seeded.n, 'premise: the sentinel is in the database').toBeGreaterThan(0);
    fx.db.close();
    for (const args of [['--expect', 'dark'], ['--expect', 'granted'], ['--expect', 'granted', '--allow-custom-roles', 'true']]) {
      const res = run(fx.path, args);
      expect(res.status, args.join(' ')).toBe(4);
      expect(res.stdout + res.stderr).not.toContain(SENTINEL);
    }
  });

  it('every count in the output is a non-negative integer', () => {
    fx.baseline();
    fx.key('k1', { org: 'org-a', role: 'admin' });
    fx.audit('login.success', 'api-key', 'API key login');
    fx.db.close();
    const res = run(fx.path);
    const bad: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0) bad.push(path);
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(res.json, '$');
    expect(bad).toEqual([]);
  });
});

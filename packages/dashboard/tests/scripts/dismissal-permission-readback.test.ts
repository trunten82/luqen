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
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

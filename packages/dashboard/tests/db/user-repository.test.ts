import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from '../../src/db/sqlite/migrations.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

/**
 * Phase 38 Plan 01 (AORG-03) — per-user `active_org_id` persistence.
 *
 * Tests cover:
 *   1. Migration 061 — column presence, nullable, default null, idempotent.
 *   2. UserRepository — DashboardUser.activeOrgId surfaced from row mapper;
 *      setActiveOrgId set / clear / unknown-user / idempotency semantics.
 */

interface PragmaTableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function makeFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function makeTempStorage(): { storage: SqliteStorageAdapter; path: string } {
  const path = join(tmpdir(), `test-user-repo-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

// ---------------------------------------------------------------------------
// Migration 061 — column presence + idempotence
// ---------------------------------------------------------------------------

describe('migration 061 — agent-active-org', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeFreshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('is registered in DASHBOARD_MIGRATIONS with id "061" and an ALTER TABLE on dashboard_users', () => {
    const entry = DASHBOARD_MIGRATIONS.find((m) => m.id === '061');
    expect(entry).toBeDefined();
    expect(entry!.sql).toContain('ALTER TABLE dashboard_users');
    expect(entry!.sql).toContain('active_org_id');
  });

  it('adds a TEXT column `active_org_id` to dashboard_users', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const cols = db
      .prepare("PRAGMA table_info('dashboard_users')")
      .all() as PragmaTableInfoRow[];
    const col = cols.find((c) => c.name === 'active_org_id');
    expect(col).toBeDefined();
    expect(col!.type.toUpperCase()).toBe('TEXT');
  });

  it('leaves `active_org_id` nullable (notnull=0, dflt_value=null)', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const cols = db
      .prepare("PRAGMA table_info('dashboard_users')")
      .all() as PragmaTableInfoRow[];
    const col = cols.find((c) => c.name === 'active_org_id')!;
    expect(col.notnull).toBe(0);
    expect(col.dflt_value).toBeNull();
  });

  it('is idempotent — running migrations twice does not throw and yields a single column', () => {
    const runner = new MigrationRunner(db);
    expect(() => runner.run(DASHBOARD_MIGRATIONS)).not.toThrow();
    expect(() => runner.run(DASHBOARD_MIGRATIONS)).not.toThrow();
    const cols = db
      .prepare("PRAGMA table_info('dashboard_users')")
      .all() as PragmaTableInfoRow[];
    const matches = cols.filter((c) => c.name === 'active_org_id');
    expect(matches).toHaveLength(1);
  });

  it('is appended directly after migration 060', () => {
    const index060 = DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '060');
    const index061 = DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '061');
    expect(index060).toBeGreaterThanOrEqual(0);
    expect(index061).toBe(index060 + 1);
  });
});

// ---------------------------------------------------------------------------
// UserRepository — activeOrgId field + setActiveOrgId
// ---------------------------------------------------------------------------

describe('UserRepository — active_org_id', () => {
  let storage: SqliteStorageAdapter;
  let dbPath: string;

  beforeEach(() => {
    const r = makeTempStorage();
    storage = r.storage;
    dbPath = r.path;
  });

  afterEach(() => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it('getUserById returns activeOrgId=null for a fresh user', async () => {
    const created = await storage.users.createUser('alice', 'pw1234567', 'admin');
    const found = await storage.users.getUserById(created.id);
    expect(found).not.toBeNull();
    expect(found!.activeOrgId).toBeNull();
  });

  it('getUserByUsername also surfaces activeOrgId', async () => {
    await storage.users.createUser('bob', 'pw1234567', 'admin');
    const found = await storage.users.getUserByUsername('bob');
    expect(found).not.toBeNull();
    expect(found!.activeOrgId).toBeNull();
  });

  it('setActiveOrgId writes the value and getUserById reflects it', async () => {
    const u = await storage.users.createUser('carol', 'pw1234567', 'admin');
    const ok = await storage.users.setActiveOrgId(u.id, 'org-A');
    expect(ok).toBe(true);

    const found = await storage.users.getUserById(u.id);
    expect(found!.activeOrgId).toBe('org-A');
  });

  it('setActiveOrgId(null) clears the value back to null', async () => {
    const u = await storage.users.createUser('dave', 'pw1234567', 'admin');
    await storage.users.setActiveOrgId(u.id, 'org-A');

    const cleared = await storage.users.setActiveOrgId(u.id, null);
    expect(cleared).toBe(true);

    const found = await storage.users.getUserById(u.id);
    expect(found!.activeOrgId).toBeNull();
  });

  it('setActiveOrgId on an unknown user returns false and inserts no row', async () => {
    const ok = await storage.users.setActiveOrgId(randomUUID(), 'org-A');
    expect(ok).toBe(false);
    expect(await storage.users.countUsers()).toBe(0);
  });

  it('setActiveOrgId is idempotent — two consecutive sets to the same value both return true', async () => {
    const u = await storage.users.createUser('eve', 'pw1234567', 'admin');
    const first = await storage.users.setActiveOrgId(u.id, 'org-A');
    const second = await storage.users.setActiveOrgId(u.id, 'org-A');
    expect(first).toBe(true);
    expect(second).toBe(true);

    const found = await storage.users.getUserById(u.id);
    expect(found!.activeOrgId).toBe('org-A');
  });

  it('listUsers entries also surface activeOrgId', async () => {
    const a = await storage.users.createUser('frank', 'pw1234567', 'admin');
    await storage.users.createUser('grace', 'pw1234567', 'viewer');
    await storage.users.setActiveOrgId(a.id, 'org-Z');

    const all = await storage.users.listUsers();
    const frank = all.find((u) => u.username === 'frank')!;
    const grace = all.find((u) => u.username === 'grace')!;
    expect(frank.activeOrgId).toBe('org-Z');
    expect(grace.activeOrgId).toBeNull();
  });
});

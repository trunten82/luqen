/**
 * Phase 37 Plan 01 — Migrations 058 (agent_messages supersede) + 059 (agent_share_links).
 *
 * Plan baseline is migration 057 (agent-audit-log-rationale). These two
 * migrations append after, providing:
 *   - 058: superseded_at column on agent_messages + partial active index
 *   - 059: agent_share_links table for AUX-05 permalinks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from '../../src/db/sqlite/migrations.js';

interface PragmaTableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface PragmaIndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

function makeFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('migration 058 — agent-messages-supersede', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeFreshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('is registered with id "058" and name "agent-messages-supersede"', () => {
    const entry = DASHBOARD_MIGRATIONS.find((m) => m.id === '058');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('agent-messages-supersede');
  });

  it('appends after migration 057', () => {
    const i057 = DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '057');
    const i058 = DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '058');
    expect(i057).toBeGreaterThanOrEqual(0);
    expect(i058).toBe(i057 + 1);
  });

  it('adds nullable superseded_at TEXT column on agent_messages', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const cols = db
      .prepare("PRAGMA table_info('agent_messages')")
      .all() as PragmaTableInfoRow[];
    const col = cols.find((c) => c.name === 'superseded_at');
    expect(col).toBeDefined();
    expect(col!.type.toUpperCase()).toBe('TEXT');
    expect(col!.notnull).toBe(0);
    expect(col!.dflt_value).toBeNull();
  });

  it('creates partial active-status index idx_agent_messages_conv_active_created', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const idx = db
      .prepare("PRAGMA index_list('agent_messages')")
      .all() as PragmaIndexListRow[];
    const found = idx.find((i) => i.name === 'idx_agent_messages_conv_active_created');
    expect(found).toBeDefined();
    expect(found!.partial).toBe(1);
  });

  it('is idempotent — re-running migrations does not throw', () => {
    const runner = new MigrationRunner(db);
    expect(() => runner.run(DASHBOARD_MIGRATIONS)).not.toThrow();
    expect(() => runner.run(DASHBOARD_MIGRATIONS)).not.toThrow();
  });
});

describe('migration 059 — agent-share-links', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeFreshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('is registered with id "059" and name "agent-share-links"', () => {
    const entry = DASHBOARD_MIGRATIONS.find((m) => m.id === '059');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('agent-share-links');
  });

  it('appends after migration 058', () => {
    const i058 = DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '058');
    const i059 = DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '059');
    expect(i058).toBeGreaterThanOrEqual(0);
    expect(i059).toBe(i058 + 1);
  });

  it('creates agent_share_links table with the expected columns', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const cols = db
      .prepare("PRAGMA table_info('agent_share_links')")
      .all() as PragmaTableInfoRow[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'conversation_id',
        'org_id',
        'anchor_message_id',
        'created_by_user_id',
        'created_at',
        'revoked_at',
      ].sort(),
    );

    const id = cols.find((c) => c.name === 'id')!;
    expect(id.pk).toBe(1);

    const anchor = cols.find((c) => c.name === 'anchor_message_id')!;
    expect(anchor.notnull).toBe(0);
    const revoked = cols.find((c) => c.name === 'revoked_at')!;
    expect(revoked.notnull).toBe(0);

    const conv = cols.find((c) => c.name === 'conversation_id')!;
    expect(conv.notnull).toBe(1);
    const org = cols.find((c) => c.name === 'org_id')!;
    expect(org.notnull).toBe(1);
    const createdBy = cols.find((c) => c.name === 'created_by_user_id')!;
    expect(createdBy.notnull).toBe(1);
    const createdAt = cols.find((c) => c.name === 'created_at')!;
    expect(createdAt.notnull).toBe(1);
  });

  it('creates supporting indexes idx_agent_share_links_org and idx_agent_share_links_conv', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const idx = db
      .prepare("PRAGMA index_list('agent_share_links')")
      .all() as PragmaIndexListRow[];
    const names = idx.map((i) => i.name);
    expect(names).toContain('idx_agent_share_links_org');
    expect(names).toContain('idx_agent_share_links_conv');
  });

  it('cascades on conversation delete (FK ON DELETE CASCADE)', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);

    // Seed minimum dependencies for FK insertion. agent_conversations FKs to
    // dashboard_users; create both upstream rows.
    db.prepare(
      `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
       VALUES ('u1','u1','hash','user',1,'2026-04-25T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_conversations
         (id, user_id, org_id, title, created_at, updated_at, last_message_at)
       VALUES ('c1','u1','org-a','t','2026-04-25T00:00:00Z','2026-04-25T00:00:00Z',NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO agent_share_links
         (id, conversation_id, org_id, anchor_message_id, created_by_user_id, created_at, revoked_at)
       VALUES ('s1','c1','org-a',NULL,'u1','2026-04-25T00:00:00Z',NULL)`,
    ).run();

    const before = db
      .prepare(`SELECT COUNT(*) AS n FROM agent_share_links`)
      .get() as { n: number };
    expect(before.n).toBe(1);

    db.prepare(`DELETE FROM agent_conversations WHERE id = 'c1'`).run();

    const after = db
      .prepare(`SELECT COUNT(*) AS n FROM agent_share_links`)
      .get() as { n: number };
    expect(after.n).toBe(0);
  });

  it('is idempotent — re-running migrations does not throw', () => {
    const runner = new MigrationRunner(db);
    expect(() => runner.run(DASHBOARD_MIGRATIONS)).not.toThrow();
    expect(() => runner.run(DASHBOARD_MIGRATIONS)).not.toThrow();
  });
});

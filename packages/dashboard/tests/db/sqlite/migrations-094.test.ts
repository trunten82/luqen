/**
 * Phase 94 (SESS-02) — migration 094: one nullable column on agent_conversations that holds the
 * token of the answer stream that may write the conversation now.
 *
 * "Existing" is modelled as in migrations-093.test.ts: the list WITHOUT 094 runs first on a real
 * SQLite file, conversation rows are seeded with plain INSERTs, then the full list runs. The
 * MigrationRunner runs only ids it has not applied yet, so the second run applies 094 alone.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from '../../../src/db/sqlite/migrations.js';

const COLUMN = 'active_run_id';
const BEFORE_094 = DASHBOARD_MIGRATIONS.filter((m) => m.id !== '094');

interface ColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: unknown;
}

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function openDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-094-'));
  dirs.push(dir);
  const db = new Database(join(dir, 'dashboard.db'));
  db.pragma('journal_mode = WAL');
  return db;
}

function runColumn(db: Database.Database): ColumnInfo | undefined {
  return (db.prepare('PRAGMA table_info(agent_conversations)').all() as ColumnInfo[]).find((c) => c.name === COLUMN);
}

function appliedIds(db: Database.Database): string[] {
  return (db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
}

/** A user and conversations the way an existing database holds them (plain INSERTs, no run token). */
function seedConversations(db: Database.Database, ids: readonly string[]): void {
  db.prepare(`INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
              VALUES ('u-1', 'fabrikam-user', 'x', 'viewer', 1, '2026-10-01T00:00:00.000Z')`).run();
  const insert = db.prepare(`INSERT INTO agent_conversations (id, user_id, org_id, created_at, updated_at)
                             VALUES (?, 'u-1', 'org-fabrikam', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`);
  for (const id of ids) insert.run(id);
}

describe('migration 094: the conversation run token column', () => {
  it('094 is registered as the last migration', () => {
    const mig = DASHBOARD_MIGRATIONS.find((m) => m.id === '094');
    expect(mig?.name).toBe('agent-conversation-active-run');
    expect(DASHBOARD_MIGRATIONS[DASHBOARD_MIGRATIONS.length - 1]!.id).toBe('094');
    // Exactly one statement changes the schema, and it adds this one column.
    const statements = mig!.sql.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(statements).toEqual([`ALTER TABLE agent_conversations ADD COLUMN ${COLUMN} TEXT;`]);
  });

  it('SESS-02 migration 094 adds a nullable run token column and leaves existing conversations null', () => {
    const db = openDb();
    new MigrationRunner(db).run(BEFORE_094);
    expect(runColumn(db)).toBeUndefined(); // positive control: the pre-094 schema
    seedConversations(db, ['conv-1', 'conv-2']);
    const before = appliedIds(db);

    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);

    expect(appliedIds(db).filter((id) => !before.includes(id))).toEqual(['094']);
    const col = runColumn(db);
    expect(col).toEqual({ ...col, name: COLUMN, type: 'TEXT', notnull: 0, dflt_value: null });
    const total = db.prepare('SELECT COUNT(*) AS n FROM agent_conversations').get() as { n: number };
    const nulls = db.prepare(`SELECT COUNT(*) AS n FROM agent_conversations WHERE ${COLUMN} IS NULL`).get() as { n: number };
    expect(total.n).toBe(2);
    expect(nulls.n).toBe(2);

    // A re-run applies nothing.
    const again = appliedIds(db);
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    expect(appliedIds(db)).toEqual(again);
    db.close();
  });
});

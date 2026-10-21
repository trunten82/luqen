/**
 * Phase 91 (HARD-08, D-91-10) — migration 092: one nullable column on issue_dismissals that keeps
 * the marking API key's label and creation time.
 *
 * "Existing" is modelled as in migrations-091.test.ts: the list WITHOUT 092 runs first on a real
 * SQLite file, dismissal rows are seeded with plain INSERTs, then the full list runs. The
 * MigrationRunner runs only ids it has not applied yet, so the second run applies 092 alone.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from '../../../src/db/sqlite/migrations.js';
import { SqliteIssueDismissalRepository } from '../../../src/db/sqlite/repositories/issue-dismissal-repository.js';

const COLUMN = 'created_by_key_snapshot';
const BEFORE_092 = DASHBOARD_MIGRATIONS.filter((m) => m.id !== '092');

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
  const dir = mkdtempSync(join(tmpdir(), 'migrations-092-'));
  dirs.push(dir);
  const db = new Database(join(dir, 'dashboard.db'));
  db.pragma('journal_mode = WAL');
  return db;
}

function snapshotColumn(db: Database.Database): ColumnInfo | undefined {
  return (db.prepare('PRAGMA table_info(issue_dismissals)').all() as ColumnInfo[]).find((c) => c.name === COLUMN);
}

function appliedIds(db: Database.Database): string[] {
  return (db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
}

describe('migration 092: the dismissal key snapshot column', () => {
  it('092 is registered', () => {
    const mig = DASHBOARD_MIGRATIONS.find((m) => m.id === '092');
    expect(mig?.name).toBe('add-dismissal-key-snapshot');
    // Exactly one statement changes the schema, and it adds this one column.
    const statements = mig!.sql.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(statements).toEqual([`ALTER TABLE issue_dismissals ADD COLUMN ${COLUMN} TEXT;`]);
  });

  it('HARD-08 migration adds a nullable snapshot column and leaves existing rows null', async () => {
    const db = openDb();
    new MigrationRunner(db).run(BEFORE_092);
    expect(snapshotColumn(db)).toBeUndefined(); // positive control: the pre-092 schema
    const insert = db.prepare(`
      INSERT INTO issue_dismissals
        (id, org_id, site_url, site_key, code, selector, reason, status, created_by, created_by_id, created_at)
      VALUES (?, 'org-fabrikam', 'https://example.com/', 'https://example.com', 'WCAG2AA.1_4_3', ?, 'seeded',
              'active', ?, ?, ?)`);
    insert.run('d-1', '#hero > p', 'alice', 'u-1', '2026-10-01T00:00:00.000Z');
    insert.run('d-2', '#nav a', 'api-key:k-1', 'api-key:k-1', '2026-10-02T00:00:00.000Z');
    const before = appliedIds(db);

    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);

    expect(appliedIds(db).filter((id) => !before.includes(id))).toEqual(['092']);
    const col = snapshotColumn(db);
    expect(col).toEqual({ ...col, name: COLUMN, type: 'TEXT', notnull: 0, dflt_value: null });
    const nulls = db.prepare(`SELECT COUNT(*) AS n FROM issue_dismissals WHERE ${COLUMN} IS NULL`).get() as { n: number };
    expect(nulls.n).toBe(2);

    const repo = new SqliteIssueDismissalRepository(db);
    for (const id of ['d-1', 'd-2']) {
      const d = await repo.getById(id);
      expect(d, id).not.toBeNull();
      expect(d!.createdByKeySnapshot, id).toBeNull();
    }

    // A re-run applies nothing.
    const again = appliedIds(db);
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    expect(appliedIds(db)).toEqual(again);
    db.close();
  });
});

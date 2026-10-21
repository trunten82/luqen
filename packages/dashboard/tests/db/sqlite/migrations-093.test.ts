/**
 * Phase 91 (HARD-21) — migration 093: one nullable column on oauth_user_consents that keeps the
 * organization a remembered consent was given in.
 *
 * "Existing" is modelled as in migrations-092.test.ts: the list WITHOUT 093 runs first on a real
 * SQLite file, consent rows are seeded with plain INSERTs, then the full list runs. The
 * MigrationRunner runs only ids it has not applied yet, so the second run applies 093 alone.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from '../../../src/db/sqlite/migrations.js';
import { SqliteOauthConsentRepository } from '../../../src/db/sqlite/repositories/oauth-consent-repository.js';

const COLUMN = 'org_id';
const BEFORE_093 = DASHBOARD_MIGRATIONS.filter((m) => m.id !== '093');

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
  const dir = mkdtempSync(join(tmpdir(), 'migrations-093-'));
  dirs.push(dir);
  const db = new Database(join(dir, 'dashboard.db'));
  db.pragma('journal_mode = WAL');
  return db;
}

function orgColumn(db: Database.Database): ColumnInfo | undefined {
  return (db.prepare('PRAGMA table_info(oauth_user_consents)').all() as ColumnInfo[]).find((c) => c.name === COLUMN);
}

function appliedIds(db: Database.Database): string[] {
  return (db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
}

/** A user and an OAuth client the consent rows can point at (plain INSERTs, as an existing database holds them). */
function seedUserAndClients(db: Database.Database, clients: readonly string[]): void {
  db.prepare(`INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
              VALUES ('u-1', 'fabrikam-user', 'x', 'viewer', 1, '2026-10-01T00:00:00.000Z')`).run();
  const insert = db.prepare(`INSERT INTO oauth_clients_v2
    (id, client_id, client_name, redirect_uris, token_endpoint_auth_method, created_at)
    VALUES (?, ?, 'Example client', '["https://mcp-client.example/callback"]', 'none', '2026-10-01T00:00:00.000Z')`);
  for (const id of clients) insert.run(`row-${id}`, id);
}

function insertConsent(db: Database.Database, id: string, clientId: string): void {
  db.prepare(`INSERT INTO oauth_user_consents (id, user_id, client_id, scopes, resources, consented_at, updated_at)
              VALUES (?, 'u-1', ?, '["read"]', '["https://example.com/mcp"]', '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z')`)
    .run(id, clientId);
}

describe('migration 093: the consent organization column', () => {
  it('093 is registered as the last migration', () => {
    const mig = DASHBOARD_MIGRATIONS.find((m) => m.id === '093');
    expect(mig?.name).toBe('oauth-consent-organization');
    expect(DASHBOARD_MIGRATIONS[DASHBOARD_MIGRATIONS.length - 1]!.id).toBe('093');
    // Exactly one statement changes the schema, and it adds this one column.
    const statements = mig!.sql.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(statements).toEqual([`ALTER TABLE oauth_user_consents ADD COLUMN ${COLUMN} TEXT;`]);
  });

  it('HARD-21 migration 093 adds a nullable organization column and leaves existing consents null', () => {
    const db = openDb();
    new MigrationRunner(db).run(BEFORE_093);
    expect(orgColumn(db)).toBeUndefined(); // positive control: the pre-093 schema
    seedUserAndClients(db, ['client-a', 'client-b']);
    insertConsent(db, 'c-1', 'client-a');
    insertConsent(db, 'c-2', 'client-b');
    const before = appliedIds(db);

    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);

    expect(appliedIds(db).filter((id) => !before.includes(id))).toEqual(['093']);
    const col = orgColumn(db);
    expect(col).toEqual({ ...col, name: COLUMN, type: 'TEXT', notnull: 0, dflt_value: null });
    const total = db.prepare('SELECT COUNT(*) AS n FROM oauth_user_consents').get() as { n: number };
    const nulls = db.prepare(`SELECT COUNT(*) AS n FROM oauth_user_consents WHERE ${COLUMN} IS NULL`).get() as { n: number };
    expect(total.n).toBe(2);
    expect(nulls.n).toBe(2);

    // A re-run applies nothing.
    const again = appliedIds(db);
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    expect(appliedIds(db)).toEqual(again);
    db.close();
  });

  it('HARD-21 consents recorded without an organization cover no organization', async () => {
    const db = openDb();
    new MigrationRunner(db).run(BEFORE_093);
    seedUserAndClients(db, ['client-a', 'client-b']);
    insertConsent(db, 'c-old', 'client-a');
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const repo = new SqliteOauthConsentRepository(db);
    const ask = (clientId: string, orgId: string) =>
      repo.checkCoverage({
        userId: 'u-1', clientId, orgId, requestedScopes: ['read'], requestedResources: ['https://example.com/mcp'],
      });

    // The consent recorded before the migration holds no organization: it covers none.
    expect((await ask('client-a', 'org-a')).covered).toBe(false);
    expect((await ask('client-a', 'org-b')).covered).toBe(false);

    // A consent recorded for org A covers org A and not org B.
    await repo.recordConsent({
      userId: 'u-1', clientId: 'client-b', orgId: 'org-a', scopes: ['read'], resources: ['https://example.com/mcp'],
    });
    expect((await ask('client-b', 'org-a')).covered).toBe(true); // positive control
    expect((await ask('client-b', 'org-b')).covered).toBe(false);

    // Approving the older client's page once more records its organization.
    await repo.recordConsent({
      userId: 'u-1', clientId: 'client-a', orgId: 'org-b', scopes: ['read'], resources: ['https://example.com/mcp'],
    });
    expect((await ask('client-a', 'org-b')).covered).toBe(true);
    expect((await ask('client-a', 'org-a')).covered).toBe(false);
    db.close();
  });
});

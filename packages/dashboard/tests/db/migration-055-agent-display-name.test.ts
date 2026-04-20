import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from '../../src/db/sqlite/migrations.js';

/**
 * Phase 32 Plan 03 — Migration 055 (agent-display-name).
 *
 * Adds a nullable TEXT column `agent_display_name` to the `organizations`
 * table so the agent's first-open greeting (D-19) and system-prompt
 * interpolation (Plan 04) can read a per-org display name.
 *
 * Plan called for id '050' but 050-054 are already occupied by Phase 31.1
 * / 31.2 migrations (oauth-authorization-codes, oauth-refresh-tokens,
 * oauth-user-consents, oauth-signing-keys, backfill-mcp-use-permission).
 * Next available id is 055 — documented as a Rule 3 deviation in the
 * 32-03 SUMMARY.
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

describe('migration 055 — agent-display-name', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeFreshDb();
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // Test 1 — migration registered with the right id + name
  // -------------------------------------------------------------------------

  it('is registered in DASHBOARD_MIGRATIONS with id "055" and name "agent-display-name"', () => {
    const entry = DASHBOARD_MIGRATIONS.find((m) => m.id === '055');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('agent-display-name');
    expect(entry!.sql).toContain('agent_display_name');
  });

  // -------------------------------------------------------------------------
  // Test 2 — running migrations on a fresh DB creates the column
  // -------------------------------------------------------------------------

  it('creates a TEXT column `agent_display_name` on the `organizations` table', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const cols = db
      .prepare("PRAGMA table_info('organizations')")
      .all() as PragmaTableInfoRow[];
    const col = cols.find((c) => c.name === 'agent_display_name');
    expect(col).toBeDefined();
    expect(col!.type.toUpperCase()).toBe('TEXT');
  });

  // -------------------------------------------------------------------------
  // Test 3 — the new column is nullable (no NOT NULL, no default)
  // -------------------------------------------------------------------------

  it('leaves `agent_display_name` nullable (notnull=0, dflt_value=null)', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
    const cols = db
      .prepare("PRAGMA table_info('organizations')")
      .all() as PragmaTableInfoRow[];
    const col = cols.find((c) => c.name === 'agent_display_name')!;
    expect(col.notnull).toBe(0);
    expect(col.dflt_value).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 4 — idempotent re-run does not throw (applied-id tracking)
  // -------------------------------------------------------------------------

  it('is idempotent — running the migration list twice does not throw', () => {
    const runner = new MigrationRunner(db);
    expect(() => runner.run(DASHBOARD_MIGRATIONS)).not.toThrow();
    expect(() => runner.run(DASHBOARD_MIGRATIONS)).not.toThrow();

    // Double-check: column exists exactly once
    const cols = db
      .prepare("PRAGMA table_info('organizations')")
      .all() as PragmaTableInfoRow[];
    const matches = cols.filter((c) => c.name === 'agent_display_name');
    expect(matches).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Test 5 — migration is positioned immediately after the previous id
  //
  // Plan asked for index(050) === index(049) + 1 but 050-054 already exist.
  // The intent is "append at the end". Assert 055 is the LAST entry and
  // directly follows 054 (backfill-mcp-use-permission, Phase 31.2 P05).
  // -------------------------------------------------------------------------

  it('is appended directly after migration 054', () => {
    const index054 = DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '054');
    const index055 = DASHBOARD_MIGRATIONS.findIndex((m) => m.id === '055');
    expect(index054).toBeGreaterThanOrEqual(0);
    expect(index055).toBe(index054 + 1);
  });
});

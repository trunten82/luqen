/**
 * Phase 31.2 Plan 01 Task 1 — migration 054 back-fill tests (MCPAUTH-04).
 *
 * D-01 + D-04 from .planning/phases/31.2-mcp-access-control-refinement/31.2-CONTEXT.md:
 *   - `mcp.use` is added to the ALL_PERMISSIONS catalogue.
 *   - migration 054 back-fills `mcp.use` onto EVERY existing role so every
 *     live user × org pair keeps MCP access on deploy (day-1 continuity for
 *     the Claude Desktop clients live from Phase 31.1 smoke).
 *   - Idempotent (INSERT OR IGNORE): re-running adds no new rows.
 *   - Back-fill targets EXISTING rows only — roles created AFTER the
 *     migration ran do NOT receive `mcp.use` automatically (explicit grant
 *     required via /admin/roles per D-04 second sentence).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import {
  MigrationRunner,
  DASHBOARD_MIGRATIONS,
} from '../../../src/db/sqlite/migrations.js';
import { ALL_PERMISSIONS } from '../../../src/permissions.js';

function makeTempDb(): { db: Database.Database; path: string } {
  const path = join(tmpdir(), `test-migrations-054-${randomUUID()}.db`);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  return { db, path };
}

describe('Phase 31.2 — mcp.use permission catalogue entry', () => {
  it('ALL_PERMISSIONS contains an mcp.use entry in the Administration group with a human label', () => {
    const entry = ALL_PERMISSIONS.find((p) => p.id === 'mcp.use');
    expect(entry).toBeDefined();
    expect(entry!.group).toBe('Administration');
    expect(entry!.label.length).toBeGreaterThan(0);
    // Human-oriented label — not the id, not empty.
    expect(entry!.label).not.toBe('mcp.use');
  });
});

describe('Phase 31.2 — migration 054 back-fill', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    db = result.db;
    dbPath = result.path;
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it('is registered in DASHBOARD_MIGRATIONS with id 054 and a descriptive name', () => {
    const mig054 = DASHBOARD_MIGRATIONS.find((m) => m.id === '054');
    expect(mig054).toBeDefined();
    expect(mig054!.name).toMatch(/mcp.use/);
  });

  it('seeds mcp.use onto the system admin role after running DASHBOARD_MIGRATIONS', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);

    const rows = db
      .prepare(
        `SELECT permission FROM role_permissions
          WHERE role_id = 'admin' AND permission = 'mcp.use'`,
      )
      .all() as Array<{ permission: string }>;
    expect(rows).toHaveLength(1);
  });

  it('back-fills mcp.use onto EVERY existing role (no role left behind)', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);

    const missing = db
      .prepare(
        `SELECT COUNT(*) AS n FROM roles
          WHERE id NOT IN (
            SELECT role_id FROM role_permissions WHERE permission = 'mcp.use'
          )`,
      )
      .get() as { n: number };
    expect(missing.n).toBe(0);
  });

  it('is idempotent — running DASHBOARD_MIGRATIONS twice adds no additional mcp.use rows', () => {
    const runner = new MigrationRunner(db);
    runner.run(DASHBOARD_MIGRATIONS);

    const before = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM role_permissions WHERE permission = 'mcp.use'`,
        )
        .get() as { n: number }
    ).n;

    // Second run: the migration runner skips already-applied migrations by id,
    // AND the SQL itself is INSERT OR IGNORE — both layers must hold.
    runner.run(DASHBOARD_MIGRATIONS);

    const after = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM role_permissions WHERE permission = 'mcp.use'`,
        )
        .get() as { n: number }
    ).n;

    expect(after).toBe(before);
  });

  it('does NOT grant mcp.use to roles inserted AFTER the migration ran (D-04 second sentence)', () => {
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);

    db.prepare(
      `INSERT INTO roles (id, name, description, is_system, org_id, created_at)
       VALUES (?, ?, ?, 0, 'system', ?)`,
    ).run(
      'new_test_role',
      'new-test-role-31.2-01',
      'Role created after migration 054 — should NOT inherit mcp.use',
      new Date().toISOString(),
    );

    const rows = db
      .prepare(
        `SELECT permission FROM role_permissions
          WHERE role_id = 'new_test_role' AND permission = 'mcp.use'`,
      )
      .all() as Array<{ permission: string }>;
    expect(rows).toHaveLength(0);
  });
});

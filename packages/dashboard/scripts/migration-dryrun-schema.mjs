#!/usr/bin/env node
/**
 * migration-dryrun-schema.mjs — Phase 87 plan 05, ROADMAP SC5.
 *
 * READ-ONLY instrument. Opens --db read-only, replays its schema (tables, indexes,
 * triggers, views) and its schema_migrations ledger into ':memory:', then runs the
 * COMMITTED migration list (--bundle: esbuild bundle of src/db/sqlite/migrations.ts)
 * against that in-memory copy. Nothing is ever written to --db.
 *
 * Proposition: "migration 090 applies cleanly, and alone, to a replay of this
 * database's exact schema and ledger, and the partial unique index behaves as designed".
 * `ok` is true only when appliedNow is exactly ['090'] AND every check passes — a run
 * that applies nothing is a FAILURE, not a pass.
 *
 * Output: ONE JSON object of counts/booleans. Never DDL text, never rows.
 * Exit: 0 ok; 1 not ok / fatal; 2 bad arguments.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: migration-dryrun-schema.mjs --db <path> --bundle <migrations.bundle.mjs> --require-root <package.json>';
const EXPECTED_APPLIED_NOW = ['090'];

const DISMISSAL_COLUMNS = [
  'id', 'org_id', 'site_url', 'site_key', 'code', 'selector', 'reason', 'status',
  'created_by', 'created_by_id', 'created_at', 'revoked_by', 'revoked_by_id', 'revoked_at', 'revoke_comment',
];
const EVENT_COLUMNS = ['id', 'dismissal_id', 'org_id', 'action', 'actor', 'actor_id', 'at', 'text'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || value === undefined || value.startsWith('--')) return null;
    out[key.slice(2)] = value;
  }
  for (const k of Object.keys(out)) if (!['db', 'bundle', 'require-root'].includes(k)) return null;
  if (!out.db || !out.bundle || !out['require-root']) return null;
  return out;
}

function sameSet(actual, expected) {
  return actual.length === expected.length && expected.every((c) => actual.includes(c));
}

function columnsOf(mem, table) {
  return mem.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function ledgerIds(mem) {
  return mem.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id).sort();
}

/** Replay tables, then indexes, then triggers, then views — each class in rowid order. */
function replaySchema(source, mem) {
  const rows = source
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
    .all();
  for (const type of ['table', 'index', 'trigger', 'view']) {
    for (const row of rows.filter((r) => r.type === type)) mem.exec(row.sql);
  }
}

function replayLedger(source, mem) {
  const hasLedger = source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!hasLedger) return { count: 0, max: null };
  const ledger = source.prepare('SELECT id, name, applied_at FROM schema_migrations ORDER BY id').all();
  const insert = mem.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (@id, @name, @applied_at)');
  for (const row of ledger) insert.run(row);
  return { count: ledger.length, max: ledger.length > 0 ? ledger[ledger.length - 1].id : null };
}

function checkTables(mem) {
  const names = new Set(mem.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  if (!names.has('issue_dismissals') || !names.has('issue_dismissal_events')) return false;
  return sameSet(columnsOf(mem, 'issue_dismissals'), DISMISSAL_COLUMNS)
    && sameSet(columnsOf(mem, 'issue_dismissal_events'), EVENT_COLUMNS);
}

function checkPartialUniqueIndex(mem) {
  const idx = mem.prepare("PRAGMA index_list('issue_dismissals')").all()
    .find((i) => i.name === 'uq_issue_dismissals_active_key');
  return Boolean(idx) && idx.unique === 1 && idx.partial === 1;
}

const INSERT_ACTIVE = `INSERT INTO issue_dismissals
  (id, org_id, site_url, site_key, code, selector, reason, status, created_by, created_at)
  VALUES (@id, 'o', 'u', 'k', 'c', 's', 'r', 'active', 'x', 't')`;

function checkUniqueEnforced(mem) {
  const insert = mem.prepare(INSERT_ACTIVE);
  insert.run({ id: 'd1' });
  try {
    insert.run({ id: 'd2' });
    return false;
  } catch (error) {
    return error && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
  }
}

function checkReMarkAfterRevoke(mem) {
  mem.prepare("UPDATE issue_dismissals SET status = 'revoked' WHERE id = 'd1'").run();
  try {
    mem.prepare(INSERT_ACTIVE).run({ id: 'd3' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    process.exit(2);
  }
  const require = createRequire(resolve(args['require-root']));
  const Database = require('better-sqlite3');
  const { DASHBOARD_MIGRATIONS, MigrationRunner } = await import(pathToFileURL(resolve(args.bundle)).href);
  if (!Array.isArray(DASHBOARD_MIGRATIONS) || typeof MigrationRunner !== 'function') {
    console.error(USAGE);
    process.exit(2);
  }

  const source = new Database(resolve(args.db), { readonly: true, fileMustExist: true });
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');

  replaySchema(source, mem);
  mem.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const { count, max } = replayLedger(source, mem);
  source.close();

  const before = ledgerIds(mem);
  let migrationError = null;
  try {
    new MigrationRunner(mem).run(DASHBOARD_MIGRATIONS);
  } catch (error) {
    migrationError = `${error && error.name}${error && error.code ? ` ${error.code}` : ''}`;
  }
  const appliedNow = ledgerIds(mem).filter((id) => !before.includes(id)).sort();

  const tablesPresent = migrationError === null && checkTables(mem);
  const partialUniqueIndex = tablesPresent && checkPartialUniqueIndex(mem);
  const uniqueEnforced = partialUniqueIndex && checkUniqueEnforced(mem);
  const reMarkAfterRevoke = uniqueEnforced && checkReMarkAfterRevoke(mem);
  mem.close();

  const ok = migrationError === null
    && JSON.stringify(appliedNow) === JSON.stringify(EXPECTED_APPLIED_NOW)
    && tablesPresent && partialUniqueIndex && uniqueEnforced && reMarkAfterRevoke;

  console.log(JSON.stringify({
    proposition: 'migration 090 applies cleanly, and alone, to an in-memory replay of this database schema and ledger; the partial unique index enforces one active row per key and allows re-mark after revoke',
    prodMigrationCount: count,
    prodMaxMigration: max,
    appliedNow,
    expectedAppliedNow: EXPECTED_APPLIED_NOW,
    migrationError,
    tablesPresent,
    partialUniqueIndex,
    uniqueEnforced,
    reMarkAfterRevoke,
    ok,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`fatal: ${error && error.name}${error && error.code ? ` ${error.code}` : ''}`);
  process.exit(1);
});

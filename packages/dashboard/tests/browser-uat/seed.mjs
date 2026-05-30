// Seed an admin user + test org into the freshly-migrated UAT DB.
// Resolves better-sqlite3 and bcrypt from the monorepo root node_modules.
// The DB schema is created by the dashboard's own migrations (run by `serve`
// on boot); this script only INSERTs the login identity, idempotently.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Resolve native deps from the repo root (4 levels up: tests/browser-uat ->
// dashboard -> packages -> repo root).
const repoRoot = path.resolve(HERE, '..', '..', '..', '..');
const require = createRequire(path.join(repoRoot, 'noop.cjs'));
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const DB = process.env.UAT_DB_PATH || path.join(HERE, '.tmp', 'uat-dashboard.db');
const USERNAME = process.env.UAT_USER || 'admin';
const PASSWORD = process.env.UAT_PASS || 'UatProof2026!';
const RESULT_FILE = path.join(HERE, '.tmp', 'seed-result.json');

const db = new Database(DB);
const now = new Date().toISOString();
const hash = bcrypt.hashSync(PASSWORD, 12);

// Idempotent: remove any prior admin row + its memberships.
const prior = db.prepare('select id from dashboard_users where username = ?').get(USERNAME);
if (prior) {
  db.prepare('delete from org_members where user_id = ?').run(prior.id);
  db.prepare('delete from dashboard_users where id = ?').run(prior.id);
}

const orgId = randomUUID();
const userId = randomUUID();

db.prepare('insert into organizations (id, name, slug, created_at) values (?, ?, ?, ?)')
  .run(orgId, 'UAT Org', 'uat', now);

// dashboard_users columns: id, username, password_hash, role, active, created_at, active_org_id
db.prepare(
  'insert into dashboard_users (id, username, password_hash, role, active, created_at, active_org_id) values (?, ?, ?, ?, 1, ?, ?)'
).run(userId, USERNAME, hash, 'admin', now, orgId);

db.prepare("insert into org_members (org_id, user_id, role, joined_at) values (?, ?, 'admin', ?)")
  .run(orgId, userId, now);

const check = bcrypt.compareSync(PASSWORD, hash);
fs.writeFileSync(
  RESULT_FILE,
  JSON.stringify({ username: USERNAME, password: PASSWORD, userId, orgId, hashSelfCheck: check }, null, 2)
);
// eslint-disable-next-line no-console
console.log('SEEDED_FRESH selfcheck=' + check + ' user=' + userId + ' org=' + orgId);
db.close();

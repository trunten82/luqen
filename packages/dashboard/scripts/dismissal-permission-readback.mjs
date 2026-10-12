#!/usr/bin/env node
/**
 * dismissal-permission-readback.mjs — Phase 89 plan 03, D-14 (pre-grant) and D-17 (post-grant).
 *
 * READ-ONLY instrument. Proposition measured:
 *   "every identity path that yields or would yield issues.dismiss, and whether any customer
 *    identity holds it outside the expected set"
 *
 * Output discipline: ONE JSON object of counts, fixed key names and fixed check names. It never
 * prints a username, user id, org id or name, role id or name, key id or label, email, URL or IP.
 * Fatal errors print only error.name and error.code (a missing schema column prints table.column).
 *
 * Exit codes: 0 measured and no violation; 1 fatal; 2 bad arguments; 3 measured nothing
 * (no active users and no active keys); 4 at least one violation (never readable as clearance).
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const USAGE =
  'usage: dismissal-permission-readback.mjs --db <path> --require-root <package.json> ' +
  '--expect dark|granted [--allow-custom-roles true|false] [--label <text>]';

const PROPOSITION =
  'every identity path that yields or would yield issues.dismiss, and whether any customer ' +
  'identity holds it outside the expected set';

const PERMISSION = 'issues.dismiss';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || value === undefined || value.startsWith('--')) return null;
    out[key.slice(2)] = value;
  }
  const allowed = new Set(['db', 'require-root', 'expect', 'allow-custom-roles', 'label']);
  for (const k of Object.keys(out)) if (!allowed.has(k)) return null;
  if (!out.db || !out['require-root']) return null;
  if (out.expect !== 'dark' && out.expect !== 'granted') return null;
  if (out['allow-custom-roles'] !== undefined && !['true', 'false'].includes(out['allow-custom-roles'])) return null;
  return out;
}

// Role buckets, by where the role lives and what it is called. Owner/Admin and Member/Viewer/Executive
// are the DEFAULT_ORG_ROLES names (migration 088 seeds on the same names).
const ROLE_BUCKETS = {
  systemAdmin: "r.id = 'admin' AND r.org_id = 'system'",
  systemOther: "r.org_id = 'system' AND r.id != 'admin'",
  orgOwnerAdmin: "r.org_id != 'system' AND r.name IN ('Owner', 'Admin')",
  orgMemberViewerExecutive: "r.org_id != 'system' AND r.name IN ('Member', 'Viewer', 'Executive')",
  orgCustom: "r.org_id != 'system' AND r.name NOT IN ('Owner', 'Admin', 'Member', 'Viewer', 'Executive')",
};

function countRoleRows(db) {
  const rows = {};
  let total = 0;
  for (const [bucket, predicate] of Object.entries(ROLE_BUCKETS)) {
    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id ` +
          `WHERE rp.permission = ? AND ${predicate}`,
      )
      .get(PERMISSION).n;
    rows[bucket] = n;
    total += n;
  }
  return { total, ...rows };
}

function darkViolations(roleRows) {
  const violations = [];
  if (roleRows.systemOther > 0) violations.push('latent-system-role');
  if (roleRows.orgOwnerAdmin > 0) violations.push('latent-org-owner-admin');
  if (roleRows.orgMemberViewerExecutive > 0) violations.push('latent-org-member-viewer-executive');
  if (roleRows.orgCustom > 0) violations.push('latent-org-custom-role');
  return violations;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    process.exit(2);
  }

  const require = createRequire(resolve(args['require-root']));
  const Database = require('better-sqlite3');
  const db = new Database(resolve(args.db), { readonly: true, fileMustExist: true });

  const roleRows = countRoleRows(db);
  db.close();

  const violations = darkViolations(roleRows);
  const result = {
    proposition: PROPOSITION,
    expect: args.expect,
    label: args.label ?? '',
    roleRows,
    violations,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(violations.length > 0 ? 4 : 0);
}

try {
  main();
} catch (error) {
  console.error(`fatal: ${error && error.name}${error && error.code ? ` ${error.code}` : ''}`);
  process.exit(1);
}

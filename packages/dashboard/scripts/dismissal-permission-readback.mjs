#!/usr/bin/env node
/**
 * dismissal-permission-readback.mjs — Phase 89 plan 03, D-14 (pre-grant) and D-17 (post-grant).
 *
 * READ-ONLY instrument. Proposition measured:
 *   "every identity path that yields or would yield issues.dismiss, and whether any customer
 *    identity holds it outside the expected set"
 *
 * It counts, never names:
 *   - role_permissions rows carrying issues.dismiss, bucketed by role kind, and the distinct
 *     people each bucket reaches (team_members -> teams.role_id, and dashboard_users.role);
 *   - active global admins, and how many sit in a customer-org team (incl. team_org_links);
 *   - active, unexpired API keys by scope and role;
 *   - API-key /login history from audit_log.
 * Rows that say issues.dismiss are LATENT while the permission is dark (resolution strips it) and
 * become live the moment it leaves DARK_PERMISSIONS, so --expect dark counts them as violations.
 *
 * What it cannot measure, and says so in the output instead of clearing it:
 *   - API-key /login sessions live in encrypted cookies (unmeasurable: apiKeyLoginSessions);
 *   - whose account each global admin is (needsHumanConfirmation: globalAdminIdentities).
 *
 * Output discipline: ONE JSON object of counts, fixed key names and fixed check names. It never
 * prints a username, user id, org id or name, role id or name, key id or label, email, URL or IP.
 * Fatal errors print only error.name and error.code (a missing schema column prints table.column).
 *
 * Exit codes: 0 measured and no violation; 1 fatal; 2 bad arguments; 3 measured nothing (no active
 * users and no active keys); 4 at least one violation (never readable as clearance). A violation
 * outranks measured-nothing: 4 is checked first.
 *
 * Usage (counts and fixed names only; run it against a COPY of the production database):
 *   Plan 07, before the grant:  --expect dark
 *   Plan 10, after the grant:   --expect granted --allow-custom-roles <true|false>
 *                               (the value is the owner's D-15 answer on custom roles)
 * Copy, run and remove procedure: the 87-05 plan, Task 1 (porcelain count, config keys only,
 * mktemp, copy, run, remove, confirm REMOVED). --db is the copied file; --require-root is a
 * package.json whose node_modules provide better-sqlite3.
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
const DAY_MS = 24 * 60 * 60 * 1000;

const UNMEASURABLE_REASONS = {
  apiKeyLoginSessions:
    'API-key /login sessions live in encrypted cookies, not the database; only historical login counts are measured',
};

const NOTES = {
  orgAdminKeysHoldViaOwnerCap:
    'org-scoped admin keys are capped at the org Owner set, so they hold the permission once it is granted and have no effect while dark (read from the code, not measured here)',
};

// Tables and the columns this script reads. A missing one is fatal and named by table.column.
const REQUIRED_SCHEMA = [
  ['roles', ['id', 'name', 'is_system', 'org_id']],
  ['role_permissions', ['role_id', 'permission']],
  ['teams', ['id', 'org_id', 'role_id']],
  ['team_members', ['team_id', 'user_id']],
  ['team_org_links', ['team_id', 'org_id']],
  ['dashboard_users', ['id', 'role', 'active']],
  ['api_keys', ['id', 'active', 'org_id', 'role', 'expires_at']],
  ['audit_log', ['timestamp', 'actor_id', 'action', 'details']],
];

// Role buckets, by where the role lives and what it is called. The five org names are the
// DEFAULT_ORG_ROLES names (migration 088 seeds on the same names).
const ROLE_BUCKETS = {
  systemAdmin: "r.id = 'admin' AND r.org_id = 'system'",
  systemOther: "r.org_id = 'system' AND r.id != 'admin'",
  orgOwnerAdmin: "r.org_id != 'system' AND r.name IN ('Owner', 'Admin')",
  orgMemberViewerExecutive: "r.org_id != 'system' AND r.name IN ('Member', 'Viewer', 'Executive')",
  orgCustom: "r.org_id != 'system' AND r.name NOT IN ('Owner', 'Admin', 'Member', 'Viewer', 'Executive')",
};

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
  const allow = out['allow-custom-roles'];
  if (allow !== undefined && allow !== 'true' && allow !== 'false') return null;
  // An inert flag is worse than none: it would read as configured confinement that does nothing.
  if (allow === 'true' && out.expect === 'dark') return null;
  return out;
}

class SchemaGap extends Error {
  constructor(code) {
    super('schema gap');
    this.name = 'SchemaGap';
    this.code = code;
  }
}

function assertSchema(db) {
  for (const [table, columns] of REQUIRED_SCHEMA) {
    const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const column of columns) {
      if (!present.has(column)) throw new SchemaGap(`${table}.${column}`);
    }
  }
}

const count = (db, sql, ...params) => db.prepare(sql).get(...params).n;

function countRoleRows(db) {
  const rows = {};
  let total = 0;
  for (const [bucket, predicate] of Object.entries(ROLE_BUCKETS)) {
    const n = count(
      db,
      `SELECT COUNT(*) AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id ` +
        `WHERE rp.permission = ? AND ${predicate}`,
      PERMISSION,
    );
    rows[bucket] = n;
    total += n;
  }
  return { total, ...rows };
}

/** Distinct people each bucket reaches. Counts, over-approximating toward alarm (see CONCLUDED in the summary). */
function countReach(db) {
  const reach = {};
  for (const [bucket, predicate] of Object.entries(ROLE_BUCKETS)) {
    // Team path: team_members -> teams.role_id, as getEffectivePermissions resolves it.
    const teamMembers = count(
      db,
      `SELECT COUNT(DISTINCT tm.user_id) AS n FROM team_members tm
         JOIN teams t ON t.id = tm.team_id
         JOIN roles r ON r.id = t.role_id
         JOIN role_permissions rp ON rp.role_id = r.id
        WHERE rp.permission = ? AND ${predicate}`,
      PERMISSION,
    );
    // Global path: getUserPermissions looks the role up by NAME (getRoleByName), in any org.
    const globalRoleUsers = count(
      db,
      `SELECT COUNT(DISTINCT du.id) AS n FROM dashboard_users du
         JOIN roles r ON r.name = du.role
         JOIN role_permissions rp ON rp.role_id = r.id
        WHERE du.active = 1 AND rp.permission = ? AND ${predicate}`,
      PERMISSION,
    );
    reach[bucket] = { teamMembers, globalRoleUsers };
  }
  return reach;
}

function countGlobalAdmins(db) {
  const total = count(db, "SELECT COUNT(*) AS n FROM dashboard_users WHERE role = 'admin' AND active = 1");
  const inCustomerOrgTeam = count(
    db,
    `SELECT COUNT(DISTINCT du.id) AS n FROM dashboard_users du
       JOIN team_members tm ON tm.user_id = du.id
       JOIN teams t ON t.id = tm.team_id
      WHERE du.role = 'admin' AND du.active = 1
        AND (t.org_id != 'system'
             OR EXISTS (SELECT 1 FROM team_org_links tol WHERE tol.team_id = t.id AND tol.org_id != 'system'))`,
  );
  return { total, inCustomerOrgTeam };
}

function countOwnerAdminRoles(db) {
  const owned = "r.org_id != 'system' AND r.name IN ('Owner', 'Admin')";
  const total = count(db, `SELECT COUNT(*) AS n FROM roles r WHERE ${owned}`);
  const withRow = count(
    db,
    `SELECT COUNT(*) AS n FROM roles r WHERE ${owned}
        AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = ?)`,
    PERMISSION,
  );
  return { total, withRow, missing: total - withRow };
}

function countApiKeys(db, nowIso) {
  const live = "active = 1 AND (expires_at IS NULL OR expires_at > ?)";
  const bucket = (predicate) => count(db, `SELECT COUNT(*) AS n FROM api_keys WHERE ${live} AND ${predicate}`, nowIso);
  const orgAdmin = bucket("org_id != 'system' AND role = 'admin'");
  return {
    active: count(db, `SELECT COUNT(*) AS n FROM api_keys WHERE ${live}`, nowIso),
    systemAdmin: bucket("org_id = 'system' AND role = 'admin'"),
    systemOther: bucket("org_id = 'system' AND role != 'admin'"),
    orgAdmin,
    orgOther: bucket("org_id != 'system' AND role != 'admin'"),
    orgAdminKeysHoldViaOwnerCap: orgAdmin,
  };
}

function countApiKeyLogins(db) {
  const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const success = "action = 'login.success' AND actor_id = 'api-key'";
  return {
    loginSuccess: {
      total: count(db, `SELECT COUNT(*) AS n FROM audit_log WHERE ${success}`),
      last30Days: count(db, `SELECT COUNT(*) AS n FROM audit_log WHERE ${success} AND timestamp >= ?`, cutoff),
    },
    loginRefused: count(
      db,
      `SELECT COUNT(*) AS n FROM audit_log
        WHERE action = 'login.failure' AND (details LIKE '%org-scoped%' OR details LIKE '%not-admin%')`,
    ),
  };
}

function violationsFor(expectMode, allowCustomRoles, roleRows, globalAdmins, ownerAdminRoles) {
  const violations = [];
  if (expectMode === 'dark') {
    if (roleRows.systemOther > 0) violations.push('latent-system-role');
    if (roleRows.orgOwnerAdmin > 0) violations.push('latent-org-owner-admin');
    if (roleRows.orgMemberViewerExecutive > 0) violations.push('latent-org-member-viewer-executive');
    if (roleRows.orgCustom > 0) violations.push('latent-org-custom-role');
  } else {
    if (ownerAdminRoles.missing > 0) violations.push('grant-incomplete');
    if (roleRows.orgMemberViewerExecutive > 0) violations.push('granted-to-member-viewer-executive');
    if (roleRows.systemOther > 0) violations.push('granted-to-system-role');
    if (roleRows.orgCustom > 0 && !allowCustomRoles) violations.push('granted-to-custom-role');
  }
  if (globalAdmins.inCustomerOrgTeam > 0) violations.push('global-admin-in-customer-org-team');
  return violations;
}

function measure(db, args) {
  assertSchema(db);
  const allowCustomRoles = args['allow-custom-roles'] === 'true';
  const roleRows = countRoleRows(db);
  const globalAdmins = countGlobalAdmins(db);
  const ownerAdminRoles = countOwnerAdminRoles(db);
  const apiKeys = countApiKeys(db, new Date().toISOString());
  return {
    proposition: PROPOSITION,
    expect: args.expect,
    allowCustomRoles,
    label: args.label ?? '',
    identities: {
      activeUsers: count(db, 'SELECT COUNT(*) AS n FROM dashboard_users WHERE active = 1'),
      activeApiKeys: apiKeys.active,
    },
    globalAdmins,
    roleRows,
    reach: countReach(db),
    ownerAdminRoles,
    apiKeys,
    apiKeyLogins: countApiKeyLogins(db),
    unmeasurable: Object.keys(UNMEASURABLE_REASONS),
    unmeasurableReasons: UNMEASURABLE_REASONS,
    needsHumanConfirmation: ['globalAdminIdentities'],
    notes: NOTES,
    violations: violationsFor(args.expect, allowCustomRoles, roleRows, globalAdmins, ownerAdminRoles),
  };
}

function exitCodeFor(result) {
  if (result.violations.length > 0) return 4;
  if (result.identities.activeUsers === 0 && result.identities.activeApiKeys === 0) return 3;
  return 0;
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

  let result;
  try {
    result = measure(db, args);
  } finally {
    db.close();
  }

  const code = exitCodeFor(result);
  if (code === 3) console.error('measured nothing');
  console.log(JSON.stringify(result, null, 2));
  process.exit(code);
}

try {
  main();
} catch (error) {
  console.error(`fatal: ${error && error.name}${error && error.code ? ` ${error.code}` : ''}`);
  process.exit(1);
}

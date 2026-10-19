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
 * Every mode also flags (quick 261013-dr7, WR-03) an org role named like a global role, an org role
 * holding admin.system, and an org team bound to a role holding admin.system.
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
 *
 * UAT admin persona exemption (--exempt-uat-admin-team true): the dedicated UAT admin persona, a
 * global admin, is a member of the dedicated UAT org's team by the owner's ruling. With the flag,
 * that one membership does not count toward global-admin-in-customer-org-team. The persona and the
 * org are named by the environment variables LUQEN_UAT_ADMIN_USER (username) and
 * LUQEN_UAT_EXPECT_ORG (organization name), the same two the dismissal browser UAT's target rule
 * reads; the flag without both (non-empty) exits 2 naming them. It applies only when exactly one
 * organization has that name and exactly one active global admin has that username, and only if
 * every team of that admin reaching a customer org belongs to that org and is linked to no other
 * customer org. Any other global admin in a customer-org team is still a violation. The raw
 * globalAdmins counts are unchanged; the JSON gains `exemptions`, and stderr carries
 * `INFO exempted global-admin-in-customer-org-team: <n>` (or `INFO exemption not applied: <reason>`,
 * reason org-not-found, org-not-unique, persona-not-found or persona-not-unique). Neither variable's
 * value is ever printed. It exists for the dedicated UAT persona and org only.
 * Copy, run and remove procedure: the 87-05 plan, Task 1 (porcelain count, config keys only,
 * mktemp, copy, run, remove, confirm REMOVED). --db is the copied file; --require-root is a
 * package.json whose node_modules provide better-sqlite3.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const USAGE =
  'usage: dismissal-permission-readback.mjs --db <path> --require-root <package.json> ' +
  '--expect dark|granted [--allow-custom-roles true|false] [--label <text>] [--exempt-uat-admin-team true]';

// The UAT admin persona exemption (header comment). Variable NAMES only; values are never printed.
const EXEMPT_CHECK = 'global-admin-in-customer-org-team';
const EXEMPT_USER_VAR = 'LUQEN_UAT_ADMIN_USER';
const EXEMPT_ORG_VAR = 'LUQEN_UAT_EXPECT_ORG';
const EXEMPT_VARIABLES = [EXEMPT_USER_VAR, EXEMPT_ORG_VAR];
const EXEMPT_SCHEMA = [
  ['organizations', ['id', 'name']],
  ['dashboard_users', ['username']],
];

const PROPOSITION =
  'every identity path that yields or would yield issues.dismiss, and whether any customer ' +
  'identity holds it outside the expected set';

const PERMISSION = 'issues.dismiss';

// Quick 261013-dr7 (WR-03 / CR-01): the global role vocabulary a dashboard user can hold
// (permissions.ts GLOBAL_ROLE_NAMES). An org role whose name equals one of these, or the name of
// any role in org 'system', is a violation in EVERY mode: before the CR-01 fix the global-role
// lookup matched by name in any org, so such a role replaced the global role for every holder.
// Exact (BINARY, case-sensitive) comparison, as the lookup itself compares.
const GLOBAL_ROLE_NAMES = ['viewer', 'user', 'developer', 'admin', 'executive'];
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
  const allowed = new Set(['db', 'require-root', 'expect', 'allow-custom-roles', 'label', 'exempt-uat-admin-team']);
  for (const k of Object.keys(out)) if (!allowed.has(k)) return null;
  if (!out.db || !out['require-root']) return null;
  if (out.expect !== 'dark' && out.expect !== 'granted') return null;
  const allow = out['allow-custom-roles'];
  if (allow !== undefined && allow !== 'true' && allow !== 'false') return null;
  // An inert flag is worse than none: it would read as configured confinement that does nothing.
  if (allow === 'true' && out.expect === 'dark') return null;
  const exempt = out['exempt-uat-admin-team'];
  if (exempt !== undefined && exempt !== 'true') return null;
  return out;
}

class SchemaGap extends Error {
  constructor(code) {
    super('schema gap');
    this.name = 'SchemaGap';
    this.code = code;
  }
}

function assertSchema(db, schema = REQUIRED_SCHEMA) {
  for (const [table, columns] of schema) {
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
    // Global path: joined by NAME in any org, over-approximating toward alarm. Since quick 261013-dr7
    // getRoleByName resolves org 'system' only; a name collision is its own violation below.
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

/** Org-scoped sources that could stand in for a global role or confer admin.system. */
function countGlobalRoleShadowing(db) {
  const placeholders = GLOBAL_ROLE_NAMES.map(() => '?').join(', ');
  return {
    orgRolesNamedLikeGlobalRole: count(
      db,
      `SELECT COUNT(*) AS n FROM roles r WHERE r.org_id != 'system'
          AND (r.name IN (${placeholders}) OR r.name IN (SELECT name FROM roles WHERE org_id = 'system'))`,
      ...GLOBAL_ROLE_NAMES,
    ),
    orgRolesHoldingAdminSystem: count(
      db,
      `SELECT COUNT(DISTINCT r.id) AS n FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.org_id != 'system' AND rp.permission = 'admin.system'`,
    ),
    orgTeamsHoldingAdminSystem: count(
      db,
      `SELECT COUNT(DISTINCT t.id) AS n FROM teams t JOIN role_permissions rp ON rp.role_id = t.role_id
        WHERE t.org_id != 'system' AND rp.permission = 'admin.system'`,
    ),
  };
}

/**
 * The UAT admin persona exemption (header comment): how many of the inCustomerOrgTeam admins it
 * covers (0 or 1), or why it was not applied. Reads the two values; returns names and counts only.
 */
function uatAdminExemption(db, username, orgName) {
  const base = { check: EXEMPT_CHECK, variables: [...EXEMPT_VARIABLES] };
  const notApplied = (reason) => ({ ...base, applied: false, count: 0, reason });
  const orgs = db.prepare('SELECT id FROM organizations WHERE name = ?').all(orgName);
  if (orgs.length === 0) return notApplied('org-not-found');
  if (orgs.length > 1) return notApplied('org-not-unique');
  const admins = db
    .prepare("SELECT id FROM dashboard_users WHERE username = ? AND role = 'admin' AND active = 1")
    .all(username);
  if (admins.length === 0) return notApplied('persona-not-found');
  if (admins.length > 1) return notApplied('persona-not-unique');
  const orgId = orgs[0].id;
  const userId = admins[0].id;
  const inCustomerTeam = count(
    db,
    `SELECT COUNT(*) AS n FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?
        AND (t.org_id != 'system'
             OR EXISTS (SELECT 1 FROM team_org_links tol WHERE tol.team_id = t.id AND tol.org_id != 'system'))`,
    userId,
  );
  // Every team of the persona that reaches a customer org must reach the UAT org and no other.
  const outsideUatOrg = count(
    db,
    `SELECT COUNT(*) AS n FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?
        AND ((t.org_id != 'system' AND t.org_id != ?)
             OR EXISTS (SELECT 1 FROM team_org_links tol
                         WHERE tol.team_id = t.id AND tol.org_id != 'system' AND tol.org_id != ?))`,
    userId,
    orgId,
    orgId,
  );
  return { ...base, applied: true, count: inCustomerTeam > 0 && outsideUatOrg === 0 ? 1 : 0 };
}

function violationsFor(expectMode, allowCustomRoles, roleRows, globalAdmins, ownerAdminRoles, shadowing, exempted = 0) {
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
  if (globalAdmins.inCustomerOrgTeam - exempted > 0) violations.push('global-admin-in-customer-org-team');
  // Mode-independent and NOT switched off by --allow-custom-roles (WR-03).
  if (shadowing.orgRolesNamedLikeGlobalRole > 0) violations.push('org-role-shadows-global-role');
  if (shadowing.orgRolesHoldingAdminSystem > 0) violations.push('org-role-holds-admin-system');
  if (shadowing.orgTeamsHoldingAdminSystem > 0) violations.push('org-team-holds-admin-system');
  return violations;
}

function measure(db, args, exemptValues) {
  assertSchema(db);
  if (exemptValues !== null) assertSchema(db, EXEMPT_SCHEMA);
  const allowCustomRoles = args['allow-custom-roles'] === 'true';
  const roleRows = countRoleRows(db);
  const globalAdmins = countGlobalAdmins(db);
  const exemptions = exemptValues === null ? [] : [uatAdminExemption(db, exemptValues.username, exemptValues.orgName)];
  const exempted = exemptions.reduce((n, e) => n + e.count, 0);
  const ownerAdminRoles = countOwnerAdminRoles(db);
  const apiKeys = countApiKeys(db, new Date().toISOString());
  const globalRoleShadowing = countGlobalRoleShadowing(db);
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
    globalRoleShadowing,
    unmeasurable: Object.keys(UNMEASURABLE_REASONS),
    unmeasurableReasons: UNMEASURABLE_REASONS,
    needsHumanConfirmation: ['globalAdminIdentities'],
    notes: NOTES,
    exemptions,
    violations: violationsFor(args.expect, allowCustomRoles, roleRows, globalAdmins, ownerAdminRoles, globalRoleShadowing, exempted),
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
  // An inert flag is worse than none: the exemption without both variables is refused, by name.
  let exemptValues = null;
  if (args['exempt-uat-admin-team'] === 'true') {
    const username = process.env[EXEMPT_USER_VAR];
    const orgName = process.env[EXEMPT_ORG_VAR];
    const present = (v) => typeof v === 'string' && v.trim() !== '';
    if (!present(username) || !present(orgName)) {
      console.error(`--exempt-uat-admin-team true needs both ${EXEMPT_USER_VAR} and ${EXEMPT_ORG_VAR} set (non-empty)`);
      console.error(USAGE);
      process.exit(2);
    }
    exemptValues = { username, orgName };
  }

  const require = createRequire(resolve(args['require-root']));
  const Database = require('better-sqlite3');
  const db = new Database(resolve(args.db), { readonly: true, fileMustExist: true });

  let result;
  try {
    result = measure(db, args, exemptValues);
  } finally {
    db.close();
  }

  const code = exitCodeFor(result);
  for (const e of result.exemptions) {
    console.error(e.applied ? `INFO exempted ${e.check}: ${e.count}` : `INFO exemption not applied: ${e.reason}`);
  }
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

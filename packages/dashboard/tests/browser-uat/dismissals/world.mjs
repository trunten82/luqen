// Boot a fresh-DB dashboard from the BUILT dist/ and seed the dismissal UAT fixture.
//
// Used by the local and remote-selftest modes. Every scenario gets its own world: scenarios mark
// and revoke real data, so a shared world would make each depend on the one before it.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DASHBOARD_DIR, BROWSER_UAT_DIR, TMP, SHOTS, track, log, waitFor, discoverChromium, requireFromRepo,
} from './lib.mjs';
import {
  SITE, BACKFILL_SITE, OVERLONG_SITE, buildReport, buildSmallReport, buildOverlongReport, REASON, HERO, PROMO, NAV, LONG,
} from './fixture.mjs';

const config = JSON.parse(fs.readFileSync(path.join(BROWSER_UAT_DIR, 'uat.config.json'), 'utf8'));
export const PORT = config.port;
export const LOCAL_BASE = `http://127.0.0.1:${PORT}`;

const PASS = 'UatProof2026!';
export const PERSONAS = {
  admin: { user: 'uat-admin', pass: PASS },
  owner: { user: 'uat-owner', pass: PASS },
  member: { user: 'uat-member', pass: PASS },
  viewer: { user: 'uat-viewer', pass: PASS },
  reportsOnly: { user: 'uat-reports-only', pass: PASS },
  // Seeded only in the permissions world: a custom org role with issues.dismiss, issues.assign and
  // reports.view but NOT reports.view_technical (HARD-02).
  reviewer: { user: 'uat-reviewer', pass: PASS },
};

/** Remove everything under .tmp except the tracked .gitignore and the screenshot directory. */
function resetWorkspace({ keepShots }) {
  fs.mkdirSync(TMP, { recursive: true });
  for (const f of fs.readdirSync(TMP)) {
    if (f === '.gitignore') continue;
    if (f === path.basename(SHOTS) && keepShots) continue;
    fs.rmSync(path.join(TMP, f), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(TMP, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'plugins'), { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
}

/** Clear the screenshot directory once per run (scenarios then add to it). */
export function resetShots() {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
}

async function startDashboard() {
  const dbPath = path.join(TMP, 'uat-dashboard.db');
  const tmpConfig = { ...config, dbPath, reportsDir: path.join(TMP, 'reports'), pluginsDir: path.join(TMP, 'plugins') };
  fs.writeFileSync(path.join(TMP, 'dashboard.config.json'), JSON.stringify(tmpConfig, null, 2));
  const dashLog = fs.createWriteStream(path.join(TMP, 'dashboard.log'));
  const dash = track(spawn('node', [path.join(DASHBOARD_DIR, 'dist', 'cli.js'), 'serve'], {
    cwd: TMP,
    env: {
      ...process.env,
      PUPPETEER_EXECUTABLE_PATH: discoverChromium(),
      DASHBOARD_PORT: String(PORT),
      DASHBOARD_SESSION_SECRET: config.sessionSecret,
      DASHBOARD_DB_PATH: dbPath,
      DASHBOARD_REPORTS_DIR: tmpConfig.reportsDir,
      DASHBOARD_PLUGINS_DIR: tmpConfig.pluginsDir,
    },
  }));
  dash.stdout.pipe(dashLog);
  dash.stderr.pipe(dashLog);
  log('starting dashboard serve');
  if (!(await waitFor(LOCAL_BASE + '/login'))) throw new Error('dashboard did not come up (see .tmp/dashboard.log)');
  return dbPath;
}

/** Insert a dashboard user whose GLOBAL role grants nothing; org permissions come from a team role. */
function insertUser(raw, bcrypt, creds, role, orgId, now) {
  const id = randomUUID();
  raw.prepare('INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at, active_org_id) VALUES (?,?,?,?,1,?,?)')
    .run(id, creds.user, bcrypt.hashSync(creds.pass, 12), role, now, orgId);
  return id;
}

/** Creation times given to two of the seeded keys, so their tags differ by date (placeholders). */
export const KEY_TIMES = { twin: '2026-03-01T10:00:00.000Z', deleted: '2026-05-17T16:30:00.000Z' };

/**
 * Attribution world (89-11, HARD-08). Every dismissal is marked THROUGH THE MARK API with the key's
 * Bearer secret, so the route stores the key snapshot exactly as production does:
 *   PROMO  org key 'Fabrikam CI' (live)
 *   LONG   a second org key with the SAME label 'Fabrikam CI' and an older creation time (live)
 *   NAV    org key 'Fabrikam Deploy', revoked and then DELETED after its mark
 *   HERO   a system key 'Northwind Ops' (not the scan org's key: never named on this report)
 * The key rows themselves are seeded through the storage adapter. Placeholder labels only.
 */
async function seedApiKeyActors(storage, orgId, scanId) {
  const raw = storage.getRawDatabase();
  const make = async (label, org, createdAt) => {
    const secret = `uat-${randomUUID()}`;
    const id = await storage.apiKeys.storeKey(secret, label, org, 'admin');
    if (createdAt) raw.prepare('UPDATE api_keys SET created_at = ? WHERE id = ?').run(createdAt, id);
    return { id, secret };
  };
  const keys = {
    ci: await make('Fabrikam CI', orgId, null),
    twin: await make('Fabrikam CI', orgId, KEY_TIMES.twin),
    deleted: await make('Fabrikam Deploy', orgId, KEY_TIMES.deleted),
    system: await make('Northwind Ops', undefined, null),
  };
  const findings = { ci: PROMO, twin: LONG, deleted: NAV, system: HERO };
  for (const [name, f] of Object.entries(findings)) {
    const res = await fetch(`${LOCAL_BASE}/api/v1/scans/${scanId}/dismissals`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${keys[name].secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: f.code, selector: f.selector, reason: 'Marked by an API key through the API (seeded).' }),
    });
    if (res.status !== 201) throw new Error(`api-key mark (${name}) answered ${res.status}, not 201`);
  }
  // The product deletes a key only after revoking it (deleteKey removes inactive rows only).
  await storage.apiKeys.revokeKey(keys.deleted.id, orgId);
  if (!(await storage.apiKeys.deleteKey(keys.deleted.id, orgId))) throw new Error('the deleted key was not deleted');
  const deletedGone = !(await storage.apiKeys.listKeys(orgId)).some((k) => k.id === keys.deleted.id);
  return {
    keyIds: Object.fromEntries(Object.entries(keys).map(([n, k]) => [n, k.id])),
    codes: Object.fromEntries(Object.entries(findings).map(([n, f]) => [n, f.code])),
    deletedGone,
  };
}

/** The custom-role reviewer (HARD-02): may dismiss and assign, may not see technical details. */
async function seedReviewer(storage, raw, bcrypt, orgId, now) {
  const role = await storage.roles.createRole({
    name: 'Reviewer', description: 'dismiss and assign without technical details',
    permissions: ['reports.view', 'issues.dismiss', 'issues.assign'], orgId,
  });
  return [insertUser(raw, bcrypt, PERSONAS.reviewer, 'uat-none', orgId, now), role.id];
}

export async function bootLocal({ keepShots = true, apiKeyActors = false, reviewer = false, overlongScan = false } = {}) {
  log('resetting .tmp workspace');
  resetWorkspace({ keepShots });
  const dbPath = await startDashboard();

  log('seeding org, personas and scans');
  const { SqliteStorageAdapter } = await import(path.join(DASHBOARD_DIR, 'dist', 'db', 'sqlite', 'index.js'));
  const { toSiteKey } = await import(path.join(DASHBOARD_DIR, 'dist', 'services', 'issue-dismissals', 'site-key.js'));
  const storage = new SqliteStorageAdapter(dbPath);
  const bcrypt = requireFromRepo('bcrypt');
  const Database = requireFromRepo('better-sqlite3');
  const now = new Date().toISOString();

  // The org is created through the adapter so it seeds the default roles (Owner, Admin, Member,
  // Executive, Viewer) exactly as production does.
  const org = await storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
  const orgId = org.id;
  const roles = await storage.roles.listOrgRoles(orgId);
  const roleId = (name) => {
    const r = roles.find((x) => x.name === name);
    if (!r) throw new Error(`default org role ${name} was not seeded`);
    return r.id;
  };
  const reportsOnlyRole = await storage.roles.createRole({ name: 'ReportsOnly', description: 'reports.view only', permissions: ['reports.view'], orgId });

  const raw = new Database(dbPath);
  raw.prepare("INSERT OR IGNORE INTO roles (id, name, description, is_system, org_id, created_at) VALUES ('uat-none','uat-none','No global permissions',1,'system',?)").run(now);
  const adminId = insertUser(raw, bcrypt, PERSONAS.admin, 'admin', orgId, now);
  raw.prepare("INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(orgId, adminId, now);
  const people = {
    owner: [insertUser(raw, bcrypt, PERSONAS.owner, 'uat-none', orgId, now), roleId('Owner')],
    member: [insertUser(raw, bcrypt, PERSONAS.member, 'uat-none', orgId, now), roleId('Member')],
    viewer: [insertUser(raw, bcrypt, PERSONAS.viewer, 'uat-none', orgId, now), roleId('Viewer')],
    reportsOnly: [insertUser(raw, bcrypt, PERSONAS.reportsOnly, 'uat-none', orgId, now), reportsOnlyRole.id],
    ...(reviewer ? { reviewer: await seedReviewer(storage, raw, bcrypt, orgId, now) } : {}),
  };
  raw.close();
  for (const [name, [userId, rid]] of Object.entries(people)) {
    const team = await storage.teams.createTeam({ name: `uat-${name}`, description: `${name} persona`, orgId, roleId: rid });
    await storage.teams.addTeamMember(team.id, userId);
  }

  const scanId = randomUUID();
  await storage.scans.createScan({ id: scanId, siteUrl: SITE, standard: 'WCAG2AA', jurisdictions: [], createdBy: PERSONAS.admin.user, createdAt: now, orgId });
  const report = buildReport(SITE);
  await storage.scans.updateScan(scanId, { status: 'completed', completedAt: now, totalIssues: report.summary.totalIssues, errors: report.summary.totalIssues, pagesScanned: report.pages.length, jsonReport: JSON.stringify(report) });

  // A second site of the same org carrying 150 active dismissals (overflow backstop).
  const bigScanId = randomUUID();
  await storage.scans.createScan({ id: bigScanId, siteUrl: BACKFILL_SITE, standard: 'WCAG2AA', jurisdictions: [], createdBy: PERSONAS.admin.user, createdAt: now, orgId });
  const small = buildSmallReport(BACKFILL_SITE);
  await storage.scans.updateScan(bigScanId, { status: 'completed', completedAt: now, totalIssues: 1, errors: 1, pagesScanned: 1, jsonReport: JSON.stringify(small) });
  for (let i = 1; i <= 150; i += 1) {
    const res = await storage.issueDismissals.mark({
      orgId, siteUrl: BACKFILL_SITE, siteKey: toSiteKey(BACKFILL_SITE),
      code: `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37`, selector: `#backfill-row-${i}`,
      reason: `${REASON} (row ${i})`, actor: PERSONAS.admin.user,
    });
    if (res.kind !== 'created') throw new Error('backfill mark did not create a row');
  }
  // The refused scenario's second scan: findings whose selector is over the dismissal limit.
  let overlongScanId = null;
  if (overlongScan) {
    overlongScanId = randomUUID();
    await storage.scans.createScan({ id: overlongScanId, siteUrl: OVERLONG_SITE, standard: 'WCAG2AA', jurisdictions: [], createdBy: PERSONAS.admin.user, createdAt: now, orgId });
    const over = buildOverlongReport(OVERLONG_SITE);
    await storage.scans.updateScan(overlongScanId, { status: 'completed', completedAt: now, totalIssues: over.summary.totalIssues, errors: over.summary.totalIssues, pagesScanned: over.pages.length, jsonReport: JSON.stringify(over) });
  }
  const keyActors = apiKeyActors ? await seedApiKeyActors(storage, orgId, scanId) : null;
  await storage.disconnect();
  return {
    base: LOCAL_BASE, scanId, bigScanId, orgId, orgName: org.name, siteUrl: SITE, personas: PERSONAS,
    ...(keyActors ? { keyActors } : {}), ...(overlongScanId ? { overlongScanId } : {}), reviewerSeeded: reviewer,
  };
}

/** The env object the remote code path reads, built in-process from a booted local world. */
export function envFromWorld(world) {
  const p = world.personas;
  return {
    LUQEN_UAT_BASE_URL: world.base,
    LUQEN_UAT_SCAN_ID: world.scanId,
    LUQEN_UAT_ADMIN_USER: p.admin.user, LUQEN_UAT_ADMIN_PASS: p.admin.pass,
    LUQEN_UAT_OWNER_USER: p.owner.user, LUQEN_UAT_OWNER_PASS: p.owner.pass,
    LUQEN_UAT_MEMBER_USER: p.member.user, LUQEN_UAT_MEMBER_PASS: p.member.pass,
    LUQEN_UAT_VIEWER_USER: p.viewer.user, LUQEN_UAT_VIEWER_PASS: p.viewer.pass,
    // The seeded world IS the dedicated target: its org name and the scan's site host.
    LUQEN_UAT_EXPECT_ORG: world.orgName,
    LUQEN_UAT_EXPECT_SITE_HOST: new URL(world.siteUrl).hostname,
  };
}

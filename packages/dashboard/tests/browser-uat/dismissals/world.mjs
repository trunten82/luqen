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
import { SITE, BACKFILL_SITE, buildReport, buildSmallReport, REASON, HERO, PROMO } from './fixture.mjs';

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

/**
 * 89-11 attribution world: two API keys (one of the Fabrikam org, one system key) and two active
 * dismissals whose actor is `api-key:<id>`. They are written through the storage adapter because
 * the dark build lets no org key mark through the API (issues.dismiss is global-admin only).
 * Placeholder labels only.
 */
async function seedApiKeyActors(storage, orgId, toSiteKey) {
  const fabrikamKeyId = await storage.apiKeys.storeKey(`uat-${randomUUID()}`, 'Fabrikam CI', orgId);
  const systemKeyId = await storage.apiKeys.storeKey(`uat-${randomUUID()}`, 'Northwind Ops');
  for (const [f, keyId] of [[PROMO, fabrikamKeyId], [HERO, systemKeyId]]) {
    const res = await storage.issueDismissals.mark({
      orgId, siteUrl: SITE, siteKey: toSiteKey(SITE), code: f.code, selector: f.selector,
      reason: 'Marked by an API key (seeded).', actor: `api-key:${keyId}`,
    });
    if (res.kind !== 'created') throw new Error('api-key actor mark did not create a row');
  }
  return { fabrikamKeyId, systemKeyId, fabrikamCode: PROMO.code, systemCode: HERO.code };
}

export async function bootLocal({ keepShots = true, apiKeyActors = false } = {}) {
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
  const keyActors = apiKeyActors ? await seedApiKeyActors(storage, orgId, toSiteKey) : null;
  await storage.disconnect();
  return { base: LOCAL_BASE, scanId, bigScanId, orgId, personas: PERSONAS, ...(keyActors ? { keyActors } : {}) };
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
  };
}

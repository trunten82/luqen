/**
 * Phase 87 Plan 04 — createServer-level proof for the issue-dismissal routes.
 *
 * Boots the REAL server (auth guard -> dark-aware permission resolution ->
 * route -> store -> audit) and drives it with Bearer API keys:
 *   - a global admin key (org 'system', role 'admin') marks a finding;
 *   - an org-scoped admin key (org A, role 'admin') marks and previews its own
 *     org's finding: since the Phase 89 grant (FP-18, D-16) it holds
 *     issues.dismiss through the ORG_OWNER_PERMISSIONS cap (D-15 Q4 = accept),
 *     and another org's scan is still 404;
 *   - an Owner of an org that EXISTED BEFORE migration 091 marks through a
 *     password session, so the grant reaches existing orgs through their role
 *     rows (the migration), not only through the constant cap; a Member of the
 *     same org is refused.
 *
 * Until Phase 89-09 the org-scoped key was refused here (403) while the
 * permission was dark; those two pins were flipped to the granted state in the
 * same commit as the lift.
 *
 * Storage is not decorated on the Fastify instance, so a second
 * SqliteStorageAdapter on the same file seeds and reads back (WAL; same
 * process).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { DASHBOARD_MIGRATIONS, MigrationRunner } from '../../src/db/sqlite/migrations.js';
import { generateApiKey } from '../../src/auth/api-key.js';
import {
  ORG_OWNER_PERMISSIONS,
  ORG_ADMIN_PERMISSIONS,
  ORG_MEMBER_PERMISSIONS,
  ORG_EXECUTIVE_PERMISSIONS,
  ORG_VIEWER_PERMISSIONS,
} from '../../src/permissions.js';

const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const SELECTOR = '#hero > p';
const SITE_URL = 'https://example.test/dev/en-us/';
const SITE_KEY = 'https://example.test/dev/en-us';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgA: string;
let scanA: string;
let systemKey: string;
let orgAKey: string;
let orgAKeyId: string;
let preOrg: string;
let preScan: string;
const PRE_SITE_URL = 'https://fabrikam.test/shop/';
const OWNER_PASSWORD = 'Owner-Pass-123!';
const MEMBER_PASSWORD = 'Member-Pass-123!';

/**
 * An org as the PRE-GRANT code created it: the migration list up to 090, then the org and its five
 * default roles with the old permission sets (no issues.dismiss), all before createServer runs 091.
 */
function seedPreGrantOrg(dbPath: string): string {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    new MigrationRunner(db).run(DASHBOARD_MIGRATIONS.filter((m) => m.id !== '091'));
    const orgId = 'org-pre-grant';
    const now = new Date().toISOString();
    db.prepare('INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
      .run(orgId, 'Fabrikam', 'fabrikam-pre', now);
    const oldSets: Record<string, readonly string[]> = {
      Owner: ORG_OWNER_PERMISSIONS,
      Admin: ORG_ADMIN_PERMISSIONS,
      Member: ORG_MEMBER_PERMISSIONS,
      Executive: ORG_EXECUTIVE_PERMISSIONS,
      Viewer: ORG_VIEWER_PERMISSIONS,
    };
    for (const [name, set] of Object.entries(oldSets)) {
      const roleId = `${orgId}:${name}`;
      db.prepare('INSERT INTO roles (id, name, description, is_system, org_id, created_at) VALUES (?, ?, ?, 0, ?, ?)')
        .run(roleId, name, '', orgId, now);
      for (const perm of set.filter((p) => p !== 'issues.dismiss')) {
        db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)').run(roleId, perm);
      }
    }
    const seeded = db.prepare("SELECT COUNT(*) AS n FROM role_permissions WHERE permission = 'issues.dismiss'").get() as { n: number };
    if (seeded.n !== 0) throw new Error('pre-grant org must not carry issues.dismiss');
    return orgId;
  } finally {
    db.close();
  }
}

async function addOrgUser(orgId: string, roleName: string, username: string, password: string): Promise<void> {
  const user = await seed.users.createUser(username, password, 'user');
  const team = await seed.teams.createTeam({ name: `${username}-team`, description: '', orgId, roleId: `${orgId}:${roleName}` });
  await seed.teams.addTeamMember(team.id, user.id);
}

/** A password session (POST /login is a browser form: CSRF token + the cookie it is bound to). */
async function passwordSession(username: string, password: string): Promise<string> {
  const page = await app.inject({ method: 'GET', url: '/login' });
  const token = /name="csrf-token" content="([^"]+)"|name="_csrf" value="([^"]+)"/.exec(page.body);
  const csrf = token?.[1] ?? token?.[2];
  expect(csrf).toBeDefined();
  const pageCookie = page.cookies.find((c) => c.name === 'session');
  expect(pageCookie).toBeDefined();
  const login = await app.inject({
    method: 'POST',
    url: '/login',
    cookies: { session: pageCookie!.value },
    headers: { 'x-csrf-token': csrf! },
    payload: { username, password },
  });
  expect(login.statusCode).toBe(302);
  const cookie = login.cookies.find((c) => c.name === 'session');
  expect(cookie).toBeDefined();
  return cookie!.value;
}

function report(pageUrls: string[]): string {
  return JSON.stringify({
    pages: pageUrls.map((url) => ({
      url,
      issues: [
        { type: 'error', code: CODE, message: 'contrast', selector: SELECTOR, context: '<p>x</p>' },
        { type: 'warning', code: 'WCAG2AA.Principle2.Other', message: 'other', selector: '#nav a', context: '<a>x</a>' },
      ],
    })),
    summary: { pagesScanned: pageUrls.length, totalIssues: pageUrls.length * 2, byLevel: { error: pageUrls.length, warning: pageUrls.length, notice: 0 } },
  });
}

async function seedScan(orgId: string, siteUrl: string): Promise<string> {
  const id = `scan_${randomUUID().replace(/-/g, '')}`;
  await seed.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    orgId,
  });
  await seed.scans.updateScan(id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    jsonReport: report([`${siteUrl}`, `${siteUrl}about`]),
  });
  return id;
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-dash-dismissals-e2e-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  preOrg = seedPreGrantOrg(dbPath);
  const config = {
    dbPath,
    reportsDir: join(tmpRoot, 'reports'),
    sessionSecret: 'a'.repeat(32),
    catalogueUrl: '',
    catalogueCacheTtl: 0,
    redisUrl: '',
    maxConcurrentScans: 1,
  };
  app = (await createServer(config as never)) as FastifyInstance;
  await app.ready();

  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  orgA = (await seed.organizations.createOrg({ name: 'Org A', slug: 'org-a-dis' })).id;
  scanA = await seedScan(orgA, SITE_URL);
  systemKey = generateApiKey();
  orgAKey = generateApiKey();
  await seed.apiKeys.storeKey(systemKey, 'e2e-system-admin', 'system', 'admin');
  orgAKeyId = await seed.apiKeys.storeKey(orgAKey, 'e2e-org-a-admin', orgA, 'admin');
  preScan = await seedScan(preOrg, PRE_SITE_URL);
  await addOrgUser(preOrg, 'Owner', 'fabrikam-owner', OWNER_PASSWORD);
  await addOrgUser(preOrg, 'Member', 'fabrikam-member', MEMBER_PASSWORD);
}, 60_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

function mark(scanId: string, key: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/scans/${scanId}/dismissals`,
    headers: { authorization: `Bearer ${key}` },
    payload: body,
  });
}

describe('issue dismissals through the real server (Phase 87-04)', () => {
  it('global admin api key marks a finding and the dismissal, its history and the audit row are stored', async () => {
    const res = await mark(scanA, systemKey, { code: CODE, selector: SELECTOR, reason: '  Hidden noscript copy  ' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('active');
    expect(body.reason).toBe('Hidden noscript copy');
    expect(body.site_key).toBe(SITE_KEY);
    expect(body.org_id).toBe(orgA);

    const active = await seed.issueDismissals!.listActiveForSite(orgA, SITE_KEY);
    expect(active).toHaveLength(1);
    const events = await seed.issueDismissals!.listEvents(body.id);
    expect(events.map((e) => e.action)).toEqual(['mark']);
    const audit = await seed.audit.query({ resourceType: 'issue_dismissal' });
    const entry = audit.entries.find((e) => e.resourceId === body.id);
    expect(entry).toBeDefined();
    expect(entry?.orgId).toBe(orgA);
  });

  it('org-scoped admin api key marks its own org\'s finding after the grant', async () => {
    // The report's second finding: the first is the global admin's mark above.
    const res = await mark(scanA, orgAKey, { code: 'WCAG2AA.Principle2.Other', selector: '#nav a', reason: 'Decorative duplicate' });
    expect(res.statusCode).toBe(201);
    expect(res.json().org_id).toBe(orgA);
    expect(res.json().created_by).toBe(`api-key:${orgAKeyId}`);
    const active = await seed.issueDismissals!.listActiveForSite(orgA, SITE_KEY);
    expect(active.map((d) => d.selector)).toContain('#nav a');
  });

  it('org-scoped admin api key still cannot touch another org\'s scan', async () => {
    const theirs = await freshTenant();
    const res = await mark(theirs.scanId, orgAKey, { code: CODE, selector: SELECTOR, reason: 'not my org' });
    expect(res.statusCode).toBe(404);
    expect(await seed.issueDismissals!.listActiveForSite(theirs.orgId, theirs.siteKey)).toHaveLength(0);
  });
});

describe('the grant reaches an org that existed before migration 091 (Phase 89-09)', () => {
  it('an org Owner of an org that existed before 091 marks a finding through the real server', async () => {
    const cookie = await passwordSession('fabrikam-owner', OWNER_PASSWORD);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/scans/${preScan}/dismissals`,
      cookies: { session: cookie },
      payload: { code: CODE, selector: SELECTOR, reason: 'Hidden noscript copy' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().org_id).toBe(preOrg);
    expect(res.json().created_by).toBe('fabrikam-owner');
  });

  it('a Member of the same pre-existing org is refused', async () => {
    const cookie = await passwordSession('fabrikam-member', MEMBER_PASSWORD);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/scans/${preScan}/dismissals`,
      cookies: { session: cookie },
      // A real finding of this scan, so a wrongly granted Member would get 201, not 422.
      payload: { code: 'WCAG2AA.Principle2.Other', selector: '#nav a', reason: 'should never be stored' },
    });
    expect(res.statusCode).toBe(403);
    const active = await seed.issueDismissals!.listActiveForSite(preOrg, 'https://fabrikam.test/shop');
    expect(active.map((d) => d.selector)).not.toContain('#nav a');
  });
});

describe('issue dismissal preview through the real server (Phase 89-01)', () => {
  it('global admin api key previews a finding', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/scans/${scanA}/dismissals/preview`,
      query: { code: CODE, selector: SELECTOR },
      headers: { authorization: `Bearer ${systemKey}` },
    });
    expect(res.statusCode).toBe(200);
    // The mark test above dismissed this exact code and selector, so the preview flags it (89-04).
    expect(res.json()).toEqual({ occurrences: 2, pages: 2, alreadyDismissed: true });
  });

  it('org-scoped admin api key previews its own org\'s finding after the grant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/scans/${scanA}/dismissals/preview`,
      query: { code: CODE, selector: SELECTOR },
      headers: { authorization: `Bearer ${orgAKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ occurrences: 2, pages: 2, alreadyDismissed: true });
  });
});

async function freshTenant(): Promise<{ orgId: string; scanId: string; key: string; siteKey: string }> {
  const slug = `org-${randomUUID().slice(0, 8)}`;
  const orgId = (await seed.organizations.createOrg({ name: slug, slug })).id;
  const siteUrl = `https://${slug}.test/dev/en-us/`;
  const scanId = await seedScan(orgId, siteUrl);
  const key = generateApiKey();
  await seed.apiKeys.storeKey(key, `e2e-${slug}`, orgId, 'admin');
  return { orgId, scanId, key, siteKey: `https://${slug}.test/dev/en-us` };
}

function authed(method: 'GET' | 'POST', url: string, key: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${key}` }, ...(payload !== undefined ? { payload } : {}) });
}

describe('issue dismissals through the real server — list and revoke', () => {
  it('org-scoped admin api key lists its own org\'s dismissals', async () => {
    const t = await freshTenant();
    const marked = await seed.issueDismissals!.mark({
      orgId: t.orgId, siteUrl: `${t.siteKey}/`, siteKey: t.siteKey, code: CODE, selector: SELECTOR, reason: 'seeded', actor: 'seed',
    });
    expect(marked.kind).toBe('created');
    const res = await authed('GET', `/api/v1/scans/${t.scanId}/dismissals`, t.key);
    expect(res.statusCode).toBe(200);
    const items = res.json().dismissals as Array<{ selector: string; status: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].selector).toBe(SELECTOR);
    expect(items[0].status).toBe('active');
  });

  it('org-scoped admin api key cannot list another org\'s scan', async () => {
    const mine = await freshTenant();
    const theirs = await freshTenant();
    const res = await authed('GET', `/api/v1/scans/${theirs.scanId}/dismissals`, mine.key);
    expect(res.statusCode).toBe(404);
  });

  it('global admin revokes and the list shows both events', async () => {
    const t = await freshTenant();
    const marked = await authed('POST', `/api/v1/scans/${t.scanId}/dismissals`, systemKey, {
      code: CODE, selector: SELECTOR, reason: 'Hidden noscript copy',
    });
    expect(marked.statusCode).toBe(201);
    const id = marked.json().id as string;
    const revoked = await authed('POST', `/api/v1/dismissals/${id}/revoke`, systemKey, { comment: 'no longer true' });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe('revoked');

    const res = await authed('GET', `/api/v1/scans/${t.scanId}/dismissals`, systemKey);
    expect(res.statusCode).toBe(200);
    const items = res.json().dismissals as Array<{ id: string; events: Array<{ action: string }> }>;
    expect(items.find((i) => i.id === id)?.events.map((e) => e.action)).toEqual(['mark', 'revoke']);
  });
});

/**
 * Quick 261013-dr7 (WR-02), default-on since HARD-10: the cookie-authenticated dismissal mutations
 * (mark, revoke) verify the CSRF token the report page's client already sends (X-CSRF-Token from
 * <meta name="csrf-token">), as every cookie-session /api write does (server.ts requiresCookieCsrf;
 * the whole route table is pinned in api-write-csrf-inventory.test.ts).
 *
 * @fastify/formbody is global, so a form-encoded mark/revoke is parsed like a JSON one and must be
 * refused without the token. A request whose API credential actually VALIDATES is not
 * cookie-authenticated and is left alone; a bogus Bearer header does not exempt a request, because
 * auth then falls through to the cookie (the /graphql rule, graphql/csrf-guard.ts).
 *
 * Boots the REAL createServer. A second SqliteStorageAdapter on the same file seeds and reads back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey } from '../../src/auth/api-key.js';
import { toSiteKey } from '../../src/services/issue-dismissals/site-key.js';

const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const SELECTOR = '#hero > p';
const PASSWORD = 'Owner-Pass-123!';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;
let systemKey: string;

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

async function seedScan(): Promise<{ scanId: string; siteUrl: string }> {
  const siteUrl = `https://fabrikam.test/${randomUUID().slice(0, 8)}/`;
  const scanId = `scan_${randomUUID().replace(/-/g, '')}`;
  await seed.scans.createScan({
    id: scanId, siteUrl, standard: 'WCAG2AA', jurisdictions: [], regulations: [],
    createdBy: 'seed', createdAt: new Date().toISOString(), orgId,
  });
  await seed.scans.updateScan(scanId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    jsonReport: JSON.stringify({
      pages: [{ url: siteUrl, issues: [{ type: 'error', code: CODE, message: 'contrast', selector: SELECTOR, context: '<p>x</p>' }] }],
      summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
    }),
  });
  return { scanId, siteUrl };
}

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

/** A password session as a browser holds it after opening the report page: cookie + page token. */
async function ownerSession(scanId: string): Promise<Session> {
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const login = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username: 'fabrikam-owner', password: PASSWORD },
  });
  expect(login.statusCode).toBe(302);
  let cookie = login.cookies.find((c) => c.name === 'session')!.value;
  const reportPage = await app.inject({ method: 'GET', url: `/reports/${scanId}`, cookies: { session: cookie } });
  expect(reportPage.statusCode).toBe(200);
  cookie = reportPage.cookies.find((c) => c.name === 'session')?.value ?? cookie;
  const csrf = tokenOf(reportPage.body);
  expect(csrf).toBeDefined();
  return { cookie, csrf: csrf! };
}

async function activeCount(siteUrl: string): Promise<number> {
  return (await seed.issueDismissals!.listActiveForSite(orgId, toSiteKey(siteUrl))).length;
}

async function markWithKey(scanId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: `/api/v1/scans/${scanId}/dismissals`,
    headers: { authorization: `Bearer ${systemKey}` },
    payload: { code: CODE, selector: SELECTOR, reason: 'Hidden noscript copy' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-dismissal-csrf-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  app = (await createServer({
    dbPath, reportsDir: join(tmpRoot, 'reports'), sessionSecret: 'd'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  orgId = (await seed.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam-csrf' })).id;
  const owner = await seed.users.createUser('fabrikam-owner', PASSWORD, 'user');
  const ownerRole = await seed.roles.getRoleByNameAndOrg('Owner', orgId);
  const team = await seed.teams.createTeam({ name: 'owners', description: '', orgId, roleId: ownerRole!.id });
  await seed.teams.addTeamMember(team.id, owner.id);
  await seed.organizations.addMember(orgId, owner.id, 'owner');
  systemKey = generateApiKey();
  await seed.apiKeys.storeKey(systemKey, 'csrf-system-admin', 'system', 'admin');
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('cookie-session dismissal mutations require the CSRF token', () => {
  it('a session mark without a CSRF token is refused and stores nothing', async () => {
    const { scanId, siteUrl } = await seedScan();
    const s = await ownerSession(scanId);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/scans/${scanId}/dismissals`, cookies: { session: s.cookie },
      payload: { code: CODE, selector: SELECTOR, reason: 'no token' },
    });
    expect(res.statusCode).toBe(403);
    expect(await activeCount(siteUrl)).toBe(0);
  }, 60_000);

  it('a session form-encoded mark without a token is refused', async () => {
    const { scanId, siteUrl } = await seedScan();
    const s = await ownerSession(scanId);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/scans/${scanId}/dismissals`, cookies: { session: s.cookie },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(CODE)}&selector=${encodeURIComponent(SELECTOR)}&reason=form`,
    });
    expect(res.statusCode).toBe(403);
    expect(await activeCount(siteUrl)).toBe(0);
  }, 60_000);

  it('a session revoke without a token is refused and the dismissal stays active', async () => {
    const { scanId, siteUrl } = await seedScan();
    const id = await markWithKey(scanId);
    const s = await ownerSession(scanId);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/dismissals/${id}/revoke`, cookies: { session: s.cookie },
      payload: { comment: 'no token' },
    });
    expect(res.statusCode).toBe(403);
    expect(await activeCount(siteUrl)).toBe(1);
  }, 60_000);

  it('a bogus Bearer header plus a session cookie without a token is refused', async () => {
    const { scanId, siteUrl } = await seedScan();
    const s = await ownerSession(scanId);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/scans/${scanId}/dismissals`, cookies: { session: s.cookie },
      headers: { authorization: 'Bearer bogus-token' },
      payload: { code: CODE, selector: SELECTOR, reason: 'bogus bearer' },
    });
    expect(res.statusCode).toBe(403);
    expect(await activeCount(siteUrl)).toBe(0);
  }, 60_000);

  it('a session mark with the page X-CSRF-Token succeeds', async () => {
    const { scanId, siteUrl } = await seedScan();
    const s = await ownerSession(scanId);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/scans/${scanId}/dismissals`, cookies: { session: s.cookie },
      headers: { 'x-csrf-token': s.csrf },
      payload: { code: CODE, selector: SELECTOR, reason: 'with token' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().created_by).toBe('fabrikam-owner');
    expect(await activeCount(siteUrl)).toBe(1);
  }, 60_000);

  it('a session revoke with the token succeeds', async () => {
    const { scanId, siteUrl } = await seedScan();
    const id = await markWithKey(scanId);
    const s = await ownerSession(scanId);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/dismissals/${id}/revoke`, cookies: { session: s.cookie },
      headers: { 'x-csrf-token': s.csrf },
      payload: { comment: 'with token' },
    });
    expect(res.statusCode).toBe(200);
    expect(await activeCount(siteUrl)).toBe(0);
  }, 60_000);

  it('a valid Bearer API key marks without any CSRF token', async () => {
    const { scanId, siteUrl } = await seedScan();
    await markWithKey(scanId);
    expect(await activeCount(siteUrl)).toBe(1);
  }, 60_000);
});

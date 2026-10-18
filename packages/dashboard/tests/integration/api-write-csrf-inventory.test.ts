/**
 * HARD-10: a cookie-authenticated request to a state-changing /api route must carry the CSRF token,
 * by default. A request whose API credential VALIDATES (Authorization: Bearer <key> or X-API-Key) is
 * not cookie-authenticated and is never asked for a token.
 *
 * Boots the REAL createServer. A second SqliteStorageAdapter on the same file seeds and reads back.
 * The CSRF check runs in a preHandler, after schema validation, so every request here sends a VALID
 * body: an invalid body would be refused 400 before the CSRF decision is reached.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

const PASSWORD = 'Owner-Pass-123!';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

async function seedScan(): Promise<string> {
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
      pages: [{ url: siteUrl, issues: [] }],
      summary: { pagesScanned: 1, totalIssues: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
    }),
  });
  return scanId;
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
    payload: { username: 'fabrikam-csrf-owner', password: PASSWORD },
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

async function shareFlag(scanId: string): Promise<boolean | undefined> {
  return (await seed.scans.getScan(scanId))?.publicShareEnabled;
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-api-write-csrf-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  app = (await createServer({
    dbPath, reportsDir: join(tmpRoot, 'reports'), sessionSecret: 'e'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  orgId = (await seed.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam-api-csrf' })).id;
  const owner = await seed.users.createUser('fabrikam-csrf-owner', PASSWORD, 'user');
  const ownerRole = await seed.roles.getRoleByNameAndOrg('Owner', orgId);
  const team = await seed.teams.createTeam({ name: 'owners', description: '', orgId, roleId: ownerRole!.id });
  await seed.teams.addTeamMember(team.id, owner.id);
  await seed.organizations.addMember(orgId, owner.id, 'owner');
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('HARD-10 cookie sessions need the CSRF token on /api writes', () => {
  it('HARD-10 public share toggle refuses a cookie session without the token', async () => {
    const scanId = await seedScan();
    const s = await ownerSession(scanId);
    expect(await shareFlag(scanId)).toBe(false);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/reports/${scanId}/public-share`, cookies: { session: s.cookie },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
    expect(await shareFlag(scanId)).toBe(false);
  }, 60_000);

  it('HARD-10 a cookie session with the token still reaches an api write route', async () => {
    const scanId = await seedScan();
    const s = await ownerSession(scanId);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/reports/${scanId}/public-share`, cookies: { session: s.cookie },
      headers: { 'x-csrf-token': s.csrf },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(await shareFlag(scanId)).toBe(true);
  }, 60_000);
});

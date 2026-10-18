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
import {
  COOKIE_CSRF_EXEMPT_API_PATHS,
  createServer,
  isPublicPath,
  requiresCookieCsrf,
} from '../../src/server.js';
import { isBearerOnlyPath } from '../../src/mcp/paths.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey } from '../../src/auth/api-key.js';

const PASSWORD = 'Owner-Pass-123!';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;
let systemKey: string;

const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Every distinct `METHOD path` write route under /api/ that createServer registered. */
function apiWriteRoutes(): ReadonlyArray<{ readonly method: string; readonly path: string }> {
  const collected = (app as unknown as { __collectedRoutes?: Array<{ method: string; path: string }> })
    .__collectedRoutes ?? [];
  const seen = new Map<string, { method: string; path: string }>();
  for (const r of collected) {
    if (WRITE_METHODS.has(r.method) && r.path.startsWith('/api/')) seen.set(`${r.method} ${r.path}`, r);
  }
  return [...seen.values()];
}

const isExempt = (path: string): boolean => COOKIE_CSRF_EXEMPT_API_PATHS.has(path) || isBearerOnlyPath(path);

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
  systemKey = generateApiKey();
  await seed.apiKeys.storeKey(systemKey, 'api-csrf-system-admin', 'system', 'admin');
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

  // The prod read-back (tests/uat-live/uat-graphql-createscan.mjs) probes exactly this request on its own scan;
  // its selftest fake models this answer, so the real server's answer is pinned here.
  it('HARD-10 a cookie session without the token cannot delete a scan through the api', async () => {
    const scanId = await seedScan();
    const s = await ownerSession(scanId);
    const refused = await app.inject({ method: 'DELETE', url: `/api/v1/scans/${scanId}`, cookies: { session: s.cookie } });
    expect(refused.statusCode).toBe(403);
    expect(refused.body).toMatch(/csrf/i);
    expect(await seed.scans.getScan(scanId)).not.toBeNull();
    const allowed = await app.inject({
      method: 'DELETE', url: `/api/v1/scans/${scanId}`, cookies: { session: s.cookie }, headers: { 'x-csrf-token': s.csrf },
    });
    expect(allowed.statusCode).toBe(200);
    expect(await seed.scans.getScan(scanId)).toBeNull();
  }, 60_000);

  it('HARD-10 every cookie reachable api write route requires the csrf token', () => {
    const routes = apiWriteRoutes();
    const keys = new Set(routes.map((r) => `${r.method} ${r.path}`));
    // Walker control: the route table really was read (an empty walk would pass vacuously).
    expect(keys.has('POST /api/v1/scans/:scanId/dismissals')).toBe(true);
    expect(keys.has('POST /api/v1/reports/:id/public-share')).toBe(true);
    expect(keys.has('DELETE /api/v1/scans/:id')).toBe(true);
    expect(routes.length).toBeGreaterThanOrEqual(40);
    const unprotected = routes
      .filter((r) => !isExempt(r.path))
      .filter((r) => !requiresCookieCsrf(r.method, r.path, false))
      .map((r) => `${r.method} ${r.path}`);
    expect(unprotected, `cookie-session writes that would not need the CSRF token:\n${unprotected.join('\n')}`).toEqual([]);
  });

  it('HARD-10 the allowlist names only public and bearer only routes', () => {
    const notPublicOrBearer = [...COOKIE_CSRF_EXEMPT_API_PATHS].filter((p) => !isPublicPath(p) && !isBearerOnlyPath(p));
    expect(notPublicOrBearer, `allowlisted paths that are neither public nor Bearer-only: ${notPublicOrBearer.join(', ')}`).toEqual([]);
    // Every public pre-auth /api write is on the allowlist (so it is a named decision, not an accident).
    const publicWrites = apiWriteRoutes().filter((r) => isPublicPath(r.path));
    expect(publicWrites.length).toBeGreaterThan(0);
    const unlisted = publicWrites.filter((r) => !COOKIE_CSRF_EXEMPT_API_PATHS.has(r.path)).map((r) => `${r.method} ${r.path}`);
    expect(unlisted, `public /api writes missing from the allowlist: ${unlisted.join(', ')}`).toEqual([]);
    // The exemptions really are exempt for a cookie session, and nothing else under /api is.
    for (const p of COOKIE_CSRF_EXEMPT_API_PATHS) expect(requiresCookieCsrf('POST', p, false)).toBe(false);
    expect(requiresCookieCsrf('POST', '/api/v1/mcp', false)).toBe(false);
  });

  it('HARD-10 api key callers are not asked for a csrf token', async () => {
    // Authorization: Bearer <key> (CI, scripts) and X-API-Key (the WordPress plugin), no session, no token.
    for (const headers of [{ authorization: `Bearer ${systemKey}` }, { 'x-api-key': systemKey }]) {
      const scanId = await seedScan();
      const res = await app.inject({
        method: 'POST', url: `/api/v1/reports/${scanId}/public-share`, headers, payload: { enabled: true },
      });
      expect(res.statusCode, Object.keys(headers)[0]).toBe(200);
      expect(await shareFlag(scanId)).toBe(true);
    }
    // A valid key decides even when the client also holds a session cookie.
    const scanId = await seedScan();
    const s = await ownerSession(scanId);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/reports/${scanId}/public-share`, cookies: { session: s.cookie },
      headers: { 'x-api-key': systemKey }, payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(await shareFlag(scanId)).toBe(true);
  }, 60_000);

  it('HARD-10 a caller with neither a session nor a valid api key is still refused by authentication', async () => {
    // A Bearer that is not an API key (for example an OAuth access token) does not authenticate a
    // non-MCP /api route; that caller keeps getting 401, never a CSRF 403.
    const scanId = await seedScan();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/reports/${scanId}/public-share`,
      headers: { authorization: 'Bearer not-an-api-key' }, payload: { enabled: true },
    });
    expect(res.statusCode).toBe(401);
    expect(await shareFlag(scanId)).toBe(false);
  }, 60_000);
});

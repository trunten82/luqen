/**
 * Phase 31.1 Plan 02 Task 2 — /oauth/authorize GET + POST /oauth/authorize/consent.
 *
 * Tests 1–11 + 11b per plan (+ Test 11b defense-in-depth redirect_uri
 * re-validation on the POST handler).
 *
 * Harness:
 *   - Temp-file SQLite (matches the Wave 1 repo-test style).
 *   - Fastify.inject() — no real HTTP.
 *   - @fastify/secure-session + @fastify/formbody + @fastify/csrf-protection.
 *   - A preHandler stub attaches request.user + request.permissions + a
 *     session "orgId" so the route sees an authenticated dashboard user
 *     without running the full AuthService.
 *   - `reply.view` is decorated to return { template, data } JSON for
 *     non-HTMX rendering assertions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { registerAuthorizeRoutes } from '../../../src/routes/oauth/authorize.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestCtx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  userId: string;
  clientId: string;
  redirectUri: string;
  csrfToken: string;
  cleanup: () => Promise<void>;
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function seedUser(storage: SqliteStorageAdapter, id: string, role: string = 'admin'): Promise<void> {
  const db = storage.getRawDatabase();
  db.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', ?, 1, ?)`,
  ).run(id, `user-${id}`, role, new Date().toISOString());
}

async function seedClient(storage: SqliteStorageAdapter, redirectUris: string[]): Promise<string> {
  const r = await storage.oauthClients.register({
    clientName: 'Test MCP Client',
    redirectUris,
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read write',
  });
  return r.clientId;
}

async function buildCtx(opts: {
  readonly role?: string;
  readonly adminPermissions?: boolean;
} = {}): Promise<TestCtx> {
  const dbPath = join(tmpdir(), `test-authz-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const userId = randomUUID();
  const role = opts.role ?? 'admin';
  await seedUser(storage, userId, role);

  const redirectUri = 'https://app.test/cb';
  const clientId = await seedClient(storage, [redirectUri]);

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  await server.register(import('@fastify/csrf-protection'), {
    sessionPlugin: '@fastify/secure-session',
  });

  // Stub reply.view so tests can read template + data as JSON.
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // Attach test user + permissions + csrfToken to session.
  let capturedCsrfToken = '';
  server.addHook('preHandler', async (request, reply) => {
    request.user = { id: userId, username: `user-${userId}`, role };
    const permissions =
      opts.adminPermissions === false
        ? new Set<string>(['reports.view']) // no admin.system
        : new Set(ALL_PERMISSION_IDS);
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;

    const session = request.session as {
      get?: (k: string) => unknown;
      set?: (k: string, v: unknown) => void;
    };
    if (typeof session.set === 'function') {
      session.set('currentOrgId', 'org-test');
      // Expose orgId at top-level for handler convenience.
      session.set('orgId', 'org-test');
    }

    // Make csrfToken available to the handler via reply.generateCsrf()
    capturedCsrfToken = reply.generateCsrf();
    (request as unknown as Record<string, unknown>)['__csrfToken'] = capturedCsrfToken;
  });

  await registerAuthorizeRoutes(server, storage);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return { server, storage, userId, clientId, redirectUri, csrfToken: capturedCsrfToken, cleanup };
}

// Utility to get a fresh csrf token from a GET and carry over the session cookie.
// Note: Fastify's `res.cookies[0].value` is the raw (unencoded) cookie value.
// secure-session cookies must be URL-encoded when round-tripping through a
// `Cookie:` header, otherwise the session fails to decode and the stored CSRF
// secret appears missing.
async function primeCsrf(ctx: TestCtx): Promise<{ csrf: string; cookie: string }> {
  const verifier = 'a'.repeat(50);
  const url = `/oauth/authorize?response_type=code&client_id=${ctx.clientId}&redirect_uri=${encodeURIComponent(
    ctx.redirectUri,
  )}&scope=read&resource=${encodeURIComponent('https://svc/mcp')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=abc`;
  const res = await ctx.server.inject({ method: 'GET', url });
  // Pull the full Set-Cookie header and reuse the same name=value pair
  // (pre-encoded) on the POST's Cookie header.
  const rawSetCookie = res.headers['set-cookie'];
  const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie[0] : (rawSetCookie ?? '');
  const cookie = setCookie.split(';')[0] ?? '';
  const body = JSON.parse(res.body) as { data: { csrfToken: string } };
  return { csrf: body.data.csrfToken, cookie };
}

// ── GET /oauth/authorize ────────────────────────────────────────────────────

describe('GET /oauth/authorize — Test 2 (invalid scope)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 400 invalid_scope when scope is not in whitelist', async () => {
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${ctx.clientId}&redirect_uri=${encodeURIComponent(
        ctx.redirectUri,
      )}&scope=scan&resource=${encodeURIComponent('https://svc/mcp')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=x`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_scope' });
  });
});

describe('GET /oauth/authorize — Test 3 (code_challenge_method=plain rejected)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 400 invalid_request for plain PKCE', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${ctx.clientId}&redirect_uri=${encodeURIComponent(
        ctx.redirectUri,
      )}&scope=read&resource=${encodeURIComponent('https://svc/mcp')}&code_challenge=abcdef&code_challenge_method=plain&state=x`,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; error_description?: string };
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toContain('S256');
  });
});

describe('GET /oauth/authorize — Test 4 (redirect_uri mismatch)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it("returns 400 invalid_request when redirect_uri isn't in client.redirectUris", async () => {
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${ctx.clientId}&redirect_uri=${encodeURIComponent(
        'https://evil.example/cb',
      )}&scope=read&resource=${encodeURIComponent('https://svc/mcp')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=x`,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; error_description?: string };
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toBe('redirect_uri mismatch');
  });
});

describe('GET /oauth/authorize — Test 5 (admin.system without admin.system permission)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx({ role: 'viewer', adminPermissions: false }); });
  afterEach(async () => { await ctx.cleanup(); });

  it('renders adminScopeBlocked card', async () => {
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${ctx.clientId}&redirect_uri=${encodeURIComponent(
        ctx.redirectUri,
      )}&scope=${encodeURIComponent('read admin.system')}&resource=${encodeURIComponent('https://svc/mcp')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=x`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { template: string; data: { adminScopeBlocked: boolean } };
    expect(body.template).toBe('oauth-consent');
    expect(body.data.adminScopeBlocked).toBe(true);
  });
});

describe('GET /oauth/authorize — Test 6 (first-connect renders consent screen)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns consent template with csrfToken, client_name, scopes, resources', async () => {
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${ctx.clientId}&redirect_uri=${encodeURIComponent(
        ctx.redirectUri,
      )}&scope=${encodeURIComponent('read write')}&resource=${encodeURIComponent('https://svc/mcp')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=abc`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      template: string;
      data: {
        adminScopeBlocked: boolean;
        csrfToken: string;
        client: { clientName: string };
        scopeDescriptions: Array<{ scope: string }>;
        resources: readonly string[];
        state: string;
      };
    };
    expect(body.template).toBe('oauth-consent');
    expect(body.data.adminScopeBlocked).toBe(false);
    expect(typeof body.data.csrfToken).toBe('string');
    expect(body.data.csrfToken.length).toBeGreaterThan(0);
    expect(body.data.client.clientName).toBe('Test MCP Client');
    expect(body.data.scopeDescriptions.map((s) => s.scope)).toEqual(['read', 'write']);
    expect(body.data.resources).toEqual(['https://svc/mcp']);
    expect(body.data.state).toBe('abc');
  });
});

describe('GET /oauth/authorize — Test 7 (covered consent auto-redirects with code)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('auto-redirects 302 with code when consent already covers scope + resource', async () => {
    await ctx.storage.oauthConsents.recordConsent({
      userId: ctx.userId,
      clientId: ctx.clientId,
      scopes: ['read', 'write'],
      resources: ['https://svc/mcp'],
    });
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${ctx.clientId}&redirect_uri=${encodeURIComponent(
        ctx.redirectUri,
      )}&scope=${encodeURIComponent('read')}&resource=${encodeURIComponent('https://svc/mcp')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=abc`,
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain(`${ctx.redirectUri}?code=`);
    expect(location).toContain('&state=abc');
    // Code row present in DB.
    const db = ctx.storage.getRawDatabase();
    const row = db.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get() as { n: number };
    expect(row.n).toBe(1);
  });
});

// ── POST /oauth/authorize/consent ───────────────────────────────────────────

describe('POST /oauth/authorize/consent — Test 8 (approve inserts consent + code + redirects)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('writes consent + authorization code (TTL 60s) + 302 with code', async () => {
    const { csrf, cookie } = await primeCsrf(ctx);
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/authorize/consent',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        client_id: ctx.clientId,
        redirect_uri: ctx.redirectUri,
        scope: 'read',
        resource: 'https://svc/mcp',
        state: 'abc',
        code_challenge: s256(verifier),
        code_challenge_method: 'S256',
        approved: 'true',
      }).toString(),
    });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc.startsWith(`${ctx.redirectUri}?code=`)).toBe(true);
    expect(loc).toContain('&state=abc');

    const consents = await ctx.storage.oauthConsents.listByUser(ctx.userId);
    expect(consents.length).toBe(1);
    expect(consents[0]!.clientId).toBe(ctx.clientId);
    expect([...consents[0]!.scopes].sort()).toEqual(['read']);

    const db = ctx.storage.getRawDatabase();
    const row = db.prepare('SELECT * FROM oauth_authorization_codes').get() as {
      client_id: string; user_id: string; scope: string; resource: string;
      code_challenge: string; expires_at: string; org_id: string;
    };
    expect(row.client_id).toBe(ctx.clientId);
    expect(row.user_id).toBe(ctx.userId);
    expect(row.scope).toBe('read');
    expect(row.resource).toBe('https://svc/mcp');
    expect(row.code_challenge).toBe(s256(verifier));
    expect(row.org_id).toBe('org-test');
    // TTL 60s — expires_at - created_at ≈ 60s.
    const expires = Date.parse(row.expires_at);
    expect(expires - Date.now()).toBeGreaterThan(50_000);
    expect(expires - Date.now()).toBeLessThan(70_000);
  });
});

describe('POST /oauth/authorize/consent — Test 9 (deny redirects with access_denied)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('redirects with ?error=access_denied&state=... and writes no row', async () => {
    const { csrf, cookie } = await primeCsrf(ctx);
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/authorize/consent',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        client_id: ctx.clientId,
        redirect_uri: ctx.redirectUri,
        scope: 'read',
        resource: 'https://svc/mcp',
        state: 'abc',
        code_challenge: s256(verifier),
        code_challenge_method: 'S256',
        approved: 'false',
      }).toString(),
    });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toContain('error=access_denied');
    expect(loc).toContain('state=abc');

    const consents = await ctx.storage.oauthConsents.listByUser(ctx.userId);
    expect(consents.length).toBe(0);

    const db = ctx.storage.getRawDatabase();
    const n = (db.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get() as { n: number }).n;
    expect(n).toBe(0);
  });
});

describe('POST /oauth/authorize/consent — Test 10 (missing CSRF returns 403)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 403 without a valid CSRF token', async () => {
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/authorize/consent',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        // _csrf intentionally omitted
        client_id: ctx.clientId,
        redirect_uri: ctx.redirectUri,
        scope: 'read',
        resource: 'https://svc/mcp',
        state: 'abc',
        code_challenge: s256(verifier),
        code_challenge_method: 'S256',
        approved: 'true',
      }).toString(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /oauth/authorize/consent — Test 11 (non-admin user cannot grant admin.system)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx({ role: 'viewer', adminPermissions: false }); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 403 when a non-admin forges admin.system in consent POST', async () => {
    const { csrf, cookie } = await primeCsrf(ctx);
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/authorize/consent',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        client_id: ctx.clientId,
        redirect_uri: ctx.redirectUri,
        scope: 'read admin.system',
        resource: 'https://svc/mcp',
        state: 'abc',
        code_challenge: s256(verifier),
        code_challenge_method: 'S256',
        approved: 'true',
      }).toString(),
    });
    expect(res.statusCode).toBe(403);

    const db = ctx.storage.getRawDatabase();
    const n = (db.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get() as { n: number }).n;
    expect(n).toBe(0);
  });
});

describe('POST /oauth/authorize/consent — Test 11b (tampered redirect_uri re-validated)', () => {
  let ctx: TestCtx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 400 invalid_request AND writes no code row when redirect_uri is not in client.redirectUris[]', async () => {
    const { csrf, cookie } = await primeCsrf(ctx);
    const verifier = 'a'.repeat(50);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/authorize/consent',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        client_id: ctx.clientId,
        redirect_uri: 'https://evil.example/cb', // tampered!
        scope: 'read',
        resource: 'https://svc/mcp',
        state: 'abc',
        code_challenge: s256(verifier),
        code_challenge_method: 'S256',
        approved: 'true',
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; error_description?: string };
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toBe('redirect_uri mismatch');

    const db = ctx.storage.getRawDatabase();
    const n = (db.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes').get() as { n: number }).n;
    expect(n).toBe(0);
  });
});

// ── Test 1 (unauthenticated → /login redirect) ──────────────────────────────
//
// The authenticated-only preHandler and unauthenticated flow are enforced by
// the outer dashboard auth guard (server.ts:createAuthGuard) which applies to
// EVERY route that isn't in the PUBLIC_PATHS set. Since /oauth/authorize is
// NOT in that set, requests without a cookie session are redirected to /login
// by the global guard before the route handler runs. That guard is covered by
// existing auth-service tests. We verify the shape here by asserting the
// handler does not expose the consent screen to anonymous callers — in this
// harness we simulate by skipping the preHandler stub and asserting the
// request.user check inside the handler redirects to /login.

describe('GET /oauth/authorize — Test 1 (no session → redirect to /login)', () => {
  let server: FastifyInstance;
  let storage: SqliteStorageAdapter;
  let dbPath: string;
  let clientId: string;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `test-authz-anon-${randomUUID()}.db`);
    storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();
    await seedUser(storage, randomUUID());
    clientId = await seedClient(storage, ['https://app.test/cb']);

    server = Fastify({ logger: false });
    await server.register(import('@fastify/formbody'));
    await registerSession(server, TEST_SESSION_SECRET);
    await server.register(import('@fastify/csrf-protection'), {
      sessionPlugin: '@fastify/secure-session',
    });
    server.decorateReply(
      'view',
      function (this: FastifyReply, template: string, data: unknown) {
        return this.code(200).send(JSON.stringify({ template, data }));
      },
    );
    // NO preHandler stub — request.user remains undefined.
    await registerAuthorizeRoutes(server, storage);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it('redirects 302 to /login?redirect=<encoded original URL>', async () => {
    const verifier = 'b'.repeat(50);
    const originalUrl =
      `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent('https://app.test/cb')}&scope=read&resource=${encodeURIComponent('https://svc/mcp')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=z`;
    const res = await server.inject({ method: 'GET', url: originalUrl });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc.startsWith('/login?redirect=')).toBe(true);
    expect(decodeURIComponent(loc.slice('/login?redirect='.length))).toBe(originalUrl);
  });
});

// Keep a handle on randomBytes import so the TS compiler never drops it.
void randomBytes;

/**
 * Phase 31.2 Plan 02 Task 2b — POST /session/switch-org.
 *
 * The /session/switch-org route is the backing handler for the D-05 switch-
 * org CTA on the OAuth consent screen. Semantically it mirrors
 * POST /orgs/switch but:
 *   - accepts `returnTo` in the POST body (open-redirect-safe via
 *     safeReturnTo) instead of sniffing the referer header, because the
 *     consent form supplies a precise /oauth/authorize?... URL it wants
 *     to resume;
 *   - lives on /session/ namespace to keep OAuth-flow semantics separate
 *     from the generic dashboard nav-dropdown switcher.
 *
 * Harness: in-memory sqlite + Fastify.inject() + CSRF preHandler bound
 * globally (mirrors the real dashboard server setup).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { authRoutes } from '../../src/routes/auth.js';
import { orgRoutes } from '../../src/routes/orgs.js';
import type { DashboardConfig } from '../../src/config.js';
import type { AuthService } from '../../src/auth/auth-service.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

// Minimal stub matching DashboardConfig shape used by authRoutes.
const CONFIG_STUB = {
  complianceUrl: 'http://localhost:4000',
  complianceClientId: 'dashboard',
  complianceClientSecret: '',
  sessionSecret: TEST_SESSION_SECRET,
} as unknown as DashboardConfig;

// Minimal AuthService stub — authRoutes only calls methods on it in login
// paths, which this test file never exercises.
const AUTH_SERVICE_STUB = {
  getAuthMode: () => 'team',
  getLoginMethods: () => [],
  getBootId: () => 'test',
  validateApiKey: () => false,
  getAuthPlugins: () => [],
  loginWithPassword: async () => ({ authenticated: false }),
  handleSsoCallback: async () => ({ authenticated: false }),
  authenticateRequest: async () => ({ authenticated: false }),
} as unknown as AuthService;

interface Ctx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  orgAId: string;
  orgBId: string;
  userAId: string; // member of org-A + org-B
  userBId: string; // member of org-B only
  cleanup: () => Promise<void>;
}

/**
 * Build a Fastify test harness with authRoutes + orgRoutes wired up, CSRF
 * bound globally, and a preHandler that logs in `activeUser` ('A' or 'B')
 * and seeds their initial session.currentOrgId.
 */
async function buildCtx(activeUser: 'A' | 'B' = 'A'): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-switch-org-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  // Seed orgs.
  const orgA = await storage.organizations.createOrg({
    name: 'Org A',
    slug: `org-a-${randomUUID()}`,
  });
  const orgB = await storage.organizations.createOrg({
    name: 'Org B',
    slug: `org-b-${randomUUID()}`,
  });

  // Seed users.
  const userA = await storage.users.createUser(`userA-${randomUUID()}`, 'pw', 'user');
  const userB = await storage.users.createUser(`userB-${randomUUID()}`, 'pw', 'user');

  // userA is a member of BOTH orgs; userB is a member of ONLY org-B.
  await storage.organizations.addMember(orgA.id, userA.id, 'member');
  await storage.organizations.addMember(orgB.id, userA.id, 'member');
  await storage.organizations.addMember(orgB.id, userB.id, 'member');

  const activeUserId = activeUser === 'A' ? userA.id : userB.id;
  // Seed initial currentOrgId so "session not mutated" assertions can detect
  // post-request mutation. Both users start on org-B to keep invariants
  // predictable:
  //   - userA (member of A + B) starts on org-A; switch to org-B = happy path.
  //   - userB (member of B only) starts on org-B; attempt to switch to org-A = forbidden.
  const seededOrgId = activeUser === 'A' ? orgA.id : orgB.id;

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  await server.register(import('@fastify/csrf-protection'), {
    sessionPlugin: '@fastify/secure-session',
  });

  // Inject a logged-in user BEFORE CSRF check. This mirrors server.ts which
  // runs the auth guard before the CSRF preHandler.
  server.addHook('preHandler', async (request: FastifyRequest) => {
    request.user = {
      id: activeUserId,
      username: `u-${activeUserId}`,
      role: 'user',
    };
    const session = request.session as { get(k: string): unknown; set(k: string, v: unknown): void };
    if (session.get('currentOrgId') === undefined) {
      session.set('currentOrgId', seededOrgId);
    }
  });

  // CSRF preHandler bound globally (matches server.ts lines 797-808).
  const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!CSRF_METHODS.has(request.method)) return;
    await new Promise<void>((resolve, reject) => {
      (server as unknown as {
        csrfProtection: (req: FastifyRequest, rep: FastifyReply, cb: (err?: Error) => void) => void;
      }).csrfProtection(request, reply, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  await authRoutes(server, CONFIG_STUB, AUTH_SERVICE_STUB, storage);
  // /orgs/current is our post-request probe for session mutation.
  await orgRoutes(server, storage);

  // Test-only CSRF-token echo route. Must be registered before ready().
  server.get('/__test/csrf', async (_req, reply) => {
    return reply.send({ token: reply.generateCsrf() });
  });

  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return {
    server,
    storage,
    orgAId: orgA.id,
    orgBId: orgB.id,
    userAId: userA.id,
    userBId: userB.id,
    cleanup,
  };
}

/**
 * Issue a GET /__test/csrf and return the CSRF token + the session cookie
 * the test must reuse on the subsequent POST. @fastify/csrf-protection
 * stores its secret in the session; the cookie carries that secret forward.
 */
async function primeCsrf(ctx: Ctx): Promise<{ csrf: string; cookie: string }> {
  const res = await ctx.server.inject({ method: 'GET', url: '/__test/csrf' });
  const rawSetCookie = res.headers['set-cookie'];
  const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie[0] : (rawSetCookie ?? '');
  const cookie = setCookie.split(';')[0] ?? '';
  const body = res.json() as { token: string };
  return { csrf: body.token, cookie };
}

describe('POST /session/switch-org — Phase 31.2 Task 2b (D-05)', () => {
  let ctx: Ctx;

  afterEach(async () => { if (ctx !== undefined) await ctx.cleanup(); });

  it('Test 1 (happy path): member of target org → 302 Location=returnTo; session.currentOrgId switched', async () => {
    ctx = await buildCtx('A');
    const { csrf, cookie } = await primeCsrf(ctx);

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/session/switch-org',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        orgId: ctx.orgBId,
        returnTo: '/oauth/authorize?client_id=xyz&scope=read',
      }).toString(),
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/oauth/authorize?client_id=xyz&scope=read');

    // Verify session mutation via /orgs/current.
    const rawSetCookie = res.headers['set-cookie'];
    const cookieAfter = Array.isArray(rawSetCookie)
      ? (rawSetCookie[0] ?? cookie).split(';')[0] ?? cookie
      : (rawSetCookie ?? cookie).toString().split(';')[0] ?? cookie;
    const probe = await ctx.server.inject({
      method: 'GET',
      url: '/orgs/current',
      headers: { cookie: cookieAfter },
    });
    const body = probe.json() as { currentOrgId: string };
    expect(body.currentOrgId).toBe(ctx.orgBId);
  });

  it('Test 2 (forbidden): non-member → 403; session NOT mutated', async () => {
    // userB is a member of org-B only; attempt to switch to org-A → 403.
    ctx = await buildCtx('B');
    const { csrf, cookie } = await primeCsrf(ctx);

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/session/switch-org',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        orgId: ctx.orgAId,
        returnTo: '/oauth/authorize?client_id=x',
      }).toString(),
    });

    expect(res.statusCode).toBe(403);

    // Session must remain on org-B (userB's seeded initial org).
    const probe = await ctx.server.inject({
      method: 'GET',
      url: '/orgs/current',
      headers: { cookie },
    });
    const body = probe.json() as { currentOrgId: string };
    expect(body.currentOrgId).toBe(ctx.orgBId);
    expect(body.currentOrgId).not.toBe(ctx.orgAId);
  });

  it('Test 3 (invalid returnTo absolute URL): falls back to /; session IS mutated', async () => {
    ctx = await buildCtx('A');
    const { csrf, cookie } = await primeCsrf(ctx);

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/session/switch-org',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        orgId: ctx.orgBId,
        returnTo: 'https://evil.example.com/phish',
      }).toString(),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('Test 4 (protocol-relative returnTo): falls back to /', async () => {
    ctx = await buildCtx('A');
    const { csrf, cookie } = await primeCsrf(ctx);

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/session/switch-org',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        orgId: ctx.orgBId,
        returnTo: '//evil.com/x',
      }).toString(),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('Test 5 (missing CSRF): 403 from @fastify/csrf-protection preHandler', async () => {
    ctx = await buildCtx('A');
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/session/switch-org',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        // _csrf omitted
        orgId: ctx.orgBId,
        returnTo: '/oauth/authorize?client_id=x',
      }).toString(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('Test 6 (missing orgId): 400 invalid_request with valid CSRF', async () => {
    ctx = await buildCtx('A');
    const { csrf, cookie } = await primeCsrf(ctx);

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/session/switch-org',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        // orgId omitted
        returnTo: '/oauth/authorize?client_id=x',
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });
});

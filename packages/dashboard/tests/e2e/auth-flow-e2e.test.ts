import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { loadRegistry } from '../../src/plugins/registry.js';
import { registerSession } from '../../src/auth/session.js';
import { createAuthGuard } from '../../src/auth/middleware.js';
import { resolveEffectivePermissions } from '../../src/permissions.js';
import { storeApiKey } from '../../src/auth/api-key.js';
import { authRoutes } from '../../src/routes/auth.js';
import { homeRoutes } from '../../src/routes/home.js';
import { orgRoutes } from '../../src/routes/orgs.js';
import { pluginAdminRoutes } from '../../src/routes/admin/plugins.js';
import { pluginApiRoutes } from '../../src/routes/api/plugins.js';
import type { DashboardConfig } from '../../src/config.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const VALID_API_KEY = 'e2e-valid-key-12345678901234567890';
const INVALID_API_KEY = 'e2e-invalid-key-000000000000000000';

const PUBLIC_PATHS = new Set(['/login', '/health']);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/static/')) return true;
  if (path.startsWith('/auth/callback/')) return true;
  if (path.startsWith('/auth/sso/')) return true;
  return false;
}

interface E2EContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  authService: AuthService;
  cleanup: () => void;
}

async function createE2EServer(): Promise<E2EContext> {
  const dbPath = join(tmpdir(), `test-e2e-auth-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-e2e-auth-reports-${randomUUID()}`);
  const pluginsDir = join(tmpdir(), `test-e2e-auth-plugins-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });

  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: 'http://localhost:4000',
    webserviceUrl: 'http://localhost:3000',
    reportsDir,
    dbPath,
    sessionSecret: TEST_SESSION_SECRET,
    maxConcurrentScans: 2,
    complianceClientId: 'dashboard',
    complianceClientSecret: '',
  };

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const rawDb = storage.getRawDatabase();
  const registryEntries = await loadRegistry();
  const pluginManager = new PluginManager({
    db: rawDb,
    pluginsDir,
    encryptionKey: TEST_SESSION_SECRET,
    registryEntries,
  });
  const authService = new AuthService(rawDb, pluginManager, storage);

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Stub reply.view — returns JSON so tests can inspect template data
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // ── Global auth guard (mirrors server.ts) ──────────────────────────────
  const authGuard = createAuthGuard(authService);
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url.split('?')[0])) {
      return;
    }
    await authGuard(request, reply);
  });

  // ── Permission-loading hook (mirrors server.ts) ────────────────────────
  server.addHook('preHandler', async (request: FastifyRequest) => {
    if (request.user === undefined) return;

    const permissions = await resolveEffectivePermissions(
      storage.roles,
      request.user.id,
      request.user.role,
      request.user.currentOrgId,
    );
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  // ── Routes ─────────────────────────────────────────────────────────────
  await authRoutes(server, config, authService, storage);
  await homeRoutes(server, storage, config);
  await orgRoutes(server, storage);
  await pluginAdminRoutes(server, pluginManager, registryEntries, storage);
  await pluginApiRoutes(server, pluginManager);

  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, authService, cleanup };
}

describe('Auth Flow E2E', () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EServer();

    // Seed a valid API key
    const rawDb = ctx.storage.getRawDatabase();
    storeApiKey(rawDb, VALID_API_KEY, 'e2e-test-key');

    // Seed team-mode users
    await ctx.storage.users.createUser('admin-user', 'Admin123!', 'admin');
    await ctx.storage.users.createUser('viewer-user', 'Viewer123!', 'executive');
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  function getSessionCookie(response: { cookies: Array<{ name: string; value: string }> }): string | undefined {
    const cookie = response.cookies.find((c) => c.name === 'session');
    return cookie?.value;
  }

  async function loginWithApiKey(key = VALID_API_KEY): Promise<string | undefined> {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/login',
      payload: { apiKey: key },
    });
    return getSessionCookie(response);
  }

  async function loginWithPassword(username: string, password: string): Promise<string | undefined> {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/login',
      payload: { username, password },
    });
    return getSessionCookie(response);
  }

  // ── 1. Unauthenticated access redirects to login ──────────────────────

  describe('unauthenticated access', () => {
    it('GET /home without auth redirects to /login', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      expect(response.statusCode).toBe(302);
      // Phase 31.1 Plan 02 added returnTo preservation for GET redirects so the
      // user lands back on the original page after login.
      expect(response.headers['location']).toBe('/login?returnTo=%2Fhome');
    });
  });

  // ── 2. Login page renders ─────────────────────────────────────────────

  describe('login page', () => {
    it('GET /login returns 200', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/login',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('login.hbs');
    });
  });

  // ── 3. API key login ──────────────────────────────────────────────────

  describe('API key login', () => {
    it('POST /login with valid API key succeeds (302 to /)', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { apiKey: VALID_API_KEY },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
      expect(getSessionCookie(response)).toBeDefined();
    });

    it('authenticated session can access protected route', async () => {
      const sessionCookie = await loginWithApiKey();
      expect(sessionCookie).toBeDefined();

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
        cookies: { session: sessionCookie! },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ── 4. Invalid API key rejected ───────────────────────────────────────

  describe('invalid API key', () => {
    it('POST /login with wrong key returns login page with error', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { apiKey: INVALID_API_KEY },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.template).toBe('login.hbs');
      expect(body.data.error).toBe('Invalid API key.');
    });
  });

  // ── 5. Permission checks ──────────────────────────────────────────────

  describe('permission checks', () => {
    it('admin routes require admin permission (GET /admin/plugins)', async () => {
      const sessionCookie = await loginWithPassword('viewer-user', 'Viewer123!');
      expect(sessionCookie).toBeDefined();

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/plugins',
        cookies: { session: sessionCookie! },
      });

      expect(response.statusCode).toBe(403);
    });

    it('admin user can access admin routes', async () => {
      const sessionCookie = await loginWithPassword('admin-user', 'Admin123!');
      expect(sessionCookie).toBeDefined();

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/plugins',
        cookies: { session: sessionCookie! },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ── 6. Org context ────────────────────────────────────────────────────

  describe('org context', () => {
    it('POST /orgs/switch changes org context', async () => {
      const sessionCookie = await loginWithPassword('admin-user', 'Admin123!');
      expect(sessionCookie).toBeDefined();

      const adminUser = await ctx.storage.users.getUserByUsername('admin-user');
      expect(adminUser).not.toBeNull();
      const org = await ctx.storage.organizations.createOrg({ name: 'TestOrg', slug: 'test-org' });
      await ctx.storage.organizations.addMember(org.id, adminUser!.id, 'admin');

      const switchResponse = await ctx.server.inject({
        method: 'POST',
        url: '/orgs/switch',
        payload: `orgId=${org.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        cookies: { session: sessionCookie! },
      });

      expect(switchResponse.statusCode).toBe(302);

      const newSessionCookie = getSessionCookie(switchResponse) ?? sessionCookie!;
      const currentResponse = await ctx.server.inject({
        method: 'GET',
        url: '/orgs/current',
        cookies: { session: newSessionCookie },
      });

      expect(currentResponse.statusCode).toBe(200);
      const body = currentResponse.json() as { currentOrgId: string };
      expect(body.currentOrgId).toBe(org.id);
    });

    it('POST /orgs/switch rejects org user does not belong to', async () => {
      const sessionCookie = await loginWithPassword('admin-user', 'Admin123!');
      expect(sessionCookie).toBeDefined();

      const foreignOrg = await ctx.storage.organizations.createOrg({ name: 'ForeignOrg', slug: 'foreign-org' });

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/orgs/switch',
        payload: `orgId=${foreignOrg.id}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        cookies: { session: sessionCookie! },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ── 7. Role-based access ──────────────────────────────────────────────

  describe('role-based access', () => {
    it('viewer/executive role cannot access admin routes', async () => {
      const sessionCookie = await loginWithPassword('viewer-user', 'Viewer123!');
      expect(sessionCookie).toBeDefined();

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/plugins',
        cookies: { session: sessionCookie! },
      });

      expect(response.statusCode).toBe(403);
    });

    it('admin role can access admin routes', async () => {
      const sessionCookie = await loginWithPassword('admin-user', 'Admin123!');
      expect(sessionCookie).toBeDefined();

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/plugins',
        cookies: { session: sessionCookie! },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ── 8. Logout ─────────────────────────────────────────────────────────

  describe('logout', () => {
    it('POST /logout clears session and redirects to /login', async () => {
      const sessionCookie = await loginWithApiKey();
      expect(sessionCookie).toBeDefined();

      const logoutResponse = await ctx.server.inject({
        method: 'POST',
        url: '/logout',
        cookies: { session: sessionCookie! },
      });

      expect(logoutResponse.statusCode).toBe(302);
      expect(logoutResponse.headers['location']).toBe('/login');
    });

    it('session is invalid after logout', async () => {
      const sessionCookie = await loginWithApiKey();
      expect(sessionCookie).toBeDefined();

      const logoutResponse = await ctx.server.inject({
        method: 'POST',
        url: '/logout',
        cookies: { session: sessionCookie! },
      });

      const postLogoutCookie = getSessionCookie(logoutResponse) ?? sessionCookie!;
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
        cookies: { session: postLogoutCookie },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/login?returnTo=%2Fhome');
    });
  });
});

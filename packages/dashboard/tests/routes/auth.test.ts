import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { authRoutes } from '../../src/routes/auth.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { loadRegistry } from '../../src/plugins/registry.js';
import { storeApiKey } from '../../src/auth/api-key.js';
import type { DashboardConfig } from '../../src/config.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  config: DashboardConfig;
  authService: AuthService;
  cleanup: () => void;
}

async function createTestServer(opts?: { complianceUrl?: string }): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-auth-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-auth-reports-${randomUUID()}`);
  const pluginsDir = join(tmpdir(), `test-auth-plugins-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });

  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: opts?.complianceUrl ?? 'http://localhost:4000',
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
  const registryEntries = loadRegistry();
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

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  await authRoutes(server, config, authService, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, config, authService, cleanup };
}

// Helper: create a user via storage adapter for team-mode tests
async function createUser(storage: SqliteStorageAdapter, username: string, password: string, role = 'user'): Promise<string> {
  const user = await storage.users.createUser(username, password, role);
  return user.id;
}


describe('Auth routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ── GET /login ──────────────────────────────────────────────────────────────

  describe('GET /login', () => {
    it('renders login page in solo mode', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/login' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { mode: string; loginMethods: unknown[] } };
      expect(body.template).toBe('login.hbs');
      expect(body.data.mode).toBe('solo');
      expect(body.data.loginMethods).toBeDefined();
    });

    it('renders login page in team mode when users exist', async () => {
      await createUser(ctx.storage, 'alice', 'Secret123!', 'admin');

      const response = await ctx.server.inject({ method: 'GET', url: '/login' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { mode: string } };
      expect(body.data.mode).toBe('team');
    });

    it('redirects to / when already authenticated', async () => {
      // Create an API key and log in to establish a session
      const rawDb = ctx.storage.getRawDatabase();
      storeApiKey(rawDb, 'valid-key-12345678901234567890', 'test-key');

      // Log in first
      const loginResponse = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { apiKey: 'valid-key-12345678901234567890' },
      });

      const cookies = loginResponse.cookies as Array<{ name: string; value: string }>;
      const sessionCookie = cookies.find((c) => c.name === 'sessionId');

      if (sessionCookie) {
        const response = await ctx.server.inject({
          method: 'GET',
          url: '/login',
          cookies: { sessionId: sessionCookie.value },
        });

        expect(response.statusCode).toBe(302);
        expect(response.headers['location']).toBe('/');
      }
    });
  });

  // ── POST /login — API key ─────────────────────────────────────────────────

  describe('POST /login — API key', () => {
    it('authenticates with valid API key', async () => {
      const rawDb = ctx.storage.getRawDatabase();
      storeApiKey(rawDb, 'valid-key-12345678901234567890', 'test-key');

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { apiKey: 'valid-key-12345678901234567890' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
    });

    it('rejects invalid API key', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { apiKey: 'invalid-key-000000000000' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.template).toBe('login.hbs');
      expect(body.data.error).toBe('Invalid API key.');
    });

    it('trims whitespace from API key', async () => {
      const rawDb = ctx.storage.getRawDatabase();
      storeApiKey(rawDb, 'valid-key-12345678901234567890', 'test-key');

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { apiKey: '  valid-key-12345678901234567890  ' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
    });

    it('ignores empty API key string', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { apiKey: '   ' },
      });

      // In solo mode with empty API key, should get "API key is required"
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.data.error).toBe('API key is required.');
    });
  });

  // ── POST /login — solo mode ───────────────────────────────────────────────

  describe('POST /login — solo mode', () => {
    it('requires API key in solo mode (no username/password)', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: 'admin', password: 'pass' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string; mode: string } };
      expect(body.data.error).toBe('API key is required.');
      expect(body.data.mode).toBe('solo');
    });
  });

  // ── POST /login — team mode (password) ────────────────────────────────────

  describe('POST /login — team mode (password)', () => {
    beforeEach(async () => {
      await createUser(ctx.storage, 'alice', 'Secret123!', 'admin');
    });

    it('requires username', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: '', password: 'Secret123!' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.data.error).toBe('Username is required.');
    });

    it('requires password', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: 'alice', password: '' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.data.error).toBe('Password is required.');
    });

    it('handles missing username field', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { password: 'Secret123!' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.data.error).toBe('Username is required.');
    });

    it('handles missing password field', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: 'alice' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.data.error).toBe('Password is required.');
    });

    it('authenticates with valid credentials', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: 'alice', password: 'Secret123!' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
    });

    it('rejects invalid password', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: 'alice', password: 'wrong-password' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.data.error).toBeDefined();
      expect(body.template).toBe('login.hbs');
    });

    it('rejects non-existent user', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: 'nobody', password: 'Secret123!' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.data.error).toBeDefined();
    });

    it('trims username whitespace', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: '  alice  ', password: 'Secret123!' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
    });
  });

  // ── GET /auth/sso/:pluginId ───────────────────────────────────────────────

  describe('GET /auth/sso/:pluginId', () => {
    it('returns 404 when no auth plugins are available', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/auth/sso/some-plugin',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toContain('not found');
    });
  });

  // ── GET /auth/callback/:pluginId ──────────────────────────────────────────

  describe('GET /auth/callback/:pluginId', () => {
    it('renders login with error when SSO callback fails', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/auth/callback/nonexistent',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { error: string } };
      expect(body.template).toBe('login.hbs');
      expect(body.data.error).toBeDefined();
    });
  });

  // ── GET /account ──────────────────────────────────────────────────────────

  describe('GET /account', () => {
    it('renders profile page', async () => {
      // We need a server with preHandler that sets request.user
      const ctx2 = await createAccountServer();

      const response = await ctx2.server.inject({
        method: 'GET',
        url: '/account',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { pageTitle: string; canChangePassword: boolean } };
      expect(body.template).toBe('account/profile.hbs');
      expect(body.data.pageTitle).toBe('My Profile');

      ctx2.cleanup();
    });

    it('sets canChangePassword=true when authMethod is password', async () => {
      const ctx2 = await createAccountServer('password');

      const response = await ctx2.server.inject({
        method: 'GET',
        url: '/account',
      });

      const body = response.json() as { template: string; data: { canChangePassword: boolean } };
      expect(body.data.canChangePassword).toBe(true);

      ctx2.cleanup();
    });

    it('sets canChangePassword=false when authMethod is api-key', async () => {
      const ctx2 = await createAccountServer('api-key');

      const response = await ctx2.server.inject({
        method: 'GET',
        url: '/account',
      });

      const body = response.json() as { template: string; data: { canChangePassword: boolean } };
      expect(body.data.canChangePassword).toBe(false);

      ctx2.cleanup();
    });

    it('includes localeSaved flag from query', async () => {
      const ctx2 = await createAccountServer();

      const response = await ctx2.server.inject({
        method: 'GET',
        url: '/account?localeSaved=1',
      });

      const body = response.json() as { template: string; data: { localeSaved: boolean } };
      expect(body.data.localeSaved).toBe(true);

      ctx2.cleanup();
    });
  });

  // ── POST /account/change-password ─────────────────────────────────────────

  describe('POST /account/change-password', () => {
    it('rejects when authMethod is not password', async () => {
      const ctx2 = await createAccountServer('api-key');

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { currentPassword: 'old', newPassword: 'New123!@#', confirmPassword: 'New123!@#' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { pwError: string } };
      expect(body.data.pwError).toContain('not available');

      ctx2.cleanup();
    });

    it('requires current password', async () => {
      const ctx2 = await createAccountServer('password');

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { newPassword: 'New123!@#', confirmPassword: 'New123!@#' },
      });

      const body = response.json() as { template: string; data: { pwError: string } };
      expect(body.data.pwError).toBe('Current password is required.');

      ctx2.cleanup();
    });

    it('requires new password', async () => {
      const ctx2 = await createAccountServer('password');

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { currentPassword: 'Secret123!' },
      });

      const body = response.json() as { template: string; data: { pwError: string } };
      expect(body.data.pwError).toBe('New password is required.');

      ctx2.cleanup();
    });

    it('validates password strength', async () => {
      const ctx2 = await createAccountServer('password');

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { currentPassword: 'Secret123!', newPassword: 'weak', confirmPassword: 'weak' },
      });

      const body = response.json() as { template: string; data: { pwError: string } };
      expect(body.data.pwError).toBeDefined();
      expect(body.data.pwError).not.toBe('');

      ctx2.cleanup();
    });

    it('requires passwords to match', async () => {
      const ctx2 = await createAccountServer('password');

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { currentPassword: 'Secret123!', newPassword: 'NewPass1!a', confirmPassword: 'Different1!a' },
      });

      const body = response.json() as { template: string; data: { pwError: string } };
      expect(body.data.pwError).toBe('New passwords do not match.');

      ctx2.cleanup();
    });

    it('verifies current password', async () => {
      const ctx2 = await createAccountServer('password');

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { currentPassword: 'WrongPass1!', newPassword: 'NewPass1!a', confirmPassword: 'NewPass1!a' },
      });

      const body = response.json() as { template: string; data: { pwError: string } };
      expect(body.data.pwError).toBe('Current password is incorrect.');

      ctx2.cleanup();
    });

    it('changes password successfully', async () => {
      const ctx2 = await createAccountServer('password');

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { currentPassword: 'Secret123!', newPassword: 'NewPass1!a', confirmPassword: 'NewPass1!a' },
      });

      const body = response.json() as { template: string; data: { pwSuccess: string } };
      expect(body.data.pwSuccess).toBe('Password changed successfully.');

      ctx2.cleanup();
    });

    it('handles updatePassword error', async () => {
      const ctx2 = await createAccountServer('password');
      vi.spyOn(ctx2.storage.users, 'updatePassword').mockRejectedValueOnce(new Error('DB error'));

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { currentPassword: 'Secret123!', newPassword: 'NewPass1!a', confirmPassword: 'NewPass1!a' },
      });

      const body = response.json() as { template: string; data: { pwError: string } };
      expect(body.data.pwError).toBe('DB error');

      ctx2.cleanup();
      vi.restoreAllMocks();
    });

    it('redirects to login when user is missing', async () => {
      const ctx2 = await createAccountServer('password', { noUser: true });

      const response = await ctx2.server.inject({
        method: 'POST',
        url: '/account/change-password',
        payload: { currentPassword: 'Secret123!', newPassword: 'NewPass1!a', confirmPassword: 'NewPass1!a' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/login');

      ctx2.cleanup();
    });
  });

  // ── POST /account/locale ──────────────────────────────────────────────────

  describe('POST /account/locale', () => {
    it('sets locale and redirects to profile when _from=profile', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/locale',
        payload: { locale: 'it', _from: 'profile' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/account?localeSaved=1');
    });

    it('redirects to referer when not from profile', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/locale',
        payload: { locale: 'fr' },
        headers: { referer: 'http://localhost:5000/some-page?q=1', host: 'localhost:5000' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/some-page?q=1');
    });

    it('redirects to / when referer is from different host', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/locale',
        payload: { locale: 'es' },
        headers: { referer: 'http://evil.com/steal', host: 'localhost:5000' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
    });

    it('redirects to / when referer is invalid URL', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/locale',
        payload: { locale: 'de' },
        headers: { referer: 'not-a-url' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
    });

    it('redirects to / when no referer', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/locale',
        payload: { locale: 'en' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/');
    });

    it('ignores unsupported locale', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/locale',
        payload: { locale: 'xx' },
      });

      expect(response.statusCode).toBe(302);
    });
  });

  // ── POST /logout ──────────────────────────────────────────────────────────

  describe('POST /logout', () => {
    it('clears session and redirects to /login', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/logout',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/login');
    });
  });
});

// ---------------------------------------------------------------------------
// Helper: lightweight server for /account routes (needs request.user)
// ---------------------------------------------------------------------------

async function createAccountServer(
  authMethod = 'api-key',
  opts?: { noUser?: boolean },
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-auth-acct-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-auth-acct-reports-${randomUUID()}`);
  const pluginsDir = join(tmpdir(), `test-auth-acct-plugins-${randomUUID()}`);
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

  // Create a real user for password verification
  const user = await storage.users.createUser('testuser', 'Secret123!', 'admin');
  const userId = user.id;

  const rawDb = storage.getRawDatabase();
  const registryEntries = loadRegistry();
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

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // Simulate authenticated session via preHandler
  server.addHook('preHandler', async (request) => {
    if (!opts?.noUser) {
      request.user = { id: userId, username: 'testuser', role: 'admin' };
    }
    // Set authMethod in the actual session
    const session = request.session as { set(k: string, v: unknown): void };
    session.set('authMethod', authMethod);
  });

  await authRoutes(server, config, authService, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, config, authService, cleanup };
}

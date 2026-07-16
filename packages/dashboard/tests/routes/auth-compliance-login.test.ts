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
import type { DashboardConfig } from '../../src/config.js';

// Users created via /admin/users live in the COMPLIANCE service, so /login
// must attempt the compliance OAuth password grant whenever complianceUrl is
// configured — including the default http://localhost:4000, which is exactly
// what live runs. The old code special-cased that URL and locked those users out.
vi.mock('../../src/compliance-client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/compliance-client.js')>();
  return {
    ...original,
    getToken: vi.fn(async (_baseUrl: string, username: string, password: string) => {
      if (username === 'compliance-bob' && password === 'BobPass1!') {
        const payload = Buffer.from(
          JSON.stringify({ sub: 'bob-id-1', role: 'user', username: 'compliance-bob' }),
        ).toString('base64url');
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
        return { access_token: `${header}.${payload}.sig`, token_type: 'Bearer', expires_in: 3600 };
      }
      throw new Error('Authentication failed: invalid credentials');
    }),
  };
});

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-auth-cl-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-auth-cl-reports-${randomUUID()}`);
  const pluginsDir = join(tmpdir(), `test-auth-cl-plugins-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });

  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: 'http://localhost:4000', // the default — must NOT disable compliance OAuth
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
  const pluginManager = new PluginManager({
    db: rawDb,
    pluginsDir,
    encryptionKey: TEST_SESSION_SECRET,
    registryEntries: loadRegistry(),
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

  return { server, storage, cleanup };
}

describe('POST /login — compliance-created users (team mode, default complianceUrl)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
    // A local user flips the auth mode to team.
    await ctx.storage.users.createUser('alice', 'Secret123!', 'admin');
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('authenticates a compliance-service user that has no local dashboard_users row', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/login',
      payload: { username: 'compliance-bob', password: 'BobPass1!' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('/');
  });

  it('still authenticates a local-only user via fall-through when compliance rejects them', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/login',
      payload: { username: 'alice', password: 'Secret123!' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('/');
  });

  it('rejects credentials that neither compliance nor the local store accept', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/login',
      payload: { username: 'compliance-bob', password: 'wrong' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string; data: { error: string } };
    expect(body.template).toBe('login.hbs');
    expect(body.data.error).toBeDefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../../src/db/migrations.js';
import { DASHBOARD_MIGRATIONS } from '../../src/db/scans.js';
import { registerSession } from '../../src/auth/session.js';
import { pluginAdminRoutes } from '../../src/routes/admin/plugins.js';
import { PluginManager } from '../../src/plugins/manager.js';
import type { RegistryEntry } from '../../src/plugins/types.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

const SAMPLE_REGISTRY: readonly RegistryEntry[] = [
  {
    name: 'notify-slack',
    displayName: 'Slack Notifications',
    type: 'notification',
    version: '1.0.0',
    description: 'Send alerts to Slack',
    packageName: '@luqen/plugin-notify-slack',
    icon: 'slack',
  },
  {
    name: 'auth-entra',
    displayName: 'Azure Entra ID',
    type: 'auth',
    version: '1.0.0',
    description: 'SSO via Azure Entra ID',
    packageName: '@luqen/plugin-auth-entra',
    icon: 'entra',
  },
];

interface TestContext {
  server: FastifyInstance;
  db: Database.Database;
  pluginManager: PluginManager;
  cleanup: () => void;
  dbPath: string;
  pluginsDir: string;
}

async function createTestServer(role: string = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-plugins-${randomUUID()}.db`);
  const pluginsDir = join(tmpdir(), `test-pluginsdir-${randomUUID()}`);
  mkdirSync(pluginsDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new MigrationRunner(db).run([...DASHBOARD_MIGRATIONS]);

  const pluginManager = new PluginManager({
    db,
    pluginsDir,
    encryptionKey: TEST_SESSION_SECRET,
    registryEntries: SAMPLE_REGISTRY,
  });

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testuser', role };
  });

  await pluginAdminRoutes(server, pluginManager, SAMPLE_REGISTRY);
  await server.ready();

  const cleanup = (): void => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, db, pluginManager, cleanup, dbPath, pluginsDir };
}

// ── GET /admin/plugins ─────────────────────────────────────────────────────

describe('GET /admin/plugins', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 200 with plugins template', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/plugins.hbs');
  });

  it('includes counts in template data', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    const body = response.json() as {
      data: {
        counts: { installed: number; active: number; available: number };
        installed: unknown[];
        available: unknown[];
      };
    };
    expect(body.data.counts.installed).toBe(0);
    expect(body.data.counts.active).toBe(0);
    expect(body.data.counts.available).toBe(2);
    expect(body.data.available).toHaveLength(2);
  });

  it('shows installed plugins and reduces available count', async () => {
    // Insert a plugin directly into DB
    ctx.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      )
      .run({
        id: 'test-plugin-1',
        package_name: '@luqen/plugin-notify-slack',
        type: 'notification',
        version: '1.0.0',
        config: '{}',
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    const body = response.json() as {
      data: {
        counts: { installed: number; active: number; available: number };
        installed: Array<{ packageName: string }>;
        available: Array<{ packageName: string }>;
      };
    };
    expect(body.data.counts.installed).toBe(1);
    expect(body.data.counts.available).toBe(1);
    expect(body.data.installed[0].packageName).toBe('@luqen/plugin-notify-slack');
  });
});

// ── Access control ──────────────────────────────────────────────────────────

describe('GET /admin/plugins requires admin role', () => {
  it('non-admin (viewer role) gets 403', async () => {
    const ctx = await createTestServer('viewer');

    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('non-admin (user role) gets 403', async () => {
    const ctx = await createTestServer('user');

    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });
});

// ── POST /admin/plugins/install ─────────────────────────────────────────────

describe('POST /admin/plugins/install', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 400 when packageName is missing', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/install',
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Missing packageName');
  });
});

// ── POST /admin/plugins/:id/activate ────────────────────────────────────────

describe('POST /admin/plugins/:id/activate', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 500 for non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/nonexistent/activate',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('not found');
  });
});

// ── POST /admin/plugins/:id/deactivate ──────────────────────────────────────

describe('POST /admin/plugins/:id/deactivate', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 500 for non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/nonexistent/deactivate',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('not found');
  });
});

// ── DELETE /admin/plugins/:id ───────────────────────────────────────────────

describe('DELETE /admin/plugins/:id', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 500 for non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'DELETE',
      url: '/admin/plugins/nonexistent',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('not found');
  });

  it('removes an installed plugin', async () => {
    ctx.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      )
      .run({
        id: 'del-plugin-1',
        package_name: '@luqen/plugin-notify-slack',
        type: 'notification',
        version: '1.0.0',
        config: '{}',
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

    const response = await ctx.server.inject({
      method: 'DELETE',
      url: '/admin/plugins/del-plugin-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('removed successfully');

    // Verify it's gone from DB
    const row = ctx.db
      .prepare('SELECT * FROM plugins WHERE id = ?')
      .get('del-plugin-1');
    expect(row).toBeUndefined();
  });
});

// ── GET /admin/plugins/:id/configure ────────────────────────────────────────

describe('GET /admin/plugins/:id/configure', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 404 for non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins/nonexistent/configure',
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('Plugin not found');
  });

  it('returns config form for installed plugin', async () => {
    ctx.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      )
      .run({
        id: 'cfg-plugin-1',
        package_name: '@luqen/plugin-notify-slack',
        type: 'notification',
        version: '1.0.0',
        config: '{}',
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins/cfg-plugin-1/configure',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Configure');
  });
});

// ── PATCH /admin/plugins/:id/config ─────────────────────────────────────────

describe('PATCH /admin/plugins/:id/config', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 500 for non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: '/admin/plugins/nonexistent/config',
      payload: 'key=value',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('not found');
  });
});

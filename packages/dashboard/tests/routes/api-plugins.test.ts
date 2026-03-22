import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { ScanDb } from '../../src/db/scans.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { pluginApiRoutes } from '../../src/routes/api/plugins.js';
import { registerSession } from '../../src/auth/session.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import type { RegistryEntry } from '../../src/plugins/types.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

const MOCK_REGISTRY: readonly RegistryEntry[] = [
  {
    name: 'slack-notifier',
    displayName: 'Slack Notifier',
    type: 'notification',
    version: '1.0.0',
    description: 'Send notifications to Slack',
    packageName: '@luqen/plugin-slack',
    icon: 'slack',
  },
  {
    name: 'azure-ad',
    displayName: 'Azure AD',
    type: 'auth',
    version: '1.0.0',
    description: 'Azure AD authentication',
    packageName: '@luqen/plugin-azure-ad',
    icon: 'azure',
  },
];

interface TestContext {
  readonly server: FastifyInstance;
  readonly db: ScanDb;
  readonly pluginManager: PluginManager;
  readonly dbPath: string;
  readonly cleanup: () => void;
}

async function createTestServer(role: string = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-api-plugins-${randomUUID()}.db`);

  const db = new ScanDb(dbPath);
  db.initialize();

  const pluginManager = new PluginManager({
    db: db.getDatabase(),
    pluginsDir: join(tmpdir(), `test-plugins-${randomUUID()}`),
    encryptionKey: TEST_SESSION_SECRET,
    registryEntries: MOCK_REGISTRY,
  });

  // Stub exec so npm install doesn't actually run
  pluginManager._setExecFile(vi.fn().mockResolvedValue({ stdout: '', stderr: '' }));

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Inject user role into all requests (bypass real JWT)
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testuser', role };
    const permissions = role === 'admin'
      ? new Set(ALL_PERMISSION_IDS)
      : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await pluginApiRoutes(server, pluginManager);
  await server.ready();

  const cleanup = (): void => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, db, pluginManager, dbPath, cleanup };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a plugin row directly into DB for testing. */
function insertPlugin(
  db: ScanDb,
  overrides: Partial<{
    id: string;
    package_name: string;
    type: string;
    version: string;
    config: string;
    status: string;
    installed_at: string;
  }> = {},
): string {
  const id = overrides.id ?? randomUUID();
  db.getDatabase()
    .prepare(
      `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
       VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
    )
    .run({
      id,
      package_name: overrides.package_name ?? '@luqen/plugin-slack',
      type: overrides.type ?? 'notification',
      version: overrides.version ?? '1.0.0',
      config: overrides.config ?? '{}',
      status: overrides.status ?? 'inactive',
      installed_at: overrides.installed_at ?? new Date().toISOString(),
    });
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plugin API routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer('admin');
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ── GET /api/v1/plugins ─────────────────────────────────────────────────
  describe('GET /api/v1/plugins', () => {
    it('returns empty array when no plugins installed', async () => {
      const res = await ctx.server.inject({ method: 'GET', url: '/api/v1/plugins' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns installed plugins', async () => {
      const id = insertPlugin(ctx.db);
      const res = await ctx.server.inject({ method: 'GET', url: '/api/v1/plugins' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(id);
      expect(body[0].packageName).toBe('@luqen/plugin-slack');
    });
  });

  // ── GET /api/v1/plugins/registry ────────────────────────────────────────
  describe('GET /api/v1/plugins/registry', () => {
    it('returns available plugins with installed flag', async () => {
      insertPlugin(ctx.db, { package_name: '@luqen/plugin-slack' });

      const res = await ctx.server.inject({ method: 'GET', url: '/api/v1/plugins/registry' });
      expect(res.statusCode).toBe(200);

      const body = res.json() as Array<{ packageName: string; installed: boolean }>;
      expect(body).toHaveLength(2);

      const slack = body.find((e) => e.packageName === '@luqen/plugin-slack');
      const azure = body.find((e) => e.packageName === '@luqen/plugin-azure-ad');
      expect(slack?.installed).toBe(true);
      expect(azure?.installed).toBe(false);
    });
  });

  // ── POST /api/v1/plugins/install ────────────────────────────────────────
  describe('POST /api/v1/plugins/install', () => {
    it('returns 400 when packageName is missing', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/v1/plugins/install',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('packageName is required');
    });

    it('returns 400 for unknown package', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/v1/plugins/install',
        payload: { packageName: '@unknown/pkg' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('not found in registry');
    });

    it('returns 500 when npm install fails', async () => {
      ctx.pluginManager._setExecFile(
        vi.fn().mockRejectedValue(new Error('npm install failed')),
      );

      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/v1/plugins/install',
        payload: { packageName: '@luqen/plugin-slack' },
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain('Install failed');
    });
  });

  // ── PATCH /api/v1/plugins/:id/config ────────────────────────────────────
  describe('PATCH /api/v1/plugins/:id/config', () => {
    it('returns 404 for nonexistent plugin', async () => {
      const res = await ctx.server.inject({
        method: 'PATCH',
        url: '/api/v1/plugins/nonexistent-id/config',
        payload: { config: { key: 'value' } },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when config is missing', async () => {
      const id = insertPlugin(ctx.db);
      const res = await ctx.server.inject({
        method: 'PATCH',
        url: `/api/v1/plugins/${id}/config`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('config object is required');
    });
  });

  // ── POST /api/v1/plugins/:id/activate ───────────────────────────────────
  describe('POST /api/v1/plugins/:id/activate', () => {
    it('returns 404 for nonexistent plugin', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/v1/plugins/nonexistent-id/activate',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/plugins/:id/deactivate ─────────────────────────────────
  describe('POST /api/v1/plugins/:id/deactivate', () => {
    it('returns 404 for nonexistent plugin', async () => {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/api/v1/plugins/nonexistent-id/deactivate',
      });
      expect(res.statusCode).toBe(404);
    });

    it('deactivates an installed plugin', async () => {
      const id = insertPlugin(ctx.db, { status: 'active' });
      const res = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/plugins/${id}/deactivate`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('inactive');
    });
  });

  // ── DELETE /api/v1/plugins/:id ──────────────────────────────────────────
  describe('DELETE /api/v1/plugins/:id', () => {
    it('returns 404 for nonexistent plugin', async () => {
      const res = await ctx.server.inject({
        method: 'DELETE',
        url: '/api/v1/plugins/nonexistent-id',
      });
      expect(res.statusCode).toBe(404);
    });

    it('removes an installed plugin', async () => {
      const id = insertPlugin(ctx.db);
      const res = await ctx.server.inject({
        method: 'DELETE',
        url: `/api/v1/plugins/${id}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const listRes = await ctx.server.inject({ method: 'GET', url: '/api/v1/plugins' });
      expect(listRes.json()).toEqual([]);
    });
  });

  // ── GET /api/v1/plugins/:id/health ──────────────────────────────────────
  describe('GET /api/v1/plugins/:id/health', () => {
    it('returns 404 for nonexistent plugin', async () => {
      const res = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/plugins/nonexistent-id/health',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns health status for installed plugin', async () => {
      const id = insertPlugin(ctx.db, { status: 'inactive' });
      const res = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/plugins/${id}/health`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: false, message: 'Plugin not active' });
    });

    it('returns ok:true for active plugin with passing health check', async () => {
      const id = insertPlugin(ctx.db, { status: 'active' });

      const mockInstance = {
        manifest: {
          name: 'test',
          displayName: 'Test',
          type: 'notification' as const,
          version: '1.0.0',
          description: 'test',
          configSchema: [],
        },
        activate: vi.fn(),
        deactivate: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
      };
      ctx.pluginManager._setActiveInstance(id, mockInstance);

      const res = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/plugins/${id}/health`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });
});

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

describe('Plugin API access control', () => {
  it('returns 403 for non-admin users on all endpoints', async () => {
    const ctx = await createTestServer('viewer');

    try {
      const endpoints = [
        { method: 'GET' as const, url: '/api/v1/plugins' },
        { method: 'GET' as const, url: '/api/v1/plugins/registry' },
        { method: 'POST' as const, url: '/api/v1/plugins/install' },
        { method: 'PATCH' as const, url: '/api/v1/plugins/some-id/config' },
        { method: 'POST' as const, url: '/api/v1/plugins/some-id/activate' },
        { method: 'POST' as const, url: '/api/v1/plugins/some-id/deactivate' },
        { method: 'DELETE' as const, url: '/api/v1/plugins/some-id' },
        { method: 'GET' as const, url: '/api/v1/plugins/some-id/health' },
      ];

      for (const { method, url } of endpoints) {
        const res = await ctx.server.inject({ method, url });
        expect(res.statusCode).toBe(403);
      }
    } finally {
      ctx.cleanup();
    }
  });
});

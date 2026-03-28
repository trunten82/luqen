/**
 * E2E Test — Plugin Admin Flow
 *
 * Tests the full plugin lifecycle via HTTP requests to the Fastify test server:
 * list -> install -> activate -> configure -> activate-for-org -> deactivate ->
 * remove (with cascade) -> verify reappears in catalogue.
 *
 * Uses a mock download function to avoid real HTTP downloads. Auth is injected
 * via a preHandler hook that sets request.user and permissions.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { pluginAdminRoutes } from '../../src/routes/admin/plugins.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import type { RegistryEntry, PluginManifest, PluginInstance } from '../../src/plugins/types.js';

// Mock tar to avoid needing real tarballs — the mock download function
// writes the extracted files directly, so tar.extract is a no-op.
vi.mock('tar', () => ({
  default: { extract: vi.fn().mockResolvedValue(undefined) },
  extract: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const TEST_ORG_ID = 'org-test-001';

const SCANNER_MANIFEST: PluginManifest = {
  name: 'test-scanner',
  displayName: 'Test Scanner Plugin',
  type: 'scanner',
  version: '1.0.0',
  description: 'A test scanner plugin for E2E testing',
  configSchema: [
    { key: 'apiUrl', label: 'API URL', type: 'string', required: true },
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
  ],
  autoDeactivateOnFailure: true,
};

const NOTIFY_MANIFEST: PluginManifest = {
  name: 'test-notify',
  displayName: 'Test Notification Plugin',
  type: 'notification',
  version: '2.0.0',
  description: 'A test notification plugin for E2E testing',
  configSchema: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'string', required: true },
  ],
};

const TEST_REGISTRY: readonly RegistryEntry[] = [
  {
    name: 'test-scanner',
    displayName: 'Test Scanner Plugin',
    type: 'scanner',
    version: '1.0.0',
    description: 'A test scanner plugin',
    packageName: '@luqen/plugin-test-scanner',
    downloadUrl: 'https://example.com/plugin-test-scanner-1.0.0.tgz',
  },
  {
    name: 'test-notify',
    displayName: 'Test Notification Plugin',
    type: 'notification',
    version: '2.0.0',
    description: 'A test notification plugin',
    packageName: '@luqen/plugin-test-notify',
    downloadUrl: 'https://example.com/plugin-test-notify-2.0.0.tgz',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  pluginManager: PluginManager;
  pluginsDir: string;
  cleanup: () => void;
}

function createMockPluginInstance(manifest: PluginManifest): PluginInstance {
  return {
    manifest,
    activate: async () => {},
    deactivate: async () => {},
    healthCheck: async () => true,
  };
}

/**
 * Set up the mock download function that writes manifest.json and package.json
 * into the expected directory structure instead of downloading a real tarball.
 */
function setupMockDownload(
  pluginManager: PluginManager,
  pluginsDir: string,
  manifest: PluginManifest,
  packageName: string,
): void {
  const pluginName = packageName.split('/').pop()!.replace(/^plugin-/, '');

  pluginManager._setDownloadFn(async (_url: string, destPath: string) => {
    // Write a dummy tarball file (the download function writes to destPath)
    writeFileSync(destPath, 'dummy-tarball');
    // Create the plugin directory with manifest and package.json
    const pkgDir = join(pluginsDir, 'packages', pluginName);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: packageName, main: 'index.js' }),
    );
  });
}

async function createTestServerForE2E(): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-e2e-plugins-${randomUUID()}.db`);
  const pluginsDir = join(tmpdir(), `test-e2e-pluginsdir-${randomUUID()}`);
  mkdirSync(pluginsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const db = storage.getRawDatabase();

  const pluginManager = new PluginManager({
    db,
    pluginsDir,
    encryptionKey: TEST_SESSION_SECRET,
    registryEntries: TEST_REGISTRY,
  });

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Replace reply.view with a JSON stub so tests can inspect template data
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  // Inject admin auth on every request
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testadmin', role: 'admin' };
    (request as unknown as Record<string, unknown>)['permissions'] =
      new Set(ALL_PERMISSION_IDS);
  });

  await pluginAdminRoutes(server, pluginManager, TEST_REGISTRY, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, pluginManager, pluginsDir, cleanup };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Plugin Admin E2E — full lifecycle via HTTP', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestServerForE2E();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  // Track the plugin ID across sequential lifecycle steps
  let installedPluginId: string;

  // ── 1. List available plugins ───────────────────────────────────────────

  it('1. GET /admin/plugins — shows all registry plugins as available', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      template: string;
      data: {
        counts: { installed: number; active: number; available: number };
        available: Array<{ packageName: string }>;
        installed: unknown[];
      };
    }>();

    expect(body.template).toBe('admin/plugins.hbs');
    expect(body.data.counts.installed).toBe(0);
    expect(body.data.counts.active).toBe(0);
    expect(body.data.counts.available).toBe(2);
    expect(body.data.available).toHaveLength(2);

    const availableNames = body.data.available.map((a) => a.packageName);
    expect(availableNames).toContain('@luqen/plugin-test-scanner');
    expect(availableNames).toContain('@luqen/plugin-test-notify');
  });

  // ── 2. Install a plugin ─────────────────────────────────────────────────

  it('2. POST /admin/plugins/install — installs the scanner plugin', async () => {
    setupMockDownload(ctx.pluginManager, ctx.pluginsDir, SCANNER_MANIFEST, '@luqen/plugin-test-scanner');

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/install',
      payload: 'packageName=%40luqen%2Fplugin-test-scanner',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('installed successfully');
    expect(response.body).toContain('scanner');
    expect(response.headers['hx-trigger']).toBe('pluginChanged');

    // Verify the plugin now appears in the installed list
    const installed = ctx.pluginManager.list();
    expect(installed).toHaveLength(1);
    expect(installed[0].packageName).toBe('@luqen/plugin-test-scanner');
    expect(installed[0].status).toBe('inactive');
    installedPluginId = installed[0].id;
  });

  // ── 3. Activate ─────────────────────────────────────────────────────────

  it('3. POST /admin/plugins/:id/activate — activates the plugin', async () => {
    // Set up a mock loader so activation can load the plugin code
    ctx.pluginManager._setLoader(async () => createMockPluginInstance(SCANNER_MANIFEST));

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/plugins/${installedPluginId}/activate`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('activated');
    expect(response.headers['hx-trigger']).toBe('pluginChanged');

    // Verify status in manager
    const plugin = ctx.pluginManager.getPlugin(installedPluginId);
    expect(plugin).not.toBeNull();
    expect(plugin!.status).toBe('active');
    expect(plugin!.activatedAt).toBeTruthy();
  });

  // ── 4. Configure ────────────────────────────────────────────────────────

  it('4a. GET /admin/plugins/:id/configure — returns config form HTML', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${installedPluginId}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Configure');
    expect(response.body).toContain('API URL');
    expect(response.body).toContain('API Key');
    expect(response.body).toContain('type="text"');
    expect(response.body).toContain('type="password"');
  });

  it('4b. PATCH /admin/plugins/:id/config — saves configuration', async () => {
    // Re-set the loader since configure may try to reload an active plugin
    ctx.pluginManager._setLoader(async () => createMockPluginInstance(SCANNER_MANIFEST));

    const response = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/plugins/${installedPluginId}/config`,
      payload: 'apiUrl=https%3A%2F%2Fscanner.example.com&apiKey=secret-key-123',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Configuration saved');
    expect(response.headers['hx-trigger']).toBe('pluginChanged');
  });

  // ── 5. Activate for org ─────────────────────────────────────────────────

  it('5. POST /admin/plugins/:id/activate-for-org — activates for a specific org', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/plugins/${installedPluginId}/activate-for-org`,
      payload: `orgId=${TEST_ORG_ID}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('activated for');
    expect(response.body).toContain('1 organization');
    expect(response.headers['hx-trigger']).toBe('pluginChanged');

    // Verify org-specific copy was created
    const allPlugins = ctx.pluginManager.list();
    const orgCopy = allPlugins.find(
      (p) => p.orgId === TEST_ORG_ID && p.packageName === '@luqen/plugin-test-scanner',
    );
    expect(orgCopy).toBeDefined();
    expect(orgCopy!.status).toBe('active');
  });

  // ── 6. Deactivate ──────────────────────────────────────────────────────

  it('6. POST /admin/plugins/:id/deactivate — deactivates the global plugin', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/plugins/${installedPluginId}/deactivate`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('deactivated');
    expect(response.headers['hx-trigger']).toBe('pluginChanged');

    // Verify status changed
    const plugin = ctx.pluginManager.getPlugin(installedPluginId);
    expect(plugin).not.toBeNull();
    expect(plugin!.status).toBe('inactive');
    expect(plugin!.activatedAt).toBeUndefined();
  });

  // ── 7. Remove with cascade ─────────────────────────────────────────────

  it('7. DELETE /admin/plugins/:id — removes plugin and cascades to org copies', async () => {
    // Verify we have both global and org copies before removal
    const beforeRemoval = ctx.pluginManager.list();
    const scannerEntries = beforeRemoval.filter(
      (p) => p.packageName === '@luqen/plugin-test-scanner',
    );
    expect(scannerEntries.length).toBeGreaterThanOrEqual(2); // global + at least 1 org copy

    const response = await ctx.server.inject({
      method: 'DELETE',
      url: `/admin/plugins/${installedPluginId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('removed successfully');
    expect(response.headers['hx-trigger']).toBe('pluginChanged');

    // Verify all copies (global + org) were deleted
    const afterRemoval = ctx.pluginManager.list();
    const remaining = afterRemoval.filter(
      (p) => p.packageName === '@luqen/plugin-test-scanner',
    );
    expect(remaining).toHaveLength(0);
  });

  // ── 8. Plugin reappears in catalogue ────────────────────────────────────

  it('8. GET /admin/plugins — removed plugin reappears as available', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: {
        counts: { installed: number; active: number; available: number };
        available: Array<{ packageName: string }>;
        installed: unknown[];
      };
    }>();

    // Scanner should be back in available (was removed), notify was never installed
    expect(body.data.counts.installed).toBe(0);
    expect(body.data.counts.available).toBe(2);

    const availableNames = body.data.available.map((a) => a.packageName);
    expect(availableNames).toContain('@luqen/plugin-test-scanner');
    expect(availableNames).toContain('@luqen/plugin-test-notify');
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it('returns 400 when installing without packageName', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/install',
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Missing packageName');
  });

  it('returns 500 when activating non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/nonexistent-id/activate',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Activate failed');
  });

  it('returns 500 when deactivating non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/nonexistent-id/deactivate',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Deactivate failed');
  });

  it('returns 500 when removing non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'DELETE',
      url: '/admin/plugins/nonexistent-id',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Remove failed');
  });

  it('returns 404 when configuring non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins/nonexistent-id/configure',
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('Plugin not found');
  });

  it('returns 500 when saving config for non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: '/admin/plugins/nonexistent-id/config',
      payload: 'key=value',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Save failed');
  });

  it('returns 400 when activate-for-org has no orgId', async () => {
    // Install a plugin first for this test
    setupMockDownload(ctx.pluginManager, ctx.pluginsDir, NOTIFY_MANIFEST, '@luqen/plugin-test-notify');
    const installed = await ctx.pluginManager.install('test-notify');

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/plugins/${installed.id}/activate-for-org`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Select at least one organization');

    // Clean up
    await ctx.pluginManager.remove(installed.id);
  });
});

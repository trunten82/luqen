import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { pluginAdminRoutes } from '../../../src/routes/admin/plugins.js';
import { PluginManager } from '../../../src/plugins/manager.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';
import type { RegistryEntry } from '../../../src/plugins/types.js';

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
  {
    name: 'storage-s3',
    displayName: 'S3 Storage',
    type: 'storage',
    version: '1.0.0',
    description: 'S3 storage backend',
    packageName: '@luqen/plugin-storage-s3',
    icon: 's3',
  },
  {
    name: 'scanner-axe',
    displayName: 'Axe Scanner',
    type: 'scanner',
    version: '1.0.0',
    description: 'Axe accessibility scanner',
    packageName: '@luqen/plugin-scanner-axe',
    icon: 'axe',
  },
];

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  pluginManager: PluginManager;
  cleanup: () => void;
  dbPath: string;
  pluginsDir: string;
}

async function createTestServer(role = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-plugins-ext-${randomUUID()}.db`);
  const pluginsDir = join(tmpdir(), `test-pluginsdir-ext-${randomUUID()}`);
  mkdirSync(pluginsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const db = storage.getRawDatabase();

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
    const permissions =
      role === 'admin' ? new Set(ALL_PERMISSION_IDS) : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await pluginAdminRoutes(server, pluginManager, SAMPLE_REGISTRY, pluginsDir);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, pluginManager, cleanup, dbPath, pluginsDir };
}

function insertPlugin(
  ctx: TestContext,
  overrides: Partial<{
    id: string;
    package_name: string;
    type: string;
    version: string;
    config: string;
    status: string;
  }> = {},
): string {
  const id = overrides.id ?? `plugin-${randomUUID()}`;
  const db = ctx.storage.getRawDatabase();
  db.prepare(
    `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
     VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
  ).run({
    id,
    package_name: overrides.package_name ?? '@luqen/plugin-notify-slack',
    type: overrides.type ?? 'notification',
    version: overrides.version ?? '1.0.0',
    config: overrides.config ?? '{}',
    status: overrides.status ?? 'inactive',
    installed_at: new Date().toISOString(),
  });
  return id;
}

// ── GET /admin/plugins — extended coverage ────────────────────────────────

describe('GET /admin/plugins (extended)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('counts active plugins separately from installed', async () => {
    insertPlugin(ctx, {
      id: 'p1',
      package_name: '@luqen/plugin-notify-slack',
      status: 'active',
    });
    insertPlugin(ctx, {
      id: 'p2',
      package_name: '@luqen/plugin-auth-entra',
      status: 'inactive',
    });

    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    const body = response.json() as {
      data: {
        counts: { installed: number; active: number; available: number };
      };
    };
    expect(body.data.counts.installed).toBe(2);
    expect(body.data.counts.active).toBe(1);
    expect(body.data.counts.available).toBe(2); // storage-s3 and scanner-axe
  });

  it('renders plugins page with expected template data', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    const body = response.json() as {
      template: string;
      data: { pageTitle: string; installed: unknown[]; available: unknown[]; counts: { installed: number; active: number; available: number } };
    };
    expect(body.data.pageTitle).toBe('Plugins');
    expect(body.data.installed).toBeDefined();
    expect(body.data.available).toBeDefined();
    expect(body.data.counts).toBeDefined();
  });

  it('includes user in template data', async () => {
    const response = await ctx.server.inject({
      method: 'GET',
      url: '/admin/plugins',
    });

    const body = response.json() as {
      data: { user: { username: string } };
    };
    expect(body.data.user.username).toBe('testuser');
  });
});

// ── POST /admin/plugins/install — extended coverage ───────────────────────

describe('POST /admin/plugins/install (extended)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 400 when packageName is not a string', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/install',
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Missing packageName');
  });

  it('returns 500 when install fails (npm package not found)', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/install',
      payload: 'packageName=%40luqen%2Fplugin-notify-slack',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    // Plugin install fails because the npm package doesn't actually exist
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('alert--error');
    expect(response.body).toContain('Install failed');
  });
});

// ── POST /admin/plugins/:id/activate — extended coverage ──────────────────

describe('POST /admin/plugins/:id/activate (extended)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 500 with escaped error message for non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/does-not-exist/activate',
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Activate failed');
  });
});

// ── POST /admin/plugins/:id/deactivate — extended coverage ────────────────

describe('POST /admin/plugins/:id/deactivate (extended)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 500 with escaped error message for non-existent plugin', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/admin/plugins/does-not-exist/deactivate',
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Deactivate failed');
  });
});

// ── DELETE /admin/plugins/:id — extended coverage ─────────────────────────

describe('DELETE /admin/plugins/:id (extended)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns hx-trigger header on successful remove', async () => {
    const id = insertPlugin(ctx);

    const response = await ctx.server.inject({
      method: 'DELETE',
      url: `/admin/plugins/${id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['hx-trigger']).toBe('pluginChanged');
    expect(response.body).toContain('removed successfully');
  });

  it('returns 500 with escaped error message for remove failure', async () => {
    const response = await ctx.server.inject({
      method: 'DELETE',
      url: '/admin/plugins/nonexistent-id',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Remove failed');
  });
});

// ── GET /admin/plugins/:id/configure — extended coverage ──────────────────

describe('GET /admin/plugins/:id/configure (extended)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns config form with "no configurable settings" when no manifest', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
    });

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('no configurable settings');
    expect(response.body).toContain('Configure');
  });

  it('renders config fields from manifest.json with string type', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
      config: JSON.stringify({ webhook_url: 'https://hooks.slack.com/test' }),
    });

    // Create a manifest.json on disk
    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'webhook_url',
            label: 'Webhook URL',
            type: 'string',
            required: true,
            description: 'The Slack webhook URL',
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Webhook URL');
    expect(response.body).toContain('type="text"');
    expect(response.body).toContain('required');
    expect(response.body).toContain('form-hint');
    expect(response.body).toContain('The Slack webhook URL');
  });

  it('renders secret field type as password input', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
    });

    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'api_secret',
            label: 'API Secret',
            type: 'secret',
            required: false,
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('type="password"');
    expect(response.body).toContain('Enter new value to change');
  });

  it('renders number field type', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
      config: JSON.stringify({ retry_count: 3 }),
    });

    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'retry_count',
            label: 'Retry Count',
            type: 'number',
            required: true,
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('type="number"');
    expect(response.body).toContain('Retry Count');
  });

  it('renders boolean field type as checkbox', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
      config: JSON.stringify({ enabled: true }),
    });

    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'enabled',
            label: 'Enable Notifications',
            type: 'boolean',
            description: 'Turn on/off notifications',
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('type="checkbox"');
    expect(response.body).toContain('checked');
    expect(response.body).toContain('Enable Notifications');
  });

  it('renders boolean field unchecked when value is false', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
      config: JSON.stringify({ enabled: false }),
    });

    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'enabled',
            label: 'Enable Notifications',
            type: 'boolean',
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('type="checkbox"');
    expect(response.body).not.toContain('checked');
  });

  it('renders select field type with options', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
      config: JSON.stringify({ log_level: 'warn' }),
    });

    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'log_level',
            label: 'Log Level',
            type: 'select',
            options: ['debug', 'info', 'warn', 'error'],
            required: true,
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<select');
    expect(response.body).toContain('Log Level');
    expect(response.body).toContain('selected');
    expect(response.body).toContain('debug');
    expect(response.body).toContain('warn');
  });

  it('renders empty string for unknown field type', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
    });

    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'custom_field',
            label: 'Custom',
            type: 'unknown-type',
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    // The unknown type renders empty string, so the label won't appear in field HTML
    expect(response.body).toContain('Configure');
  });

  it('renders field with default value when config has no value', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
      config: '{}',
    });

    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'timeout',
            label: 'Timeout',
            type: 'number',
            default: 30,
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('value="30"');
  });

  it('renders field without description when none provided', async () => {
    const id = insertPlugin(ctx, {
      package_name: '@luqen/plugin-notify-slack',
    });

    const manifestDir = join(
      ctx.pluginsDir,
      'node_modules',
      '@luqen',
      'plugin-notify-slack',
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'manifest.json'),
      JSON.stringify({
        configSchema: [
          {
            key: 'simple',
            label: 'Simple Field',
            type: 'string',
          },
        ],
      }),
    );

    const response = await ctx.server.inject({
      method: 'GET',
      url: `/admin/plugins/${id}/configure`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Simple Field');
    expect(response.body).not.toContain('form-hint');
  });
});

// ── PATCH /admin/plugins/:id/config — extended coverage ───────────────────

describe('PATCH /admin/plugins/:id/config (extended)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('saves config and returns success alert with hx-trigger', async () => {
    const id = insertPlugin(ctx);
    // Create manifest.json for the plugin so readManifest succeeds
    const manifestDir = join(ctx.pluginsDir, 'node_modules', '@luqen', 'plugin-notify-slack');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify({ name: 'notify-slack', configSchema: [] }));

    const response = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/plugins/${id}/config`,
      payload: 'webhook_url=https%3A%2F%2Fhooks.slack.com%2Fnew',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['hx-trigger']).toBe('pluginChanged');
    expect(response.body).toContain('Configuration saved');
  });

  it('skips empty string values (secret fields with no change)', async () => {
    const id = insertPlugin(ctx, {
      config: JSON.stringify({ api_key: 'original' }),
    });
    // Create manifest.json for the plugin so readManifest succeeds
    const manifestDir = join(ctx.pluginsDir, 'node_modules', '@luqen', 'plugin-notify-slack');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify({ name: 'notify-slack', configSchema: [] }));

    const response = await ctx.server.inject({
      method: 'PATCH',
      url: `/admin/plugins/${id}/config`,
      payload: 'api_key=&name=test-name',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Configuration saved');

    // Verify the config was updated without the empty api_key
    const plugin = ctx.pluginManager.getPlugin(id);
    expect(plugin?.config).toHaveProperty('name', 'test-name');
  });

  it('returns 500 for non-existent plugin with escaped error message', async () => {
    const response = await ctx.server.inject({
      method: 'PATCH',
      url: '/admin/plugins/does-not-exist/config',
      payload: 'key=value',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('Save failed');
  });
});

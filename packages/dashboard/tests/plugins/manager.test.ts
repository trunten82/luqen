import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginManager } from '../../src/plugins/manager.js';
import type { RegistryEntry, PluginManifest, PluginInstance } from '../../src/plugins/types.js';
import { decryptConfig } from '../../src/plugins/crypto.js';

const TEST_KEY = 'test-encryption-key-for-plugin-manager';

const CREATE_PLUGINS_TABLE = `
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'inactive',
  installed_at TEXT NOT NULL,
  activated_at TEXT,
  error TEXT
);
`;

const testManifest: PluginManifest = {
  name: 'test-auth',
  displayName: 'Test Auth Plugin',
  type: 'auth',
  version: '1.0.0',
  description: 'A test auth plugin',
  configSchema: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
};

const testRegistryEntries: readonly RegistryEntry[] = [
  {
    name: 'test-auth',
    displayName: 'Test Auth Plugin',
    type: 'auth',
    version: '1.0.0',
    description: 'A test auth plugin',
    packageName: '@pally/plugin-test-auth',
  },
  {
    name: 'test-notify',
    displayName: 'Test Notification Plugin',
    type: 'notification',
    version: '1.0.0',
    description: 'A test notification plugin',
    packageName: '@pally/plugin-test-notify',
  },
];

function createMockPluginInstance(manifest: PluginManifest, opts?: {
  activateThrows?: boolean;
  healthCheckResult?: boolean;
}): PluginInstance {
  return {
    manifest,
    activate: opts?.activateThrows
      ? vi.fn().mockRejectedValue(new Error('Activation failed'))
      : vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(opts?.healthCheckResult ?? true),
  };
}

describe('PluginManager', () => {
  let db: Database.Database;
  let tmpDir: string;
  let manager: PluginManager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_PLUGINS_TABLE);
    tmpDir = join(tmpdir(), `plugin-manager-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    manager = new PluginManager({
      db,
      pluginsDir: tmpDir,
      encryptionKey: TEST_KEY,
      registryEntries: testRegistryEntries,
    });
  });

  afterEach(() => {
    manager.stopHealthChecks();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('install', () => {
    it('creates DB entry with status inactive', async () => {
      // Create a fake installed package with manifest
      const pkgDir = join(tmpDir, 'node_modules', '@pally', 'plugin-test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@pally/plugin-test-auth', main: 'index.js' }));

      // Mock execFileAsync to skip real npm install
      const execFileMock = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      manager._setExecFile(execFileMock);

      const record = await manager.install('@pally/plugin-test-auth');

      expect(record.packageName).toBe('@pally/plugin-test-auth');
      expect(record.status).toBe('inactive');
      expect(record.type).toBe('auth');
      expect(record.version).toBe('1.0.0');
      expect(record.id).toBeTruthy();
      expect(record.installedAt).toBeTruthy();

      // Verify DB entry
      const row = db.prepare('SELECT * FROM plugins WHERE id = @id').get({ id: record.id }) as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.status).toBe('inactive');
    });

    it('rejects package not in registry', async () => {
      await expect(manager.install('@unknown/package')).rejects.toThrow(
        'not found in registry',
      );
    });
  });

  describe('configure', () => {
    it('updates config in DB and encrypts secrets', async () => {
      // Insert a plugin row directly
      const id = 'test-plugin-1';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: '{}',
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

      // Set up manifest for this plugin
      const pkgDir = join(tmpDir, 'node_modules', '@pally', 'plugin-test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));

      const config = { clientId: 'my-client', clientSecret: 'super-secret', enabled: true };
      const record = await manager.configure(id, config);

      expect(record.config).toBeTruthy();

      // Verify the secret was encrypted in DB
      const row = db.prepare('SELECT config FROM plugins WHERE id = @id').get({ id }) as { config: string };
      const storedConfig = JSON.parse(row.config);
      expect(storedConfig.clientId).toBe('my-client');
      expect(storedConfig.clientSecret).not.toBe('super-secret');

      // Verify we can decrypt it
      const decrypted = decryptConfig(storedConfig, testManifest.configSchema, TEST_KEY);
      expect(decrypted.clientSecret).toBe('super-secret');
    });
  });

  describe('activate', () => {
    it('sets status to active when activate succeeds', async () => {
      const id = 'test-plugin-2';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: JSON.stringify({ clientId: 'test' }),
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

      const pkgDir = join(tmpDir, 'node_modules', '@pally', 'plugin-test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));

      const mockInstance = createMockPluginInstance(testManifest);
      manager._setLoader(async () => mockInstance);

      const record = await manager.activate(id);

      expect(record.status).toBe('active');
      expect(record.activatedAt).toBeTruthy();
      expect(mockInstance.activate).toHaveBeenCalled();
    });

    it('sets status to error if activate() throws', async () => {
      const id = 'test-plugin-3';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: JSON.stringify({ clientId: 'test' }),
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

      const pkgDir = join(tmpDir, 'node_modules', '@pally', 'plugin-test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));

      const mockInstance = createMockPluginInstance(testManifest, { activateThrows: true });
      manager._setLoader(async () => mockInstance);

      const record = await manager.activate(id);

      expect(record.status).toBe('error');
      expect(record.error).toContain('Activation failed');
    });
  });

  describe('deactivate', () => {
    it('sets status to inactive', async () => {
      const id = 'test-plugin-4';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, activated_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at, @activated_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: '{}',
        status: 'active',
        installed_at: new Date().toISOString(),
        activated_at: new Date().toISOString(),
      });

      // Set up a loaded instance
      const mockInstance = createMockPluginInstance(testManifest);
      manager._setActiveInstance(id, mockInstance);

      const record = await manager.deactivate(id);

      expect(record.status).toBe('inactive');
      expect(mockInstance.deactivate).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes DB entry', async () => {
      const id = 'test-plugin-5';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: '{}',
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

      await manager.remove(id);

      const row = db.prepare('SELECT * FROM plugins WHERE id = @id').get({ id });
      expect(row).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns all plugins with masked secrets', () => {
      const id = 'test-plugin-6';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: JSON.stringify({ clientId: 'visible', clientSecret: 'encrypted-value' }),
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

      // Need manifest to mask secrets
      const pkgDir = join(tmpDir, 'node_modules', '@pally', 'plugin-test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));

      const plugins = manager.list();

      expect(plugins).toHaveLength(1);
      expect(plugins[0].id).toBe(id);
      expect(plugins[0].config.clientId).toBe('visible');
      expect(plugins[0].config.clientSecret).toBe('***');
    });
  });

  describe('getPlugin', () => {
    it('returns specific plugin', () => {
      const id = 'test-plugin-7';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: '{}',
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

      const plugin = manager.getPlugin(id);
      expect(plugin).not.toBeNull();
      expect(plugin!.id).toBe(id);
    });

    it('returns null for nonexistent id', () => {
      const plugin = manager.getPlugin('nonexistent');
      expect(plugin).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('returns ok status when healthCheck passes', async () => {
      const id = 'test-plugin-8';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, activated_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at, @activated_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: '{}',
        status: 'active',
        installed_at: new Date().toISOString(),
        activated_at: new Date().toISOString(),
      });

      const mockInstance = createMockPluginInstance(testManifest, { healthCheckResult: true });
      manager._setActiveInstance(id, mockInstance);

      const result = await manager.checkHealth(id);
      expect(result.ok).toBe(true);
    });

    it('marks unhealthy after 3 consecutive failures', async () => {
      const id = 'test-plugin-9';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, activated_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at, @activated_at)`,
      ).run({
        id,
        package_name: '@pally/plugin-test-auth',
        type: 'auth',
        version: '1.0.0',
        config: '{}',
        status: 'active',
        installed_at: new Date().toISOString(),
        activated_at: new Date().toISOString(),
      });

      const pkgDir = join(tmpDir, 'node_modules', '@pally', 'plugin-test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));

      const mockInstance = createMockPluginInstance(testManifest, { healthCheckResult: false });
      manager._setActiveInstance(id, mockInstance);

      // First two failures: still not unhealthy
      await manager.checkHealth(id);
      await manager.checkHealth(id);

      let row = db.prepare('SELECT status FROM plugins WHERE id = @id').get({ id }) as { status: string };
      expect(row.status).toBe('active');

      // Third failure: should mark unhealthy
      const result = await manager.checkHealth(id);
      expect(result.ok).toBe(false);

      row = db.prepare('SELECT status FROM plugins WHERE id = @id').get({ id }) as { status: string };
      expect(row.status).toBe('unhealthy');
    });
  });
});

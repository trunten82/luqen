import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('PluginRepository', () => {
  describe('createPlugin', () => {
    it('creates a plugin with all fields', async () => {
      const id = randomUUID();
      const plugin = await storage.plugins.createPlugin({
        id,
        packageName: '@luqen/plugin-pa11y',
        type: 'scanner',
        version: '1.2.3',
        config: { timeout: 5000 },
        status: 'active',
      });

      expect(plugin.id).toBe(id);
      expect(plugin.packageName).toBe('@luqen/plugin-pa11y');
      expect(plugin.type).toBe('scanner');
      expect(plugin.version).toBe('1.2.3');
      expect(plugin.config).toEqual({ timeout: 5000 });
      expect(plugin.status).toBe('active');
      expect(typeof plugin.installedAt).toBe('string');
    });

    it('defaults status to inactive and config to empty object when omitted', async () => {
      const id = randomUUID();
      const plugin = await storage.plugins.createPlugin({
        id,
        packageName: '@luqen/plugin-minimal',
        type: 'storage',
        version: '0.1.0',
      });

      expect(plugin.status).toBe('inactive');
      expect(plugin.config).toEqual({});
    });
  });

  describe('getPlugin', () => {
    it('returns plugin by ID', async () => {
      const id = randomUUID();
      await storage.plugins.createPlugin({
        id,
        packageName: '@luqen/plugin-test',
        type: 'scanner',
        version: '1.0.0',
      });

      const plugin = await storage.plugins.getPlugin(id);
      expect(plugin).not.toBeNull();
      expect(plugin!.id).toBe(id);
    });

    it('returns null for non-existent ID', async () => {
      const result = await storage.plugins.getPlugin('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('getPluginByPackageName', () => {
    it('returns plugin by package name', async () => {
      const id = randomUUID();
      await storage.plugins.createPlugin({
        id,
        packageName: '@luqen/unique-pkg',
        type: 'scanner',
        version: '2.0.0',
      });

      const plugin = await storage.plugins.getPluginByPackageName('@luqen/unique-pkg');
      expect(plugin).not.toBeNull();
      expect(plugin!.packageName).toBe('@luqen/unique-pkg');
    });

    it('returns null for non-existent package name', async () => {
      const result = await storage.plugins.getPluginByPackageName('@luqen/no-such-pkg');
      expect(result).toBeNull();
    });
  });

  describe('listPlugins', () => {
    it('returns all plugins', async () => {
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/plugin-a',
        type: 'scanner',
        version: '1.0.0',
      });
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/plugin-b',
        type: 'storage',
        version: '1.0.0',
      });

      const all = await storage.plugins.listPlugins();
      expect(all.length).toBe(2);
    });
  });

  describe('listByTypeAndStatus', () => {
    it('filters by type and status', async () => {
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/scanner-active',
        type: 'scanner',
        version: '1.0.0',
        status: 'active',
      });
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/scanner-inactive',
        type: 'scanner',
        version: '1.0.0',
        status: 'inactive',
      });
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/storage-active',
        type: 'storage',
        version: '1.0.0',
        status: 'active',
      });

      const results = await storage.plugins.listByTypeAndStatus('scanner', 'active');
      expect(results.length).toBe(1);
      expect(results[0].packageName).toBe('@luqen/scanner-active');
    });
  });

  describe('listByStatus', () => {
    it('filters by status across all types', async () => {
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/plugin-active-1',
        type: 'scanner',
        version: '1.0.0',
        status: 'active',
      });
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/plugin-active-2',
        type: 'storage',
        version: '1.0.0',
        status: 'active',
      });
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/plugin-inactive',
        type: 'scanner',
        version: '1.0.0',
        status: 'inactive',
      });

      const active = await storage.plugins.listByStatus('active');
      expect(active.length).toBe(2);
      expect(active.every((p) => p.status === 'active')).toBe(true);
    });
  });

  describe('getByPackageNameAndStatus', () => {
    it('returns plugin matching package name and status', async () => {
      const id = randomUUID();
      await storage.plugins.createPlugin({
        id,
        packageName: '@luqen/my-plugin',
        type: 'scanner',
        version: '1.0.0',
        status: 'active',
      });

      const found = await storage.plugins.getByPackageNameAndStatus('@luqen/my-plugin', 'active');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
    });

    it('returns null when status does not match', async () => {
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: '@luqen/my-plugin',
        type: 'scanner',
        version: '1.0.0',
        status: 'inactive',
      });

      const result = await storage.plugins.getByPackageNameAndStatus('@luqen/my-plugin', 'active');
      expect(result).toBeNull();
    });
  });

  describe('updatePlugin', () => {
    it('changes status, config, error, and activatedAt', async () => {
      const id = randomUUID();
      await storage.plugins.createPlugin({
        id,
        packageName: '@luqen/update-test',
        type: 'scanner',
        version: '1.0.0',
        status: 'inactive',
      });

      const activatedAt = new Date().toISOString();
      await storage.plugins.updatePlugin(id, {
        status: 'active',
        config: { retries: 3 },
        error: 'some error',
        activatedAt,
      });

      const updated = await storage.plugins.getPlugin(id);
      expect(updated!.status).toBe('active');
      expect(updated!.config).toEqual({ retries: 3 });
      expect(updated!.error).toBe('some error');
      expect(updated!.activatedAt).toBe(activatedAt);
    });

    it('only updates provided fields', async () => {
      const id = randomUUID();
      await storage.plugins.createPlugin({
        id,
        packageName: '@luqen/partial-update',
        type: 'scanner',
        version: '1.0.0',
        status: 'inactive',
      });

      await storage.plugins.updatePlugin(id, { status: 'active' });

      const updated = await storage.plugins.getPlugin(id);
      expect(updated!.status).toBe('active');
      expect(updated!.config).toEqual({});
    });
  });

  describe('deletePlugin', () => {
    it('removes the plugin from the database', async () => {
      const id = randomUUID();
      await storage.plugins.createPlugin({
        id,
        packageName: '@luqen/to-delete',
        type: 'scanner',
        version: '1.0.0',
      });

      await storage.plugins.deletePlugin(id);

      const result = await storage.plugins.getPlugin(id);
      expect(result).toBeNull();
    });
  });
});

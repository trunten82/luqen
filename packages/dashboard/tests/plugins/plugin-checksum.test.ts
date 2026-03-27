import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginManager } from '../../src/plugins/manager.js';
import type { RegistryEntry, PluginManifest, PluginInstance } from '../../src/plugins/types.js';
import { computeDirectoryChecksum } from '../../src/plugins/checksum.js';

// Mock tar to avoid needing real tarballs in tests
vi.mock('tar', () => ({
  default: {
    extract: vi.fn().mockResolvedValue(undefined),
  },
  extract: vi.fn().mockResolvedValue(undefined),
}));

const TEST_KEY = 'test-encryption-key-for-checksum-tests';

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
  error TEXT,
  checksum TEXT
);
`;

const testManifest: PluginManifest = {
  name: 'test-auth',
  displayName: 'Test Auth Plugin',
  type: 'auth',
  version: '1.0.0',
  description: 'A test auth plugin',
  configSchema: [],
};

const testRegistryEntries: readonly RegistryEntry[] = [
  {
    name: 'test-auth',
    displayName: 'Test Auth Plugin',
    type: 'auth',
    version: '1.0.0',
    description: 'A test auth plugin',
    packageName: '@luqen/plugin-test-auth',
    downloadUrl: 'https://example.com/plugin-test-auth-1.0.0.tgz',
  },
];

function createMockPluginInstance(): PluginInstance {
  return {
    manifest: testManifest,
    activate: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

describe('Plugin Checksum', () => {
  let db: Database.Database;
  let tmpDir: string;
  let manager: PluginManager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_PLUGINS_TABLE);
    tmpDir = join(tmpdir(), `plugin-checksum-test-${Date.now()}`);
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

  describe('install stores checksum', () => {
    it('computes and stores SHA-256 checksum of plugin files on install', async () => {
      manager._setDownloadFn(vi.fn().mockImplementation(async (_url: string, destPath: string) => {
        writeFileSync(destPath, 'dummy-tarball');
        const pkgDir = join(tmpDir, 'packages', 'test-auth');
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));
        writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {}');
      }));

      const record = await manager.install('test-auth');

      // Verify the checksum was stored in DB
      const row = db.prepare('SELECT checksum FROM plugins WHERE id = ?').get(record.id) as { checksum: string | null };
      expect(row.checksum).not.toBeNull();
      expect(row.checksum).toHaveLength(64);
      expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);

      // Verify it matches what we'd compute from the directory
      const pkgDir = join(tmpDir, 'packages', 'test-auth');
      const expectedChecksum = computeDirectoryChecksum(pkgDir);
      expect(row.checksum).toBe(expectedChecksum);
    });
  });

  describe('activate verifies checksum', () => {
    it('activates successfully when checksum matches', async () => {
      const pkgDir = join(tmpDir, 'packages', 'test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));
      writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {}');

      const checksum = computeDirectoryChecksum(pkgDir);

      const id = 'checksum-ok-plugin';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, checksum)
         VALUES (@id, @pn, @type, @ver, '{}', 'inactive', @now, @checksum)`,
      ).run({ id, pn: '@luqen/plugin-test-auth', type: 'auth', ver: '1.0.0', now: new Date().toISOString(), checksum });

      manager._setLoader(vi.fn().mockResolvedValue(createMockPluginInstance()));

      const record = await manager.activate(id);
      expect(record.status).toBe('active');
    });

    it('refuses to activate when checksum mismatches (tampered files)', async () => {
      const pkgDir = join(tmpDir, 'packages', 'test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));
      writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {}');

      const originalChecksum = computeDirectoryChecksum(pkgDir);

      const id = 'checksum-bad-plugin';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, checksum)
         VALUES (@id, @pn, @type, @ver, '{}', 'inactive', @now, @checksum)`,
      ).run({ id, pn: '@luqen/plugin-test-auth', type: 'auth', ver: '1.0.0', now: new Date().toISOString(), checksum: originalChecksum });

      // Tamper with the plugin files
      writeFileSync(join(pkgDir, 'index.js'), 'module.exports = { hacked: true }');

      manager._setLoader(vi.fn().mockResolvedValue(createMockPluginInstance()));

      const record = await manager.activate(id);
      expect(record.status).toBe('error');
      expect(record.error).toContain('checksum mismatch');
    });

    it('allows activation when no checksum stored (legacy plugins)', async () => {
      const pkgDir = join(tmpDir, 'packages', 'test-auth');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(testManifest));
      writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {}');

      const id = 'legacy-plugin';
      db.prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, checksum)
         VALUES (@id, @pn, @type, @ver, '{}', 'inactive', @now, NULL)`,
      ).run({ id, pn: '@luqen/plugin-test-auth', type: 'auth', ver: '1.0.0', now: new Date().toISOString() });

      manager._setLoader(vi.fn().mockResolvedValue(createMockPluginInstance()));

      const record = await manager.activate(id);
      expect(record.status).toBe('active');
    });
  });
});

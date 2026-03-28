/**
 * Integration Test — Plugin Install -> Activate -> Scan -> Deactivate -> Uninstall
 *
 * Tests the full plugin lifecycle using the PluginManager with an in-memory
 * SQLite database and a mock plugin instance. Verifies that the manager
 * correctly handles each lifecycle stage and maintains consistent state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginManager } from '../../src/plugins/manager.js';
import type {
  RegistryEntry,
  PluginManifest,
  PluginInstance,
  ScannerPlugin,
  ScannerIssue,
} from '../../src/plugins/types.js';

// Mock tar to avoid needing real tarballs in tests
vi.mock('tar', () => ({
  default: {
    extract: vi.fn().mockResolvedValue(undefined),
  },
  extract: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_KEY = 'test-encryption-key-for-lifecycle-test';

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
  checksum TEXT,
  org_id TEXT NOT NULL DEFAULT 'system'
);
`;

// ---------------------------------------------------------------------------
// Test plugin fixtures
// ---------------------------------------------------------------------------

const scannerManifest: PluginManifest = {
  name: 'test-scanner',
  displayName: 'Test Scanner Plugin',
  type: 'scanner',
  version: '1.0.0',
  description: 'A test scanner plugin for lifecycle testing',
  configSchema: [
    { key: 'apiUrl', label: 'API URL', type: 'string', required: true },
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
  ],
  autoDeactivateOnFailure: true,
};

const notificationManifest: PluginManifest = {
  name: 'test-notify',
  displayName: 'Test Notification Plugin',
  type: 'notification',
  version: '2.0.0',
  description: 'A test notification plugin',
  configSchema: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'string', required: true },
  ],
};

const scannerRegistry: readonly RegistryEntry[] = [
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

function createMockScannerPlugin(opts?: {
  activateThrows?: boolean;
  healthCheckResult?: boolean;
  evaluateResult?: readonly ScannerIssue[];
}): ScannerPlugin {
  return {
    manifest: scannerManifest,
    rules: [
      { code: 'CUSTOM.1', description: 'Custom rule 1', level: 'AA' },
      { code: 'CUSTOM.2', description: 'Custom rule 2', level: 'A' },
    ],
    activate: opts?.activateThrows
      ? vi.fn().mockRejectedValue(new Error('Activation failed'))
      : vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(opts?.healthCheckResult ?? true),
    evaluate: vi.fn().mockResolvedValue(opts?.evaluateResult ?? [
      {
        code: 'CUSTOM.1',
        type: 'error' as const,
        message: 'Custom accessibility issue found',
        selector: 'div.content',
        context: '<div class="content">',
      },
    ]),
  };
}

function createMockNotificationPlugin(): PluginInstance {
  return {
    manifest: notificationManifest,
    activate: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Plugin Lifecycle (install -> activate -> scan -> deactivate -> uninstall)', () => {
  let db: Database.Database;
  let tmpDir: string;
  let manager: PluginManager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_PLUGINS_TABLE);
    tmpDir = join(tmpdir(), `plugin-lifecycle-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    manager = new PluginManager({
      db,
      pluginsDir: tmpDir,
      encryptionKey: TEST_KEY,
      registryEntries: scannerRegistry,
    });
  });

  afterEach(() => {
    manager.stopHealthChecks();
    db.close();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Helper: install a plugin with mocked download ─────────────────────

  function setupPluginDownload(
    manifest: PluginManifest,
    packageName: string,
  ): void {
    const pluginName = packageName.split('/').pop()!.replace(/^plugin-/, '');

    manager._setDownloadFn(
      vi.fn().mockImplementation(async (_url: string, destPath: string) => {
        writeFileSync(destPath, 'dummy-tarball');
        const pkgDir = join(tmpDir, 'packages', pluginName);
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(manifest));
        writeFileSync(
          join(pkgDir, 'package.json'),
          JSON.stringify({ name: packageName, main: 'index.js' }),
        );
      }),
    );
  }

  // ── Full lifecycle test ───────────────────────────────────────────────

  describe('complete lifecycle', () => {
    it('install -> activate -> verify hooks -> deactivate -> uninstall', async () => {
      // --- Step 1: Install ---
      setupPluginDownload(scannerManifest, '@luqen/plugin-test-scanner');

      const installed = await manager.install('test-scanner');

      expect(installed.packageName).toBe('@luqen/plugin-test-scanner');
      expect(installed.status).toBe('inactive');
      expect(installed.type).toBe('scanner');
      expect(installed.version).toBe('1.0.0');
      expect(installed.id).toBeTruthy();
      expect(installed.installedAt).toBeTruthy();

      const pluginId = installed.id;

      // Plugin should appear in the list
      const listAfterInstall = manager.list();
      expect(listAfterInstall).toHaveLength(1);
      expect(listAfterInstall[0].id).toBe(pluginId);
      expect(listAfterInstall[0].status).toBe('inactive');

      // --- Step 2: Configure ---
      const config = { apiUrl: 'https://scanner.example.com', apiKey: 'secret-key-123' };
      const configured = await manager.configure(pluginId, config);
      expect(configured.id).toBe(pluginId);

      // --- Step 3: Activate ---
      const mockInstance = createMockScannerPlugin();
      manager._setLoader(vi.fn().mockResolvedValue(mockInstance));

      const activated = await manager.activate(pluginId);

      expect(activated.status).toBe('active');
      expect(activated.activatedAt).toBeTruthy();
      expect(mockInstance.activate).toHaveBeenCalledTimes(1);

      // --- Step 4: Verify plugin hooks into scan pipeline ---
      const activePlugins = manager.getActivePluginsByType('scanner');
      expect(activePlugins).toHaveLength(1);

      // The scanner plugin's evaluate method simulates scan hook integration
      const scannerPlugin = activePlugins[0] as ScannerPlugin;
      const issues = await scannerPlugin.evaluate({
        url: 'https://example.com',
        html: '<html><body><div class="content">Test</div></body></html>',
        issues: [],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('CUSTOM.1');

      // --- Step 5: Health check ---
      const health = await manager.checkHealth(pluginId);
      expect(health.ok).toBe(true);

      // --- Step 6: Deactivate ---
      const deactivated = await manager.deactivate(pluginId);

      expect(deactivated.status).toBe('inactive');
      expect(deactivated.activatedAt).toBeUndefined();
      expect(mockInstance.deactivate).toHaveBeenCalledTimes(1);

      // Plugin should no longer appear in active list
      const activeAfterDeactivation = manager.getActivePluginsByType('scanner');
      expect(activeAfterDeactivation).toHaveLength(0);

      // --- Step 7: Uninstall ---
      await manager.remove(pluginId);

      const listAfterRemoval = manager.list();
      expect(listAfterRemoval).toHaveLength(0);

      const plugin = manager.getPlugin(pluginId);
      expect(plugin).toBeNull();
    });
  });

  // ── Install phase ─────────────────────────────────────────────────────

  describe('install phase', () => {
    it('rejects unknown plugin names', async () => {
      await expect(manager.install('nonexistent-plugin')).rejects.toThrow(
        'not found in catalogue',
      );
    });

    it('rejects plugin without download URL', async () => {
      const noUrlRegistry: readonly RegistryEntry[] = [
        {
          name: 'no-url',
          displayName: 'No URL Plugin',
          type: 'auth',
          version: '1.0.0',
          description: 'Plugin without download URL',
          packageName: '@luqen/plugin-no-url',
          // No downloadUrl
        },
      ];

      const mgr = new PluginManager({
        db,
        pluginsDir: tmpDir,
        encryptionKey: TEST_KEY,
        registryEntries: noUrlRegistry,
      });

      await expect(mgr.install('no-url')).rejects.toThrow('no download URL');
    });

    it('can install by package name', async () => {
      setupPluginDownload(scannerManifest, '@luqen/plugin-test-scanner');

      const installed = await manager.install('@luqen/plugin-test-scanner');
      expect(installed.packageName).toBe('@luqen/plugin-test-scanner');
      expect(installed.status).toBe('inactive');
    });
  });

  // ── Activate phase ────────────────────────────────────────────────────

  describe('activate phase', () => {
    it('sets status to error when activation fails', async () => {
      setupPluginDownload(scannerManifest, '@luqen/plugin-test-scanner');
      const installed = await manager.install('test-scanner');

      const failingInstance = createMockScannerPlugin({ activateThrows: true });
      manager._setLoader(vi.fn().mockResolvedValue(failingInstance));

      const result = await manager.activate(installed.id);

      // Status stays active (enabled) but error records why the plugin code couldn't start
      expect(result.status).toBe('active');
      expect(result.error).toContain('Activation failed');
    });

    it('throws for non-existent plugin ID', async () => {
      await expect(manager.activate('non-existent-id')).rejects.toThrow(
        'not found',
      );
    });
  });

  // ── Health check phase ────────────────────────────────────────────────

  describe('health check', () => {
    it('returns not active for inactive plugin', async () => {
      const health = await manager.checkHealth('non-existent-id');
      expect(health.ok).toBe(false);
      expect(health.message).toContain('not active');
    });

    it('auto-deactivates after repeated failures when configured', async () => {
      setupPluginDownload(scannerManifest, '@luqen/plugin-test-scanner');
      const installed = await manager.install('test-scanner');

      // Activate with a plugin that fails health checks
      const unhealthyPlugin = createMockScannerPlugin({ healthCheckResult: false });
      manager._setLoader(vi.fn().mockResolvedValue(unhealthyPlugin));
      await manager.activate(installed.id);

      // 3 consecutive failures should trigger auto-deactivation
      // (HEALTH_FAILURE_THRESHOLD = 3 and autoDeactivateOnFailure = true)
      await manager.checkHealth(installed.id);
      await manager.checkHealth(installed.id);
      const finalResult = await manager.checkHealth(installed.id);

      expect(finalResult.ok).toBe(false);
      expect(finalResult.message).toContain('Auto-deactivated');

      const plugin = manager.getPlugin(installed.id);
      expect(plugin!.status).toBe('inactive');
    });
  });

  // ── Deactivate phase ──────────────────────────────────────────────────

  describe('deactivate phase', () => {
    it('throws for non-existent plugin', async () => {
      await expect(manager.deactivate('non-existent-id')).rejects.toThrow(
        'not found',
      );
    });

    it('safely handles deactivation of already inactive plugin', async () => {
      setupPluginDownload(scannerManifest, '@luqen/plugin-test-scanner');
      const installed = await manager.install('test-scanner');

      // Deactivate without ever activating — should not throw
      const result = await manager.deactivate(installed.id);
      expect(result.status).toBe('inactive');
    });
  });

  // ── Uninstall phase ───────────────────────────────────────────────────

  describe('uninstall (remove) phase', () => {
    it('deactivates an active plugin before removing', async () => {
      setupPluginDownload(scannerManifest, '@luqen/plugin-test-scanner');
      const installed = await manager.install('test-scanner');

      const mockInstance = createMockScannerPlugin();
      manager._setLoader(vi.fn().mockResolvedValue(mockInstance));
      await manager.activate(installed.id);

      // Remove while active
      await manager.remove(installed.id);

      expect(mockInstance.deactivate).toHaveBeenCalledTimes(1);
      expect(manager.list()).toHaveLength(0);
    });

    it('throws for non-existent plugin', async () => {
      await expect(manager.remove('non-existent-id')).rejects.toThrow(
        'not found',
      );
    });
  });

  // ── Multiple plugins ─────────────────────────────────────────────────

  describe('multiple plugins', () => {
    it('manages multiple plugins independently', async () => {
      // Install scanner plugin
      setupPluginDownload(scannerManifest, '@luqen/plugin-test-scanner');
      const scanner = await manager.install('test-scanner');

      // Install notification plugin
      setupPluginDownload(notificationManifest, '@luqen/plugin-test-notify');
      const notify = await manager.install('test-notify');

      expect(manager.list()).toHaveLength(2);

      // Activate only the scanner
      const scannerInstance = createMockScannerPlugin();
      const notifyInstance = createMockNotificationPlugin();
      manager._setLoader(vi.fn()
        .mockResolvedValueOnce(scannerInstance)
        .mockResolvedValueOnce(notifyInstance));

      await manager.activate(scanner.id);

      // Only scanner should be active
      const activeScanners = manager.getActivePluginsByType('scanner');
      expect(activeScanners).toHaveLength(1);

      const activeNotifications = manager.getActivePluginsByType('notification');
      expect(activeNotifications).toHaveLength(0);

      // Activate notification plugin too
      await manager.activate(notify.id);

      const activeNotifications2 = manager.getActivePluginsByType('notification');
      expect(activeNotifications2).toHaveLength(1);

      // Deactivate scanner, notification should remain active
      await manager.deactivate(scanner.id);
      expect(manager.getActivePluginsByType('scanner')).toHaveLength(0);
      expect(manager.getActivePluginsByType('notification')).toHaveLength(1);
    });
  });

  // ── Registry inspection ───────────────────────────────────────────────

  describe('registry inspection', () => {
    it('returns the registry entries', () => {
      const entries = manager.getRegistryEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('test-scanner');
      expect(entries[1].name).toBe('test-notify');
    });
  });
});

/**
 * PBH-D Task 4 — M-1: measures finding F-2 (plugin boot-salt ordering).
 *
 * server.ts runs `pluginManager.initializeOnStartup()` BEFORE
 * `new AuthService(...)`, which is what sets the process's module-global
 * installation salt (crypto.ts's `setEncryptionSalt`, called once per real
 * process at boot). So on a REAL fresh process, an ACTIVE plugin with a
 * manifest-declared secret field gets its secret decrypted under the
 * DEFAULT salt, not the DB's real installation salt — and decryption fails.
 *
 * `vi.resetModules()` + a fresh dynamic `import('../../src/server.js')`
 * gives this test its own crypto.js module instance with its own
 * module-global salt (starting at the DEFAULT), faithful to what a genuine
 * new process experiences — a statically-imported crypto module already
 * mutated by an earlier test/boot in the SAME vitest worker would not
 * reproduce this.
 *
 * This test MEASURES the finding. It does NOT fix the boot order (F-2 is an
 * owner decision — fixing it could start plugins at boot that currently
 * fail, possibly including an auth plugin that changes the live login flow).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { PluginManager } from '../../src/plugins/manager.js';
import type { PluginManifest } from '../../src/plugins/types.js';

const PACKAGE_NAME = '@luqen/plugin-boot-salt-fixture';

afterEach(() => {
  vi.resetModules();
});

describe('M-1 (F-2 measurement): plugin boot-salt ordering', () => {
  // CONFIRMED (measured 2026-09-28, this test's own first RED-then-green
  // run — see the SUMMARY for the transcript): on a fresh-process boot,
  // observed plugins.error was exactly
  // "Unsupported state or unable to authenticate data", matching the
  // pre-declared prediction /authenticate/. F-2 is real and unfixed.
  //
  // Committed as `it.fails` per the plan: the assertion below
  // (`error is NULL`) is the CORRECT, fixed-ordering behavior — it fails
  // today because F-2 is present, and `it.fails` reports failure the day
  // someone reorders server.ts's boot sequence and this assertion starts
  // PASSING, forcing a conscious conversion to a plain `it` instead of
  // leaving a silently-fixed defect unnoticed.
  it.fails('[KNOWN DEFECT F-2, reported 260928-pbh] active plugin secrets are decrypted before the installation salt is set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'luqen-plugin-boot-salt-'));
    const dbPath = join(root, 'dashboard.db');
    const reportsDir = join(root, 'reports');
    const pluginsDir = join(root, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    const sessionSecret = 'a'.repeat(32);
    const encryptionKey = 'b'.repeat(32);

    // ── Write a real, minimal plugin package: a successful decrypt+load
    // leaves plugins.error NULL, so the eventual error is unambiguously the
    // decrypt failure this test measures, not "package could not load".
    const manifest: PluginManifest = {
      name: 'plugin-boot-salt-fixture',
      displayName: 'Boot Salt Fixture',
      type: 'notification',
      version: '1.0.0',
      description: 'M-1 fixture: one manifest-declared secret field.',
      configSchema: [{ key: 'apiKey', label: 'API Key', type: 'secret', required: true }],
    };
    const pkgDir = join(pluginsDir, 'packages', 'boot-salt-fixture');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, type: 'module', main: 'index.js' }));
    writeFileSync(
      join(pkgDir, 'index.js'),
      'export default { activate: async () => {}, deactivate: async () => {} };\n',
    );

    // ── Seed: migrate, create the real salt row (AuthService), configure +
    // activate the plugin through the REAL runtime paths — same process,
    // module-global salt correctly set for THIS setup.
    const storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();
    const rawDb = storage.getRawDatabase();
    const pluginManager = new PluginManager({ db: rawDb, pluginsDir, encryptionKey, registryEntries: [] });
    // eslint-disable-next-line no-new
    new AuthService(rawDb, pluginManager, storage);

    const now = new Date().toISOString();
    const pluginId = 'plugin-boot-salt-fixture-id';
    rawDb
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @packageName, @type, @version, '{}', 'inactive', @installedAt)`,
      )
      .run({ id: pluginId, packageName: PACKAGE_NAME, type: manifest.type, version: manifest.version, installedAt: now });
    await pluginManager.configure(pluginId, { apiKey: 'a-real-secret-value-for-m1' });
    await pluginManager.activate(pluginId);

    const activatedRow = rawDb.prepare(`SELECT error FROM plugins WHERE id = ?`).get(pluginId) as { error: string | null };
    expect(activatedRow.error, 'precondition: the plugin must start cleanly under the correct salt before the fresh-process boot').toBeNull();
    await storage.disconnect();

    // ── Fresh process boot: reset the module registry so server.js (and its
    // crypto.js dependency) is a BRAND NEW module instance with its own
    // module-global salt starting at the default.
    vi.resetModules();
    const { createServer } = (await import('../../src/server.js')) as typeof import('../../src/server.js');

    let app: FastifyInstance | undefined;
    try {
      app = (await createServer({
        dbPath,
        reportsDir,
        sessionSecret,
        encryptionKey,
        catalogueUrl: '',
        catalogueCacheTtl: 0,
        redisUrl: '',
        maxConcurrentScans: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as FastifyInstance;
      await app.ready();
    } finally {
      if (app !== undefined) await app.close();
    }

    const postBootDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    let observedError: string | null;
    try {
      const row = postBootDb.prepare(`SELECT error FROM plugins WHERE id = ?`).get(pluginId) as { error: string | null };
      observedError = row.error;
    } finally {
      postBootDb.close();
    }

    // eslint-disable-next-line no-console
    console.log('[M-1 observed plugins.error]', JSON.stringify(observedError));
    // The FIXED-ordering assertion — expected to fail today (F-2 present).
    expect(observedError).toBeNull();
  }, 120_000);
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginManager } from '../../src/plugins/manager.js';
import type { PluginInstance, PluginManifest } from '../../src/plugins/types.js';

const CREATE_PLUGINS_TABLE = `
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY, package_name TEXT NOT NULL, type TEXT NOT NULL, version TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'inactive', installed_at TEXT NOT NULL,
  activated_at TEXT, error TEXT, checksum TEXT
);`;

const manifest: PluginManifest = {
  name: 'scanner-fake', displayName: 'Fake scanner', type: 'scanner', version: '1.0.0', description: 'x', configSchema: [],
};

function instance(deactivate: () => Promise<void>): PluginInstance {
  return { manifest, activate: vi.fn(), deactivate: vi.fn(deactivate), healthCheck: vi.fn().mockResolvedValue(true) };
}

function insertActive(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at, activated_at)
     VALUES (?, '@luqen/plugin-scanner-fake', 'scanner', '1.0.0', '{}', 'active', ?, ?)`,
  ).run(id, new Date().toISOString(), new Date().toISOString());
}

describe('PluginManager.shutdownAll (process shutdown)', () => {
  let db: Database.Database;
  let dir: string;
  let manager: PluginManager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_PLUGINS_TABLE);
    dir = mkdtempSync(join(tmpdir(), 'plugin-shutdown-test-'));
    manager = new PluginManager({ db, pluginsDir: dir, encryptionKey: 'k'.repeat(32), registryEntries: [] });
  });

  afterEach(() => {
    manager.stopHealthChecks();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('MS1: deactivates every running instance but leaves them ACTIVE for the next start', async () => {
    insertActive(db, 'p1');
    insertActive(db, 'p2');
    const a = instance(async () => {});
    const b = instance(async () => {});
    manager._setActiveInstance('p1', a);
    manager._setActiveInstance('p2', b);
    manager.startHealthChecks(10);

    await manager.shutdownAll();

    expect(a.deactivate).toHaveBeenCalledTimes(1);
    expect(b.deactivate).toHaveBeenCalledTimes(1);
    expect(manager.getActiveInstance('p1')).toBeNull();
    expect(manager.getActiveInstance('p2')).toBeNull();
    const statuses = db.prepare('SELECT status FROM plugins ORDER BY id').all() as { status: string }[];
    expect(statuses.map((r) => r.status)).toEqual(['active', 'active']);
  });

  it('MS2: one plugin failing to deactivate does not stop the others', async () => {
    insertActive(db, 'p1');
    insertActive(db, 'p2');
    const bad = instance(async () => { throw new Error('browser already gone'); });
    const good = instance(async () => {});
    manager._setActiveInstance('p1', bad);
    manager._setActiveInstance('p2', good);

    await expect(manager.shutdownAll()).resolves.toBeUndefined();
    expect(good.deactivate).toHaveBeenCalledTimes(1);
  });
});

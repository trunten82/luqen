import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SqlitePluginRepository } from '../../src/db/sqlite/repositories/plugin-repository.js';

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

describe('Concurrent Plugins', () => {
  let db: Database.Database;
  let repo: SqlitePluginRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_PLUGINS_TABLE);
    repo = new SqlitePluginRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('two plugins of same type can be active simultaneously', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const activatedAt = new Date().toISOString();

    await repo.createPlugin({ id: id1, packageName: '@luqen/plugin-scanner-a', type: 'scanner', version: '1.0.0' });
    await repo.createPlugin({ id: id2, packageName: '@luqen/plugin-scanner-b', type: 'scanner', version: '2.0.0' });

    await repo.updatePlugin(id1, { status: 'active', activatedAt });
    await repo.updatePlugin(id2, { status: 'active', activatedAt });

    const p1 = await repo.getPlugin(id1);
    const p2 = await repo.getPlugin(id2);

    expect(p1!.status).toBe('active');
    expect(p2!.status).toBe('active');
  });

  it('listByTypeAndStatus returns both active plugins of same type', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const idInactive = randomUUID();
    const activatedAt = new Date().toISOString();

    await repo.createPlugin({ id: id1, packageName: '@luqen/plugin-scanner-a', type: 'scanner', version: '1.0.0' });
    await repo.createPlugin({ id: id2, packageName: '@luqen/plugin-scanner-b', type: 'scanner', version: '2.0.0' });
    await repo.createPlugin({ id: idInactive, packageName: '@luqen/plugin-scanner-c', type: 'scanner', version: '3.0.0' });

    await repo.updatePlugin(id1, { status: 'active', activatedAt });
    await repo.updatePlugin(id2, { status: 'active', activatedAt });
    // idInactive stays inactive

    const activeScanner = await repo.listByTypeAndStatus('scanner', 'active');
    expect(activeScanner.length).toBe(2);

    const ids = activeScanner.map((p) => p.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).not.toContain(idInactive);
  });

  it('deactivating one does not affect the other', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const activatedAt = new Date().toISOString();

    await repo.createPlugin({ id: id1, packageName: '@luqen/plugin-notify-a', type: 'notification', version: '1.0.0' });
    await repo.createPlugin({ id: id2, packageName: '@luqen/plugin-notify-b', type: 'notification', version: '1.0.0' });

    await repo.updatePlugin(id1, { status: 'active', activatedAt });
    await repo.updatePlugin(id2, { status: 'active', activatedAt });

    // Deactivate only plugin 1
    await repo.updatePlugin(id1, { status: 'inactive', activatedAt: null });

    const p1 = await repo.getPlugin(id1);
    const p2 = await repo.getPlugin(id2);

    expect(p1!.status).toBe('inactive');
    expect(p1!.activatedAt).toBeUndefined();
    expect(p2!.status).toBe('active');
    expect(p2!.activatedAt).toBe(activatedAt);
  });

  it('multiple plugin types can coexist', async () => {
    const authId = randomUUID();
    const notifyId = randomUUID();
    const storageId = randomUUID();
    const scannerId = randomUUID();
    const activatedAt = new Date().toISOString();

    await repo.createPlugin({ id: authId, packageName: '@luqen/plugin-auth', type: 'auth', version: '1.0.0' });
    await repo.createPlugin({ id: notifyId, packageName: '@luqen/plugin-notify', type: 'notification', version: '1.0.0' });
    await repo.createPlugin({ id: storageId, packageName: '@luqen/plugin-storage', type: 'storage', version: '1.0.0' });
    await repo.createPlugin({ id: scannerId, packageName: '@luqen/plugin-scanner', type: 'scanner', version: '1.0.0' });

    // Activate all
    for (const id of [authId, notifyId, storageId, scannerId]) {
      await repo.updatePlugin(id, { status: 'active', activatedAt });
    }

    const activeAuth = await repo.listByTypeAndStatus('auth', 'active');
    const activeNotify = await repo.listByTypeAndStatus('notification', 'active');
    const activeStorage = await repo.listByTypeAndStatus('storage', 'active');
    const activeScanner = await repo.listByTypeAndStatus('scanner', 'active');

    expect(activeAuth.map((p) => p.id)).toContain(authId);
    expect(activeNotify.map((p) => p.id)).toContain(notifyId);
    expect(activeStorage.map((p) => p.id)).toContain(storageId);
    expect(activeScanner.map((p) => p.id)).toContain(scannerId);

    // Each type's list should not bleed into others
    expect(activeAuth.every((p) => p.type === 'auth')).toBe(true);
    expect(activeNotify.every((p) => p.type === 'notification')).toBe(true);
    expect(activeStorage.every((p) => p.type === 'storage')).toBe(true);
    expect(activeScanner.every((p) => p.type === 'scanner')).toBe(true);
  });
});

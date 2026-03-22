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
  error TEXT
);
`;

describe('Plugin Org Behavior', () => {
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

  it('plugins are global -- visible regardless of org context', async () => {
    // Current design: plugins have no orgId column -- they are system-wide.
    // This test documents and verifies that behavior.
    const id1 = randomUUID();
    const id2 = randomUUID();

    await repo.createPlugin({ id: id1, packageName: '@luqen/plugin-a', type: 'auth', version: '1.0.0' });
    await repo.createPlugin({ id: id2, packageName: '@luqen/plugin-b', type: 'notification', version: '1.0.0' });

    const all = await repo.listPlugins();

    // Both plugins are visible in the global list regardless of any org context
    expect(all.length).toBeGreaterThanOrEqual(2);
    const ids = all.map((p) => p.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it('two plugins can be installed with different types', async () => {
    const authId = randomUUID();
    const notifyId = randomUUID();

    await repo.createPlugin({ id: authId, packageName: '@luqen/plugin-auth', type: 'auth', version: '1.0.0' });
    await repo.createPlugin({ id: notifyId, packageName: '@luqen/plugin-notify', type: 'notification', version: '1.0.0' });

    const authPlugin = await repo.getPlugin(authId);
    const notifyPlugin = await repo.getPlugin(notifyId);

    expect(authPlugin).not.toBeNull();
    expect(authPlugin!.type).toBe('auth');

    expect(notifyPlugin).not.toBeNull();
    expect(notifyPlugin!.type).toBe('notification');
  });

  it('activating one plugin does not affect another', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    await repo.createPlugin({ id: id1, packageName: '@luqen/plugin-a', type: 'auth', version: '1.0.0' });
    await repo.createPlugin({ id: id2, packageName: '@luqen/plugin-b', type: 'auth', version: '1.0.0' });

    const activatedAt = new Date().toISOString();
    await repo.updatePlugin(id1, { status: 'active', activatedAt });

    const plugin1 = await repo.getPlugin(id1);
    const plugin2 = await repo.getPlugin(id2);

    expect(plugin1!.status).toBe('active');
    expect(plugin2!.status).toBe('inactive');
  });

  it('deactivating one plugin leaves others active', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const activatedAt = new Date().toISOString();

    await repo.createPlugin({ id: id1, packageName: '@luqen/plugin-a', type: 'scanner', version: '1.0.0', status: 'active' });
    await repo.createPlugin({ id: id2, packageName: '@luqen/plugin-b', type: 'scanner', version: '1.0.0', status: 'active' });

    // Both start active -- set activatedAt
    await repo.updatePlugin(id1, { activatedAt });
    await repo.updatePlugin(id2, { activatedAt });

    // Deactivate only plugin 1
    await repo.updatePlugin(id1, { status: 'inactive', activatedAt: null });

    const plugin1 = await repo.getPlugin(id1);
    const plugin2 = await repo.getPlugin(id2);

    expect(plugin1!.status).toBe('inactive');
    expect(plugin2!.status).toBe('active');
  });

  it('removing one plugin leaves others intact', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const id3 = randomUUID();

    await repo.createPlugin({ id: id1, packageName: '@luqen/plugin-a', type: 'auth', version: '1.0.0' });
    await repo.createPlugin({ id: id2, packageName: '@luqen/plugin-b', type: 'notification', version: '1.0.0' });
    await repo.createPlugin({ id: id3, packageName: '@luqen/plugin-c', type: 'storage', version: '1.0.0' });

    await repo.deletePlugin(id2);

    const all = await repo.listPlugins();
    const ids = all.map((p) => p.id);

    expect(ids).toContain(id1);
    expect(ids).not.toContain(id2);
    expect(ids).toContain(id3);
  });
});

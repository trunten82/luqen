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

describe('Plugin Full Lifecycle (Repository)', () => {
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

  it('install creates record with status=inactive', async () => {
    const id = randomUUID();
    const record = await repo.createPlugin({
      id,
      packageName: '@luqen/plugin-test-auth',
      type: 'auth',
      version: '1.0.0',
    });

    expect(record.id).toBe(id);
    expect(record.status).toBe('inactive');
    expect(record.packageName).toBe('@luqen/plugin-test-auth');
    expect(record.type).toBe('auth');
    expect(record.version).toBe('1.0.0');
    expect(record.installedAt).toBeTruthy();
  });

  it('configure updates config JSON', async () => {
    const id = randomUUID();
    await repo.createPlugin({
      id,
      packageName: '@luqen/plugin-test-auth',
      type: 'auth',
      version: '1.0.0',
    });

    const newConfig = { clientId: 'my-client', apiUrl: 'https://example.com' };
    await repo.updatePlugin(id, { config: newConfig });

    const updated = await repo.getPlugin(id);
    expect(updated).not.toBeNull();
    expect(updated!.config.clientId).toBe('my-client');
    expect(updated!.config.apiUrl).toBe('https://example.com');
  });

  it('activate sets status=active and activatedAt', async () => {
    const id = randomUUID();
    await repo.createPlugin({
      id,
      packageName: '@luqen/plugin-test-auth',
      type: 'auth',
      version: '1.0.0',
    });

    const activatedAt = new Date().toISOString();
    await repo.updatePlugin(id, { status: 'active', activatedAt });

    const record = await repo.getPlugin(id);
    expect(record).not.toBeNull();
    expect(record!.status).toBe('active');
    expect(record!.activatedAt).toBe(activatedAt);
  });

  it('deactivate sets status=inactive and clears activatedAt', async () => {
    const id = randomUUID();
    await repo.createPlugin({
      id,
      packageName: '@luqen/plugin-test-auth',
      type: 'auth',
      version: '1.0.0',
      status: 'active',
    });

    await repo.updatePlugin(id, { status: 'inactive', activatedAt: null });

    const record = await repo.getPlugin(id);
    expect(record).not.toBeNull();
    expect(record!.status).toBe('inactive');
    expect(record!.activatedAt).toBeUndefined();
  });

  it('remove deletes record completely', async () => {
    const id = randomUUID();
    await repo.createPlugin({
      id,
      packageName: '@luqen/plugin-test-notify',
      type: 'notification',
      version: '2.0.0',
    });

    const before = await repo.getPlugin(id);
    expect(before).not.toBeNull();

    await repo.deletePlugin(id);

    const after = await repo.getPlugin(id);
    expect(after).toBeNull();
  });

  it('after remove: getPlugin returns null', async () => {
    const id = randomUUID();
    await repo.createPlugin({
      id,
      packageName: '@luqen/plugin-test-storage',
      type: 'storage',
      version: '1.0.0',
    });

    await repo.deletePlugin(id);

    const result = await repo.getPlugin(id);
    expect(result).toBeNull();
  });

  it('full cycle: install -> configure -> activate -> deactivate -> remove leaves no trace', async () => {
    const id = randomUUID();

    // Install
    const installed = await repo.createPlugin({
      id,
      packageName: '@luqen/plugin-test-auth',
      type: 'auth',
      version: '1.0.0',
    });
    expect(installed.status).toBe('inactive');

    // Configure
    await repo.updatePlugin(id, { config: { clientId: 'abc', secret: 'xyz' } });
    const configured = await repo.getPlugin(id);
    expect(configured!.config.clientId).toBe('abc');

    // Activate
    const activatedAt = new Date().toISOString();
    await repo.updatePlugin(id, { status: 'active', activatedAt });
    const activated = await repo.getPlugin(id);
    expect(activated!.status).toBe('active');
    expect(activated!.activatedAt).toBe(activatedAt);

    // Deactivate
    await repo.updatePlugin(id, { status: 'inactive', activatedAt: null });
    const deactivated = await repo.getPlugin(id);
    expect(deactivated!.status).toBe('inactive');
    expect(deactivated!.activatedAt).toBeUndefined();

    // Remove
    await repo.deletePlugin(id);
    const removed = await repo.getPlugin(id);
    expect(removed).toBeNull();

    // Verify list does not contain the plugin
    const all = await repo.listPlugins();
    expect(all.find((p) => p.id === id)).toBeUndefined();
  });
});

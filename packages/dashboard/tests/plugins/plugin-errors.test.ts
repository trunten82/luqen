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

describe('Plugin Error Handling', () => {
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

  it('setting status to error stores error message', async () => {
    const id = randomUUID();
    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'auth', version: '1.0.0' });

    await repo.updatePlugin(id, { status: 'error', error: 'Connection refused on port 5432' });

    const record = await repo.getPlugin(id);
    expect(record!.status).toBe('error');
    expect(record!.error).toBe('Connection refused on port 5432');
  });

  it('setting status to unhealthy after health failures', async () => {
    const id = randomUUID();
    const activatedAt = new Date().toISOString();
    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'scanner', version: '1.0.0', status: 'active' });
    await repo.updatePlugin(id, { activatedAt });

    await repo.updatePlugin(id, { status: 'unhealthy', error: 'Health check failed 3 times consecutively' });

    const record = await repo.getPlugin(id);
    expect(record!.status).toBe('unhealthy');
    expect(record!.error).toContain('Health check failed');
  });

  it('clearing error message on reactivation', async () => {
    const id = randomUUID();
    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'auth', version: '1.0.0', status: 'error' });
    await repo.updatePlugin(id, { error: 'Previous activation error' });

    // Reactivate: set active and clear error
    const activatedAt = new Date().toISOString();
    await repo.updatePlugin(id, { status: 'active', activatedAt, error: null });

    const record = await repo.getPlugin(id);
    expect(record!.status).toBe('active');
    expect(record!.error).toBeUndefined();
  });

  it('error field is null when no error', async () => {
    const id = randomUUID();
    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'notification', version: '1.0.0' });

    const record = await repo.getPlugin(id);
    // rowToRecord omits error key when row.error is null
    expect(record!.error).toBeUndefined();

    // Also verify via raw DB row
    const row = db.prepare('SELECT error FROM plugins WHERE id = ?').get(id) as { error: string | null };
    expect(row.error).toBeNull();
  });

  it('can transition from error back to active', async () => {
    const id = randomUUID();
    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'auth', version: '1.0.0' });

    // Move to error
    await repo.updatePlugin(id, { status: 'error', error: 'Startup failed' });
    const errored = await repo.getPlugin(id);
    expect(errored!.status).toBe('error');

    // Recover to active
    const activatedAt = new Date().toISOString();
    await repo.updatePlugin(id, { status: 'active', activatedAt, error: null });
    const recovered = await repo.getPlugin(id);
    expect(recovered!.status).toBe('active');
    expect(recovered!.activatedAt).toBe(activatedAt);
    expect(recovered!.error).toBeUndefined();
  });

  it('can transition from unhealthy back to active', async () => {
    const id = randomUUID();
    const activatedAt = new Date().toISOString();
    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'scanner', version: '1.0.0', status: 'active' });
    await repo.updatePlugin(id, { activatedAt });

    // Become unhealthy
    await repo.updatePlugin(id, { status: 'unhealthy', error: 'Repeated health failures' });
    const unhealthy = await repo.getPlugin(id);
    expect(unhealthy!.status).toBe('unhealthy');

    // Recover
    const reactivatedAt = new Date().toISOString();
    await repo.updatePlugin(id, { status: 'active', activatedAt: reactivatedAt, error: null });
    const reactivated = await repo.getPlugin(id);
    expect(reactivated!.status).toBe('active');
    expect(reactivated!.error).toBeUndefined();
  });
});

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

describe('Plugin Configuration', () => {
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

  it('config stored as JSON string in DB', async () => {
    const id = randomUUID();
    const config = { apiKey: 'key-123', baseUrl: 'https://api.example.com' };

    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'notification', version: '1.0.0', config });

    // Read raw row from DB to confirm JSON serialization
    const row = db.prepare('SELECT config FROM plugins WHERE id = ?').get(id) as { config: string };
    expect(typeof row.config).toBe('string');

    const parsed = JSON.parse(row.config) as Record<string, unknown>;
    expect(parsed.apiKey).toBe('key-123');
    expect(parsed.baseUrl).toBe('https://api.example.com');
  });

  it('config can be updated without changing status', async () => {
    const id = randomUUID();
    await repo.createPlugin({
      id,
      packageName: '@luqen/plugin-test',
      type: 'notification',
      version: '1.0.0',
      status: 'active',
    });

    await repo.updatePlugin(id, { config: { newKey: 'newValue' } });

    const record = await repo.getPlugin(id);
    expect(record!.config.newKey).toBe('newValue');
    // Status must remain unchanged
    expect(record!.status).toBe('active');
  });

  it('empty config defaults to {}', async () => {
    const id = randomUUID();
    // No config provided
    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'auth', version: '1.0.0' });

    const record = await repo.getPlugin(id);
    expect(record!.config).toEqual({});
  });

  it('config with nested objects preserved', async () => {
    const id = randomUUID();
    const config = {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        tls: { rejectUnauthorized: true },
      },
      retries: 3,
      tags: ['urgent', 'system'],
    };

    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'notification', version: '1.0.0', config });

    const record = await repo.getPlugin(id);
    expect(record!.config).toEqual(config);
    expect((record!.config.smtp as Record<string, unknown>)?.host).toBe('smtp.example.com');
    expect((record!.config.smtp as Record<string, unknown>)?.port).toBe(587);
    expect(((record!.config.smtp as Record<string, unknown>)?.tls as Record<string, unknown>)?.rejectUnauthorized).toBe(true);
    expect(record!.config.tags).toEqual(['urgent', 'system']);
  });

  it('updatePlugin with only config field does not affect status or error', async () => {
    const id = randomUUID();
    const activatedAt = new Date().toISOString();

    await repo.createPlugin({ id, packageName: '@luqen/plugin-test', type: 'auth', version: '1.0.0', status: 'active' });
    await repo.updatePlugin(id, { activatedAt, error: null });

    // Now update only config
    await repo.updatePlugin(id, { config: { updated: true } });

    const record = await repo.getPlugin(id);
    // Status remains active
    expect(record!.status).toBe('active');
    // Error remains absent
    expect(record!.error).toBeUndefined();
    // Config was updated
    expect(record!.config.updated).toBe(true);
  });
});

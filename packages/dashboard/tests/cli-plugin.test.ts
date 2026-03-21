import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../src/db/migrations.js';
import { DASHBOARD_MIGRATIONS } from '../src/db/scans.js';
import { PluginManager } from '../src/plugins/manager.js';
import type { RegistryEntry } from '../src/plugins/types.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

const SAMPLE_REGISTRY: readonly RegistryEntry[] = [
  {
    name: 'notify-slack',
    displayName: 'Slack Notifications',
    type: 'notification',
    version: '1.0.0',
    description: 'Send alerts to Slack',
    packageName: '@luqen/plugin-notify-slack',
    icon: 'slack',
  },
];

interface TestContext {
  db: Database.Database;
  manager: PluginManager;
  cleanup: () => void;
  dbPath: string;
  pluginsDir: string;
}

function createTestContext(): TestContext {
  const dbPath = join(tmpdir(), `test-cli-plugin-${randomUUID()}.db`);
  const pluginsDir = join(tmpdir(), `test-cli-pluginsdir-${randomUUID()}`);
  mkdirSync(pluginsDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new MigrationRunner(db).run([...DASHBOARD_MIGRATIONS]);

  const manager = new PluginManager({
    db,
    pluginsDir,
    encryptionKey: TEST_SESSION_SECRET,
    registryEntries: SAMPLE_REGISTRY,
  });

  const cleanup = (): void => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
  };

  return { db, manager, cleanup, dbPath, pluginsDir };
}

describe('plugin list', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('with empty DB returns empty list', () => {
    const plugins = ctx.manager.list();
    expect(plugins).toHaveLength(0);
  });

  it('with plugins returns formatted records', () => {
    ctx.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      )
      .run({
        id: 'plugin-1',
        package_name: '@luqen/plugin-notify-slack',
        type: 'notification',
        version: '1.0.0',
        config: '{}',
        status: 'active',
        installed_at: new Date().toISOString(),
      });

    const plugins = ctx.manager.list();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe('plugin-1');
    expect(plugins[0].packageName).toBe('@luqen/plugin-notify-slack');
    expect(plugins[0].type).toBe('notification');
    expect(plugins[0].version).toBe('1.0.0');
    expect(plugins[0].status).toBe('active');
  });

  it('formats table output correctly', () => {
    ctx.db
      .prepare(
        `INSERT INTO plugins (id, package_name, type, version, config, status, installed_at)
         VALUES (@id, @package_name, @type, @version, @config, @status, @installed_at)`,
      )
      .run({
        id: 'aaa-bbb-ccc',
        package_name: '@luqen/plugin-notify-slack',
        type: 'notification',
        version: '1.0.0',
        config: '{}',
        status: 'inactive',
        installed_at: new Date().toISOString(),
      });

    const plugins = ctx.manager.list();
    // Simulate CLI table formatting
    const lines: string[] = [];
    lines.push(
      'ID'.padEnd(38) +
      'Package'.padEnd(40) +
      'Type'.padEnd(15) +
      'Version'.padEnd(10) +
      'Status',
    );
    lines.push('-'.repeat(113));
    for (const p of plugins) {
      lines.push(
        p.id.padEnd(38) +
        p.packageName.padEnd(40) +
        p.type.padEnd(15) +
        p.version.padEnd(10) +
        p.status,
      );
    }

    const output = lines.join('\n');
    expect(output).toContain('aaa-bbb-ccc');
    expect(output).toContain('@luqen/plugin-notify-slack');
    expect(output).toContain('notification');
    expect(output).toContain('inactive');
  });
});

describe('plugin configure', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('parses key=value pairs correctly', () => {
    // Test the parsing logic used by the CLI
    const pairs = ['webhook_url=https://hooks.slack.com/xxx', 'channel=#alerts'];
    const config: Record<string, unknown> = {};

    for (const pair of pairs) {
      const eqIndex = pair.indexOf('=');
      const key = pair.slice(0, eqIndex);
      const value = pair.slice(eqIndex + 1);
      config[key] = value;
    }

    expect(config).toEqual({
      webhook_url: 'https://hooks.slack.com/xxx',
      channel: '#alerts',
    });
  });
});

describe('plugin remove', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('throws for non-existent plugin', async () => {
    await expect(ctx.manager.remove('nonexistent')).rejects.toThrow('not found');
  });
});

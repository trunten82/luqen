import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveEnvVars, reconcile } from '../../src/plugins/reconciler.js';
import type { PluginManager } from '../../src/plugins/manager.js';
import type { PluginRecord } from '../../src/plugins/types.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// resolveEnvVars
// ---------------------------------------------------------------------------

describe('resolveEnvVars', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('replaces ${VAR} with env value', () => {
    process.env.MY_SECRET = 'hunter2';
    const result = resolveEnvVars({ key: '${MY_SECRET}' });
    expect(result).toEqual({ key: 'hunter2' });
  });

  it('leaves non-env strings unchanged', () => {
    const result = resolveEnvVars({ key: 'plain-value', num: 42, flag: true });
    expect(result).toEqual({ key: 'plain-value', num: 42, flag: true });
  });

  it('handles nested objects', () => {
    process.env.NESTED_VAR = 'deep-value';
    const result = resolveEnvVars({
      top: 'static',
      nested: {
        inner: '${NESTED_VAR}',
        num: 100,
      },
    });
    expect(result).toEqual({
      top: 'static',
      nested: {
        inner: 'deep-value',
        num: 100,
      },
    });
  });

  it('replaces undefined env vars with empty string and warns', () => {
    delete process.env.UNDEFINED_VAR;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = resolveEnvVars({ key: '${UNDEFINED_VAR}' });

    expect(result).toEqual({ key: '' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('UNDEFINED_VAR'),
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

describe('reconcile', () => {
  let tmpDir: string;

  function makePluginRecord(overrides: Partial<PluginRecord> & { id: string; packageName: string }): PluginRecord {
    return {
      type: 'auth',
      version: '1.0.0',
      config: {},
      status: 'inactive',
      installedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function createMockManager(opts?: {
    existingPlugins?: PluginRecord[];
    installThrows?: string[];
  }) {
    const installed = new Map<string, PluginRecord>();
    for (const p of opts?.existingPlugins ?? []) {
      installed.set(p.packageName, p);
    }

    const manager = {
      list: vi.fn(() => [...installed.values()]),
      install: vi.fn(async (packageName: string) => {
        if (opts?.installThrows?.includes(packageName)) {
          throw new Error(`Install failed for ${packageName}`);
        }
        const record = makePluginRecord({
          id: `id-${packageName}`,
          packageName,
        });
        installed.set(packageName, record);
        return record;
      }),
      configure: vi.fn(async (id: string, _config: Record<string, unknown>) => {
        const rec = [...installed.values()].find((r) => r.id === id);
        return rec ?? makePluginRecord({ id, packageName: 'unknown' });
      }),
      activate: vi.fn(async (id: string) => {
        const rec = [...installed.values()].find((r) => r.id === id);
        if (rec) {
          const activated: PluginRecord = { ...rec, status: 'active', activatedAt: new Date().toISOString() };
          installed.set(rec.packageName, activated);
          return activated;
        }
        return makePluginRecord({ id, packageName: 'unknown', status: 'active' });
      }),
      getPlugin: vi.fn((id: string) => {
        return [...installed.values()].find((r) => r.id === id) ?? null;
      }),
    } as unknown as PluginManager;

    return manager;
  }

  beforeEach(() => {
    tmpDir = join(tmpdir(), `reconciler-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(plugins: Array<{ name: string; config?: Record<string, unknown>; active?: boolean }>) {
    const configPath = join(tmpDir, 'pally-plugins.json');
    writeFileSync(configPath, JSON.stringify({ plugins }));
    return configPath;
  }

  it('installs missing plugins', async () => {
    const configPath = writeConfig([
      { name: '@pally/plugin-auth', config: { tenantId: 'abc' }, active: false },
    ]);

    const manager = createMockManager();
    const result = await reconcile(manager, configPath);

    expect(result.installed).toContain('@pally/plugin-auth');
    expect(result.errors).toHaveLength(0);
    expect((manager.install as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('@pally/plugin-auth');
  });

  it('activates plugins marked active', async () => {
    const configPath = writeConfig([
      { name: '@pally/plugin-notify', config: {}, active: true },
    ]);

    const manager = createMockManager();
    const result = await reconcile(manager, configPath);

    expect(result.activated).toContain('@pally/plugin-notify');
    expect((manager.activate as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('skips already-installed plugins', async () => {
    const existing = makePluginRecord({
      id: 'existing-id',
      packageName: '@pally/plugin-auth',
    });
    const configPath = writeConfig([
      { name: '@pally/plugin-auth', config: { key: 'val' }, active: false },
    ]);

    const manager = createMockManager({ existingPlugins: [existing] });
    const result = await reconcile(manager, configPath);

    expect(result.installed).not.toContain('@pally/plugin-auth');
    expect((manager.install as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    // But configure should still be called
    expect(result.configured).toContain('@pally/plugin-auth');
  });

  it('returns error for failed installs', async () => {
    const configPath = writeConfig([
      { name: '@pally/plugin-bad', config: {}, active: true },
    ]);

    const manager = createMockManager({ installThrows: ['@pally/plugin-bad'] });
    const result = await reconcile(manager, configPath);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('@pally/plugin-bad');
    expect(result.installed).not.toContain('@pally/plugin-bad');
    expect(result.activated).not.toContain('@pally/plugin-bad');
  });
});

/**
 * PBH-A Task 1 — config.encryptionKey: env, file, defaulting, validation.
 *
 * The at-rest AES key for plugin secrets, service-connection secrets, git
 * tokens and OAuth signing private keys is being split off from
 * sessionSecret (session cookie sealing only). See
 * .planning/quick/260928-pbh-split-dashboard-encryption-key-and-reenc/260928-pbh-PLAN.md
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  loadConfig,
  validateConfig,
  withEncryptionKeyDefault,
  sharesSessionSecret,
  serverPluginsDir,
  type DashboardConfig,
} from '../src/config.js';

const ENV_KEYS = ['DASHBOARD_ENCRYPTION_KEY', 'DASHBOARD_SESSION_SECRET'] as const;
const NONEXISTENT = '/nonexistent/luqen-config.json';

function cleanEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe('config: encryptionKey (PBH-A)', () => {
  afterEach(cleanEnv);

  it('CFG-1: neither env nor file encryptionKey -> encryptionKey === sessionSecret', () => {
    cleanEnv();
    process.env['DASHBOARD_SESSION_SECRET'] = 'a'.repeat(32);
    const config = loadConfig(NONEXISTENT);
    expect(config.encryptionKey).toBe(config.sessionSecret);
  });

  it('CFG-2: DASHBOARD_ENCRYPTION_KEY set (>=32) -> used, distinct from sessionSecret', () => {
    cleanEnv();
    process.env['DASHBOARD_SESSION_SECRET'] = 'a'.repeat(32);
    process.env['DASHBOARD_ENCRYPTION_KEY'] = 'b'.repeat(32);
    const config = loadConfig(NONEXISTENT);
    expect(config.encryptionKey).toBe('b'.repeat(32));
    expect(config.encryptionKey).not.toBe(config.sessionSecret);
  });

  it('CFG-3: config file encryptionKey passes strict schema and is used; env overrides file', () => {
    cleanEnv();
    const dir = mkdtempSync(join(tmpdir(), 'luqen-cfg3-'));
    try {
      const filePath = join(dir, 'dashboard.config.json');
      const fileKey = 'c'.repeat(40);
      writeFileSync(
        filePath,
        JSON.stringify({ sessionSecret: 'a'.repeat(32), encryptionKey: fileKey }),
      );

      const config = loadConfig(filePath);
      expect(config.encryptionKey).toBe(fileKey);

      process.env['DASHBOARD_ENCRYPTION_KEY'] = 'd'.repeat(32);
      const config2 = loadConfig(filePath);
      expect(config2.encryptionKey).toBe('d'.repeat(32));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CFG-4: DASHBOARD_ENCRYPTION_KEY="" -> treated as unset -> equals sessionSecret (DEC-5)', () => {
    cleanEnv();
    process.env['DASHBOARD_SESSION_SECRET'] = 'a'.repeat(32);
    process.env['DASHBOARD_ENCRYPTION_KEY'] = '';
    const config = loadConfig(NONEXISTENT);
    expect(config.encryptionKey).toBe(config.sessionSecret);
  });

  it('CFG-5: explicit encryptionKey of 31 chars -> validateConfig throws naming DASHBOARD_ENCRYPTION_KEY, never the value', () => {
    cleanEnv();
    const dir = mkdtempSync(join(tmpdir(), 'luqen-cfg5-'));
    try {
      const shortKey = 'e'.repeat(31);
      process.env['DASHBOARD_SESSION_SECRET'] = 'a'.repeat(32);
      process.env['DASHBOARD_ENCRYPTION_KEY'] = shortKey;
      const config = loadConfig(join(dir, 'dashboard.config.json'));

      let thrown: unknown;
      try {
        validateConfig(config);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain('DASHBOARD_ENCRYPTION_KEY');
      expect(message).not.toContain(shortKey);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CFG-6: withEncryptionKeyDefault defaults a missing field, keeps a set field, never mutates the input', () => {
    const withoutField = { sessionSecret: 'a'.repeat(32) } as DashboardConfig;
    const result = withEncryptionKeyDefault(withoutField);
    expect(result.encryptionKey).toBe('a'.repeat(32));
    expect((withoutField as unknown as { encryptionKey?: string }).encryptionKey).toBeUndefined();
    expect(result).not.toBe(withoutField);

    const withField = {
      sessionSecret: 'a'.repeat(32),
      encryptionKey: 'b'.repeat(32),
    } as DashboardConfig;
    const result2 = withEncryptionKeyDefault(withField);
    expect(result2.encryptionKey).toBe('b'.repeat(32));
    expect((withField as unknown as { encryptionKey?: string }).encryptionKey).toBe('b'.repeat(32));
  });

  it('CFG-7: sharesSessionSecret true when equal (defaulted or pinned-equal), false when distinct', () => {
    cleanEnv();
    process.env['DASHBOARD_SESSION_SECRET'] = 'a'.repeat(32);
    const defaulted = loadConfig(NONEXISTENT);
    expect(sharesSessionSecret(defaulted)).toBe(true);

    process.env['DASHBOARD_ENCRYPTION_KEY'] = 'b'.repeat(32);
    const distinct = loadConfig(NONEXISTENT);
    expect(sharesSessionSecret(distinct)).toBe(false);

    process.env['DASHBOARD_ENCRYPTION_KEY'] = 'a'.repeat(32);
    const pinnedEqual = loadConfig(NONEXISTENT);
    expect(sharesSessionSecret(pinnedEqual)).toBe(true);
  });

  it('CFG-8 (plan-check addition): applyEnvOverrides\' own empty-string guard, isolated from withEncryptionKeyDefault\'s', () => {
    // Task 1's BT-3 found that CFG-4 alone cannot distinguish
    // applyEnvOverrides' empty-string guard from withEncryptionKeyDefault's:
    // both DEFAULTS.encryptionKey and an env override of '' land on the same
    // value ('', which is also DEFAULTS.encryptionKey), so removing the
    // FIRST guard is silently masked by the SECOND. This test forces them
    // apart: a config FILE sets a real, non-sessionSecret encryptionKey, and
    // the env var is set to ''. If applyEnvOverrides' guard is in place, the
    // file value survives untouched (env='' is treated as "no override").
    // If it is removed, '' briefly overwrites config.encryptionKey inside
    // applyEnvOverrides, and withEncryptionKeyDefault then defaults THAT to
    // sessionSecret — losing the file-set value. The two guards produce
    // different observable results here, where CFG-4 alone could not.
    cleanEnv();
    const dir = mkdtempSync(join(tmpdir(), 'luqen-cfg8-'));
    try {
      const filePath = join(dir, 'dashboard.config.json');
      const sessionSecret = 'a'.repeat(32);
      const fileEncryptionKey = 'f'.repeat(40);
      writeFileSync(filePath, JSON.stringify({ sessionSecret, encryptionKey: fileEncryptionKey }));

      process.env['DASHBOARD_ENCRYPTION_KEY'] = '';
      const config = loadConfig(filePath);

      expect(config.encryptionKey).toBe(fileEncryptionKey);
      expect(config.encryptionKey).not.toBe(sessionSecret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serverPluginsDir derives reportsDir/../plugins (matches the server.ts derivation it replaces)', () => {
    const config = { reportsDir: '/tmp/luqen-foo/reports' } as DashboardConfig;
    expect(serverPluginsDir(config)).toBe(resolve('/tmp/luqen-foo/reports', '..', 'plugins'));
  });
});

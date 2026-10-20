import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, validateConfig } from '../src/config.js';
import { DEFAULT_TRUSTED_PROXIES, resolveTrustedProxies } from '../src/auth/trusted-proxies.js';

const ENV_KEY = 'DASHBOARD_TRUSTED_PROXIES';
const NONEXISTENT = '/nonexistent/luqen-config.json';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('trusted proxy setting', () => {
  it('HARD-21 the trusted proxy setting defaults to the loopback and private network ranges', () => {
    delete process.env[ENV_KEY];
    const unset = loadConfig(NONEXISTENT);
    expect(unset.trustedProxies).toBeUndefined();
    expect(resolveTrustedProxies(unset.trustedProxies)).toEqual(['loopback', 'linklocal', 'uniquelocal']);
    expect([...DEFAULT_TRUSTED_PROXIES]).toEqual(['loopback', 'linklocal', 'uniquelocal']);

    process.env[ENV_KEY] = ' 198.51.100.0/24 , loopback ';
    const listed = loadConfig(NONEXISTENT);
    expect(listed.trustedProxies).toEqual(['198.51.100.0/24', 'loopback']);
    // A configured list replaces the default.
    expect(resolveTrustedProxies(listed.trustedProxies)).toEqual(['198.51.100.0/24', 'loopback']);

    process.env[ENV_KEY] = '';
    expect(loadConfig(NONEXISTENT).trustedProxies).toBeUndefined();

    process.env[ENV_KEY] = 'none';
    const none = loadConfig(NONEXISTENT);
    expect(resolveTrustedProxies(none.trustedProxies)).toBe(false);
  });

  it('HARD-21 the trusted proxy setting refuses to trust every address', () => {
    for (const entry of ['true', '*', '0.0.0.0/0', '::/0', '2', 'not-an-address']) {
      process.env[ENV_KEY] = entry;
      const config = loadConfig(NONEXISTENT);
      expect(() => resolveTrustedProxies(config.trustedProxies), entry).toThrow(entry);
    }
    // Refused at startup: the config check that runs before the server listens names the entry.
    const dir = mkdtempSync(join(tmpdir(), 'luqen-trusted-proxies-'));
    try {
      process.env[ENV_KEY] = '0.0.0.0/0';
      const config = {
        ...loadConfig(NONEXISTENT), sessionSecret: 's'.repeat(32), encryptionKey: 's'.repeat(32),
        reportsDir: join(dir, 'reports'), pluginsDir: join(dir, 'plugins'), dbPath: join(dir, 'dashboard.db'),
      };
      expect(() => validateConfig(config)).toThrow('0.0.0.0/0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

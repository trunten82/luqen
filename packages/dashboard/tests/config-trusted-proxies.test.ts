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

/** Runs `check` with a config whose trustedProxies is `list`, in a throw-away directory. */
function withListConfig(list: readonly string[], check: (config: ReturnType<typeof loadConfig>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'luqen-trusted-proxies-list-'));
  try {
    const config = {
      ...loadConfig(NONEXISTENT), sessionSecret: 's'.repeat(32), encryptionKey: 's'.repeat(32),
      reportsDir: join(dir, 'reports'), pluginsDir: join(dir, 'plugins'), dbPath: join(dir, 'dashboard.db'),
      trustedProxies: [...list],
    };
    check(config);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The 25-style catch-all pair: every IPv4 address except one /8, written with documentation-neutral blocks. */
const ALL_BUT_ONE_BLOCK = ['0.0.0.0/5', '8.0.0.0/7', '11.0.0.0/8', '12.0.0.0/6', '16.0.0.0/4', '32.0.0.0/3', '64.0.0.0/2', '128.0.0.0/1'];

describe('trusted proxy coverage', () => {
  it('HARD-21 the trusted proxy setting refuses lists that together trust every address', () => {
    const covering: ReadonlyArray<readonly string[]> = [
      ['::ffff:0:0/96'],
      ['::/64'],
      ['::/80'],
      ['0.0.0.0/1', '128.0.0.0/1'],
      ['::ffff:0.0.0.0/97', '::ffff:128.0.0.0/97'],
      ['::/1', '8000::/1'],
    ];
    for (const list of covering) {
      const named = list.join(', ');
      expect(() => resolveTrustedProxies(list), named).toThrow(named);
      withListConfig(list, (config) => {
        expect(() => validateConfig(config), named).toThrow(named);
      });
    }
  });

  it('HARD-21 the trusted proxy setting accepts lists that leave addresses untrusted', () => {
    const fine: ReadonlyArray<readonly string[]> = [
      [...DEFAULT_TRUSTED_PROXIES],
      ['0.0.0.0/1', '128.0.0.0/2'],
      ['::ffff:0.0.0.0/97'],
      ['2001:db8::/33', '2001:db8:8000::/33'],
      ['loopback', 'linklocal', 'uniquelocal', '198.51.100.0/24', '2001:db8::/32'],
    ];
    for (const list of fine) {
      expect(resolveTrustedProxies(list), list.join(', ')).toEqual(list);
      withListConfig(list, (config) => {
        expect(() => validateConfig(config), list.join(', ')).not.toThrow();
      });
    }
  });

  it('HARD-21 the trusted proxy setting counts named ranges toward every address', () => {
    const withNamed = [...ALL_BUT_ONE_BLOCK, 'uniquelocal'];

    expect(() => resolveTrustedProxies(withNamed)).toThrow(withNamed.join(', '));
    expect(resolveTrustedProxies(ALL_BUT_ONE_BLOCK)).toEqual(ALL_BUT_ONE_BLOCK);
  });
});

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

/** Every IPv4 address except one private-use /8, as eight CIDR blocks. */
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
});

/**
 * A list with the size and shape of a large CDN's published ranges: the three default names, 15 IPv4
 * ranges and 7 IPv6 ranges, laid out from numbers only (largest first, so every range is aligned):
 * 1,524,736 IPv4 addresses from a public base and 14 x 2^96 IPv6 addresses from a documentation base.
 */
const CDN_V4_PREFIXES = [13, 13, 14, 15, 17, 18, 18, 20, 20, 20, 22, 22, 22, 22, 22];
const CDN_V6_PREFIXES = [29, 32, 32, 32, 32, 32, 32];

function packRanges(prefixes: readonly number[], base: bigint, width: bigint): bigint[] {
  const starts: bigint[] = [];
  let next = base;
  for (const prefix of prefixes) {
    starts.push(next);
    next += 1n << (width - BigInt(prefix));
  }
  return starts;
}

function dotted(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join('.');
}

function colons(value: bigint): string {
  return [112n, 96n, 80n, 64n, 48n, 32n, 16n, 0n].map((shift) => ((value >> shift) & 0xffffn).toString(16)).join(':');
}

const CDN_SIZED_LIST: readonly string[] = [
  ...DEFAULT_TRUSTED_PROXIES,
  ...packRanges(CDN_V4_PREFIXES, BigInt(64 * 2 ** 24), 32n).map((start, i) => `${dotted(start)}/${CDN_V4_PREFIXES[i]}`),
  ...packRanges(CDN_V6_PREFIXES, 0x3fffn << 112n, 128n).map((start, i) => `${colons(start)}/${CDN_V6_PREFIXES[i]}`),
];

/** Runs `refused` over both entry points: the resolver and the startup config check. */
function expectRefused(list: readonly string[], family: string): void {
  const named = list.join(', ');
  for (const attempt of [
    (): unknown => resolveTrustedProxies(list),
    (): unknown => withListConfig(list, (config) => { validateConfig(config); }),
  ]) {
    let message = '';
    try {
      attempt();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message, named).toContain(named);
    expect(message, named).toContain(family);
  }
}

describe('trusted proxy public address space', () => {
  it('HARD-21 the trusted proxy setting refuses lists that trust more than one block of public IPv4 addresses', () => {
    const wide: ReadonlyArray<readonly string[]> = [
      ['0.0.0.0/1', '128.0.0.0/2', '192.0.0.0/3'],
      ALL_BUT_ONE_BLOCK,
      [...ALL_BUT_ONE_BLOCK, 'uniquelocal'],
      ['0.0.0.0/1', '128.0.0.0/2'],
      ['::ffff:0.0.0.0/97'],
      ['11.0.0.0/8', '12.0.0.0/32'],
    ];
    for (const list of wide) expectRefused(list, 'public IPv4');
  });

  it('HARD-21 the trusted proxy setting refuses lists that trust more than one block of global IPv6 addresses', () => {
    const wide: ReadonlyArray<readonly string[]> = [
      ['2000::/3'],
      ['loopback', 'linklocal', 'uniquelocal', '2000::/3'],
      ['3fff::/16', '2001:db8::/128'],
    ];
    for (const list of wide) expectRefused(list, 'global IPv6');
  });

  it('HARD-21 the trusted proxy setting accepts the default list and a CDN sized list', () => {
    // Control: the sizes the generator was built to, so the accepted list is as large as it claims.
    expect(CDN_SIZED_LIST).toHaveLength(3 + 15 + 7);
    const v4 = CDN_V4_PREFIXES.reduce((sum, prefix) => sum + (1 << (32 - prefix)), 0);
    expect(v4).toBe(1_524_736);

    const fine: ReadonlyArray<readonly string[]> = [
      [...DEFAULT_TRUSTED_PROXIES],
      CDN_SIZED_LIST,
      ['11.0.0.0/8'],
      ['3fff::/16'],
      ['loopback', 'linklocal', 'uniquelocal', '224.0.0.0/4', 'fc00::/7', 'fe80::/10', '::1'],
    ];
    for (const list of fine) {
      expect(resolveTrustedProxies(list), list.join(', ')).toEqual(list);
      withListConfig(list, (config) => {
        expect(() => validateConfig(config), list.join(', ')).not.toThrow();
      });
    }
  });
});

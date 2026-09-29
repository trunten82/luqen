/**
 * START-URL-DNS-1 — the dashboard's start-URL check must resolve DNS.
 *
 * Before this fix `validateScanUrl` was a string-only check: a PUBLIC hostname
 * whose DNS answer was loopback / RFC 1918 / CGNAT / an IPv4-mapped loopback
 * passed, and pa11y then scanned the internal target. These tests inject the
 * resolver (no real DNS) and pin that every such answer is refused with the
 * same user-facing message as a private-literal rejection.
 */
import { describe, it, expect, vi } from 'vitest';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';
import {
  isPrivateHostname,
  validateScanUrl,
  ScanService,
  PRIVATE_TARGET_ERROR,
} from '../../src/services/scan-service.js';

const resolvesTo = (...addresses: string[]) =>
  vi.fn(async (_hostname: string): Promise<readonly string[]> => addresses);

const failingResolver = vi.fn(async (_hostname: string): Promise<readonly string[]> => {
  throw new Error('getaddrinfo ENOTFOUND no-such-host.example');
});

describe('validateScanUrl — DNS resolution (START-URL-DNS-1)', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['192.168.100.50', 'RFC 1918'],
    ['10.1.2.3', 'RFC 1918'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['100.64.0.1', 'CGNAT 100.64/10'],
    ['169.254.169.254', 'cloud metadata'],
    ['fd00::1', 'IPv6 unique-local'],
  ])('refuses a public hostname that resolves to %s (%s)', async (address) => {
    const resolve = resolvesTo(address);
    const result = await validateScanUrl('https://rebind.example/', false, resolve);
    expect(result).toEqual({ error: PRIVATE_TARGET_ERROR });
    expect(resolve).toHaveBeenCalledWith('rebind.example');
  });

  it('refuses when ANY resolved address is private (mixed answer)', async () => {
    const result = await validateScanUrl('https://mixed.example/', false, resolvesTo('93.184.215.14', '127.0.0.1'));
    expect(result).toEqual({ error: PRIVATE_TARGET_ERROR });
  });

  it('accepts a hostname that resolves only to public addresses', async () => {
    const resolve = resolvesTo('93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c');
    const result = await validateScanUrl('https://public.example/path', false, resolve);
    expect('url' in result).toBe(true);
    if ('url' in result) expect(result.url.hostname).toBe('public.example');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('refuses when DNS resolution fails (fail closed) with the not-found message', async () => {
    const result = await validateScanUrl('https://no-such-host.example/', false, failingResolver);
    expect(result).toEqual({ error: 'Domain not found — check the URL for typos.' });
  });

  it('refuses when DNS returns no addresses (fail closed)', async () => {
    const result = await validateScanUrl('https://empty.example/', false, resolvesTo());
    expect(result).toEqual({ error: 'Domain not found — check the URL for typos.' });
  });

  it('allowPrivateScanTargets opt-out: a privately-resolving host is accepted and DNS is not consulted', async () => {
    const resolve = resolvesTo('192.168.100.50');
    const result = await validateScanUrl('https://fixture.example/', true, resolve);
    expect('url' in result).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses private IP literals the old string check missed, without resolving', async () => {
    const resolve = resolvesTo('93.184.215.14');
    for (const url of ['http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://100.64.0.1/', 'http://[fe80::1]/']) {
      expect(await validateScanUrl(url, false, resolve)).toEqual({ error: PRIVATE_TARGET_ERROR });
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not resolve a public IP literal', async () => {
    const resolve = resolvesTo('127.0.0.1');
    const result = await validateScanUrl('http://8.8.8.8/', false, resolve);
    expect('url' in result).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('isPrivateHostname — delegates to the core classifier', () => {
  it('classifies IPv6 ULA, IPv4-mapped loopback and CGNAT literals as private', () => {
    expect(isPrivateHostname('fd00::1')).toBe(true);
    expect(isPrivateHostname('[::ffff:127.0.0.1]')).toBe(true);
    expect(isPrivateHostname('100.64.0.1')).toBe(true);
  });
});

describe('ScanService.initiateScan — uses the injected resolver', () => {
  function makeService(config: Partial<DashboardConfig>, resolve: ReturnType<typeof resolvesTo>) {
    const storage = { scans: { createScan: vi.fn() } } as unknown as StorageAdapter;
    const orchestrator = { startScan: vi.fn() } as unknown as ScanOrchestrator;
    const cfg = { maxConcurrentScans: 4, maxPages: 100, runner: 'htmlcs', ...config } as unknown as DashboardConfig;
    return { service: new ScanService(storage, orchestrator, cfg, resolve), storage, orchestrator };
  }

  it('refuses a start URL whose host resolves to loopback — nothing is created or started', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const { service, storage, orchestrator } = makeService({}, resolvesTo('127.0.0.1'));
      const result = await service.initiateScan(
        { siteUrl: 'https://rebind.example/' },
        { username: 'alice', orgId: 'org-1', complianceToken: 'tok' },
      );
      expect(result).toEqual({ ok: false, error: PRIVATE_TARGET_ERROR });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(storage.scans.createScan).not.toHaveBeenCalled();
      expect(orchestrator.startScan).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

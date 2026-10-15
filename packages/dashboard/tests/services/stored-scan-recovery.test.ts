/**
 * Startup recovery of queued rows: how it treats a slow or unavailable resolver, how many
 * checks it runs at once, and what happens when writing a row fails.
 *
 * Real SQLite store, an injected resolver per test, an orchestrator spy. No network.
 * Names: `flaky` fails with a transient resolver error, `gone` does not exist, `hung` never
 * answers, `private-name` resolves to a private address, everything else is public.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import type { HostResolver } from '@luqen/core';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  PRIVATE_TARGET_ERROR,
  UNRESOLVABLE_TARGET_ERROR,
  ScanService,
  createScanStartLimiter,
  validateScanUrl,
} from '../../src/services/scan-service.js';
import { withLookupTimeout } from '../../src/services/lookup-timeout.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';

function dnsError(code: string, host: string): Error {
  return Object.assign(new Error(`getaddrinfo ${code} ${host}`), { code });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const NAMED_RESOLVER: HostResolver = async (hostname) => {
  if (hostname.includes('flaky')) throw dnsError('EAI_AGAIN', hostname);
  if (hostname.includes('gone')) throw dnsError('ENOTFOUND', hostname);
  if (hostname.includes('hung')) return new Promise<readonly string[]>(() => undefined);
  return hostname.includes('private-name') ? ['10.0.0.5'] : ['93.184.215.14'];
};

interface Harness {
  readonly storage: SqliteStorageAdapter;
  readonly startScan: ReturnType<typeof vi.fn>;
  readonly service: ScanService;
  readonly orgId: string;
  readonly cleanup: () => Promise<void>;
}

async function build(resolver: HostResolver = NAMED_RESOLVER, dnsTimeoutMs?: number): Promise<Harness> {
  const dbPath = join(tmpdir(), `test-stored-scan-recovery-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const orgId = (await storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' })).id;
  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: 'http://localhost:4000',
    webserviceUrl: 'http://localhost:3000',
    reportsDir: tmpdir(),
    dbPath,
    sessionSecret: 'test-session-secret-at-least-32b',
    maxConcurrentScans: 2,
    maxPages: 100,
    complianceClientId: 'dashboard',
    complianceClientSecret: '',
    runner: 'htmlcs',
  };
  const startScan = vi.fn();
  const service = new ScanService(
    storage,
    { startScan } as unknown as ScanOrchestrator,
    config,
    resolver,
    createScanStartLimiter({ now: () => 1_000_000, store: new Map() }),
    dnsTimeoutMs,
  );
  return {
    storage,
    startScan,
    service,
    orgId,
    async cleanup() {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

async function queuedRow(h: Harness, siteUrl: string): Promise<string> {
  const id = randomUUID();
  await h.storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: ['EU'],
    regulations: [],
    createdBy: 'u-recovery',
    createdAt: '2026-10-15T12:00:00.000Z',
    orgId: h.orgId,
  });
  return id;
}

describe('start-url check: resolver errors', () => {
  it('recovery dns: a transient resolver error is flagged transient and a definitive one is not', async () => {
    const transient = await validateScanUrl('https://flaky.example.com/', false, NAMED_RESOLVER);
    expect(transient).toEqual({ error: UNRESOLVABLE_TARGET_ERROR, transient: true });

    const definitive = await validateScanUrl('https://gone.example.com/', false, NAMED_RESOLVER);
    expect(definitive).toEqual({ error: UNRESOLVABLE_TARGET_ERROR });
    expect('transient' in definitive).toBe(false);
  });

  it('recovery dns: a lookup that outlasts its bound rejects with a timeout code and a prompt one passes through', async () => {
    const slow = withLookupTimeout(() => new Promise<readonly string[]>(() => undefined), 20);
    await expect(slow('hung.example.com')).rejects.toMatchObject({ code: 'ETIMEOUT' });

    const prompt = withLookupTimeout(async () => ['93.184.215.14'], 20);
    await expect(prompt('www.example.com')).resolves.toEqual(['93.184.215.14']);
  });
});

describe('startup recovery under resolver trouble', () => {
  let h: Harness;
  afterEach(async () => {
    await h.cleanup();
  });

  it('recovery dns: a row whose lookup failed transiently stays queued and is not started', async () => {
    h = await build();
    const flaky = await queuedRow(h, 'https://flaky.example.com/');
    const fine = await queuedRow(h, 'https://www.example.com/');

    const result = await h.service.recoverQueuedScans();

    expect(result.deferred).toEqual([flaky]);
    expect(result.refused).toEqual([]);
    expect(result.restarted).toBe(1);
    expect((await h.storage.scans.getScan(flaky))!.status).toBe('queued');
    expect((await h.storage.scans.getScan(flaky))!.error).toBeUndefined();
    expect((await h.storage.scans.getScan(fine))!.status).toBe('queued');
    expect(h.startScan).toHaveBeenCalledTimes(1);
    expect(h.startScan).toHaveBeenCalledWith(fine, expect.anything());
  });

  it('recovery dns: a definitive refusal still marks the row failed', async () => {
    h = await build();
    const privateRow = await queuedRow(h, 'https://private-name.example.com/');
    const goneRow = await queuedRow(h, 'https://gone.example.com/');
    const badScheme = await queuedRow(h, 'ftp://www.example.com/');

    const result = await h.service.recoverQueuedScans();

    expect([...result.refused].sort()).toEqual([privateRow, goneRow, badScheme].sort());
    expect(result.deferred).toEqual([]);
    expect((await h.storage.scans.getScan(privateRow))!.error).toBe(`Not restarted: ${PRIVATE_TARGET_ERROR}`);
    expect((await h.storage.scans.getScan(goneRow))!.error).toBe(`Not restarted: ${UNRESOLVABLE_TARGET_ERROR}`);
    expect((await h.storage.scans.getScan(badScheme))!.status).toBe('failed');
    expect(h.startScan).not.toHaveBeenCalled();
  });

  it('recovery dns: a lookup that never answers is bounded and its row stays queued', async () => {
    h = await build(NAMED_RESOLVER, 30);
    const hung = await queuedRow(h, 'https://hung.example.com/');
    const fine = await queuedRow(h, 'https://www.example.com/');

    const outcome = await Promise.race([
      h.service.recoverQueuedScans().then((value) => ({ done: true as const, value })),
      sleep(2_000).then(() => ({ done: false as const })),
    ]);

    expect(outcome.done).toBe(true);
    if (!outcome.done) return;
    expect(outcome.value.deferred).toEqual([hung]);
    expect(outcome.value.restarted).toBe(1);
    expect((await h.storage.scans.getScan(hung))!.status).toBe('queued');
    expect(h.startScan).toHaveBeenCalledWith(fine, expect.anything());
  });

  it('recovery dns: no more than five start checks run at once and every row is handled', async () => {
    let inFlight = 0;
    let peak = 0;
    const counting: HostResolver = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(10);
      inFlight -= 1;
      return ['93.184.215.14'];
    };
    h = await build(counting);
    for (let i = 0; i < 12; i += 1) await queuedRow(h, `https://www.example.com/page-${i}`);

    const result = await h.service.recoverQueuedScans();

    expect(result.restarted).toBe(12);
    expect(h.startScan).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it('recovery dns: a row whose failure cannot be written does not stop the others and the counts are returned', async () => {
    h = await build();
    const unwritable = await queuedRow(h, 'https://private-name.example.com/one');
    const fine = await queuedRow(h, 'https://www.example.com/');
    const refusedRow = await queuedRow(h, 'https://private-name.example.com/two');
    const realUpdate = h.storage.scans.updateScan.bind(h.storage.scans);
    vi.spyOn(h.storage.scans, 'updateScan').mockImplementation(async (id, data) => {
      if (id === unwritable && data.status === 'failed') throw new Error('disk I/O error at /private/path');
      return realUpdate(id, data);
    });

    const result = await h.service.recoverQueuedScans();

    expect(result.restarted).toBe(1);
    expect(result.refused).toEqual([refusedRow]);
    expect(result.errors.some((entry) => entry.id === unwritable && entry.name === 'Error')).toBe(true);
    expect(JSON.stringify(result.errors)).not.toContain('/private/path');
    expect((await h.storage.scans.getScan(fine))!.status).toBe('queued');
    expect(h.startScan).toHaveBeenCalledWith(fine, expect.anything());
    expect((await h.storage.scans.getScan(refusedRow))!.status).toBe('failed');
  });
});

/**
 * HARD-14 (startup recovery half) — a queued row left by a previous process is restarted only
 * when its stored start URL passes the shared start validation; otherwise the row is marked
 * failed with a reason and nothing is started.
 *
 * Real SQLite store, an injected resolver (a name containing `private-name` resolves to a
 * private address, a name containing `no-such-host` does not resolve, every other name to a
 * public documentation address) and an orchestrator spy. No network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  PRIVATE_TARGET_ERROR,
  UNRESOLVABLE_TARGET_ERROR,
  ScanService,
} from '../../src/services/scan-service.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';

interface Harness {
  readonly storage: SqliteStorageAdapter;
  readonly startScan: ReturnType<typeof vi.fn>;
  readonly service: ScanService;
  readonly orgId: string;
  readonly cleanup: () => Promise<void>;
}

async function build(): Promise<Harness> {
  const dbPath = join(tmpdir(), `test-scan-lifecycle-${randomUUID()}.db`);
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
  const resolver = async (hostname: string): Promise<readonly string[]> => {
    if (hostname.includes('no-such-host')) throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    return hostname.includes('private-name') ? ['10.0.0.5'] : ['93.184.215.14'];
  };
  const service = new ScanService(storage, { startScan } as unknown as ScanOrchestrator, config, resolver);
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
    createdAt: new Date().toISOString(),
    orgId: h.orgId,
  });
  return id;
}

describe('startup recovery of queued scans', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('HARD-14 startup recovery marks a queued scan failed when its start url no longer validates', async () => {
    const literal = await queuedRow(h, 'http://127.0.0.1/');
    const named = await queuedRow(h, 'https://private-name.example.com/');

    const result = await h.service.recoverQueuedScans();

    for (const id of [literal, named]) {
      const row = await h.storage.scans.getScan(id);
      expect(row!.status).toBe('failed');
      expect(row!.error).toBe(`Not restarted: ${PRIVATE_TARGET_ERROR}`);
      expect(h.startScan).not.toHaveBeenCalledWith(id, expect.anything());
    }
    expect(h.startScan).not.toHaveBeenCalled();
    expect([...result.refused].sort()).toEqual([literal, named].sort());
    expect(result.restarted).toBe(0);
  });

  it('HARD-14 startup recovery re-enqueues a queued scan with a valid start url', async () => {
    const id = await queuedRow(h, 'https://www.example.com/');

    const result = await h.service.recoverQueuedScans();

    expect(h.startScan).toHaveBeenCalledTimes(1);
    expect(h.startScan).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ siteUrl: 'https://www.example.com/', standard: 'WCAG2AA', jurisdictions: ['EU'], orgId: h.orgId }),
    );
    expect(result.restarted).toBe(1);
    expect(result.refused).toEqual([]);
    expect((await h.storage.scans.getScan(id))!.status).toBe('queued');
  });

  it('HARD-14 startup recovery fails closed for a name that does not resolve', async () => {
    const id = await queuedRow(h, 'https://no-such-host.example.com/');

    const result = await h.service.recoverQueuedScans();

    const row = await h.storage.scans.getScan(id);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe(`Not restarted: ${UNRESOLVABLE_TARGET_ERROR}`);
    expect(h.startScan).not.toHaveBeenCalled();
    expect(result.refused).toEqual([id]);
  });

  it('HARD-14 startup recovery continues past a row whose start throws and fails that row closed', async () => {
    const first = await queuedRow(h, 'https://www.example.com/one');
    const second = await queuedRow(h, 'https://www.example.com/two');
    h.startScan.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const result = await h.service.recoverQueuedScans();

    expect(h.startScan).toHaveBeenCalledTimes(2);
    expect(result.restarted).toBe(1);
    expect(result.refused).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.name).toBe('Error');
    const failedId = result.refused[0]!;
    expect([first, second]).toContain(failedId);
    const failedRow = await h.storage.scans.getScan(failedId);
    expect(failedRow!.status).toBe('failed');
    expect(failedRow!.error).toBe('Not restarted: the start could not be completed.');
    const otherId = failedId === first ? second : first;
    expect((await h.storage.scans.getScan(otherId))!.status).toBe('queued');
  });
});

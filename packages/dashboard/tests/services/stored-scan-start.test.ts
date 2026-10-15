/**
 * Starting a stored scan row again (retry, startup recovery) re-reads the row after the start-URL
 * check and acts only when the row is still in the state it was read in.
 *
 * The check is held open by a resolver that stays pending until the test releases it, so a
 * cancel can land inside the window deterministically. A name containing `held` waits; a name
 * containing `private-name` resolves to a private address; every other name to a public one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { PRIVATE_TARGET_ERROR, ScanService, createScanStartLimiter } from '../../src/services/scan-service.js';
import type { ScanControlCaller } from '../../src/services/scan-lifecycle.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';

interface Harness {
  readonly storage: SqliteStorageAdapter;
  readonly startScan: ReturnType<typeof vi.fn>;
  readonly service: ScanService;
  readonly orgId: string;
  readonly caller: ScanControlCaller;
  readonly lookups: () => number;
  readonly release: () => void;
  readonly cleanup: () => Promise<void>;
}

async function build(): Promise<Harness> {
  const dbPath = join(tmpdir(), `test-stored-scan-start-${randomUUID()}.db`);
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
  let begun = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const resolver = async (hostname: string): Promise<readonly string[]> => {
    if (hostname.includes('held')) {
      begun += 1;
      await gate;
    }
    return hostname.includes('private-name') ? ['10.0.0.5'] : ['93.184.215.14'];
  };
  const service = new ScanService(
    storage,
    { startScan } as unknown as ScanOrchestrator,
    config,
    resolver,
    createScanStartLimiter({ now: () => 1_000_000, store: new Map() }),
  );
  const caller: ScanControlCaller = {
    permissions: new Set(['scans.create']),
    user: { id: 'u-restart', username: 'restart', role: 'user', currentOrgId: orgId },
    startSubject: { userId: 'u-restart', apiKeyId: undefined, clientIp: undefined },
  };
  return {
    storage,
    startScan,
    service,
    orgId,
    caller,
    lookups: () => begun,
    release: () => open(),
    async cleanup() {
      open();
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
    createdBy: 'u-restart',
    createdAt: '2026-10-15T12:00:00.000Z',
    orgId: h.orgId,
  });
  return id;
}

describe('starting a stored scan while its state changes', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('stored start: a retry whose scan is cancelled during the url check leaves it cancelled and starts nothing', async () => {
    const id = await queuedRow(h, 'https://held.example.com/');

    const retry = h.service.retryScanAuthorized(id, h.caller);
    await vi.waitFor(() => expect(h.lookups()).toBe(1));
    const cancel = await h.service.cancelScanAuthorized(id, h.caller);
    expect(cancel.ok).toBe(true);
    h.release();
    const result = await retry;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('invalid_state');
    const row = await h.storage.scans.getScan(id);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('Cancelled by user');
    expect(h.startScan).not.toHaveBeenCalled();
  });

  it('stored start: a refused url does not overwrite a scan cancelled during the check', async () => {
    const id = await queuedRow(h, 'https://held-private-name.example.com/');

    const retry = h.service.retryScanAuthorized(id, h.caller);
    await vi.waitFor(() => expect(h.lookups()).toBe(1));
    await h.service.cancelScanAuthorized(id, h.caller);
    h.release();
    const result = await retry;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('invalid_state');
    const row = await h.storage.scans.getScan(id);
    expect(row!.error).toBe('Cancelled by user');
    expect(row!.error).not.toBe(PRIVATE_TARGET_ERROR);
    expect(h.startScan).not.toHaveBeenCalled();
  });

  it('stored start: startup recovery leaves a scan cancelled during the url check cancelled', async () => {
    const id = await queuedRow(h, 'https://held.example.com/');

    const recovery = h.service.recoverQueuedScans();
    await vi.waitFor(() => expect(h.lookups()).toBe(1));
    await h.service.cancelScanAuthorized(id, h.caller);
    h.release();
    const result = await recovery;

    expect(result.restarted).toBe(0);
    const row = await h.storage.scans.getScan(id);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('Cancelled by user');
    expect(h.startScan).not.toHaveBeenCalled();
  });

  it('stored start: a retry of a failed scan clears its old error and completion time', async () => {
    const id = await queuedRow(h, 'https://www.example.com/');
    await h.storage.scans.updateScan(id, {
      status: 'failed',
      error: 'An earlier problem',
      completedAt: '2026-10-14T09:00:00.000Z',
    });

    const result = await h.service.retryScanAuthorized(id, h.caller);

    expect(result.ok).toBe(true);
    const row = await h.storage.scans.getScan(id);
    expect(row!.status).toBe('queued');
    expect(row!.error).toBeUndefined();
    expect(row!.completedAt).toBeUndefined();
  });

  it('stored start: a retry of a scan whose state did not change still starts it', async () => {
    const id = await queuedRow(h, 'https://held.example.com/');

    const retry = h.service.retryScanAuthorized(id, h.caller);
    await vi.waitFor(() => expect(h.lookups()).toBe(1));
    h.release();
    const result = await retry;

    expect(result.ok).toBe(true);
    expect(h.startScan).toHaveBeenCalledTimes(1);
    expect((await h.storage.scans.getScan(id))!.status).toBe('queued');
  });
});

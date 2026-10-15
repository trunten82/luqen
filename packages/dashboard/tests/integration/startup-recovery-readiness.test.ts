/**
 * Server readiness does not wait for the recovery of queued scans, and a failing recovery
 * is logged, not thrown. The real createServer is booted with the recovery replaced by a
 * promise the test controls; DNS and the scan orchestrator are stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/services/host-resolver.js', () => ({
  systemHostResolver: async (): Promise<readonly string[]> => ['93.184.215.14'],
}));

import { createServer } from '../../src/server.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { ScanService, type RecoveryResult } from '../../src/services/scan-service.js';

const READY_BOUND_MS = 30_000;

let app: FastifyInstance | undefined;
let tmpRoot: string | undefined;

async function boot(): Promise<FastifyInstance> {
  vi.spyOn(ScanOrchestrator.prototype, 'startScan').mockImplementation(() => undefined as never);
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-startup-recovery-'));
  app = (await createServer({
    dbPath: join(tmpRoot, 'dashboard.db'),
    reportsDir: join(tmpRoot, 'reports'),
    sessionSecret: 'f'.repeat(32),
    catalogueUrl: '',
    catalogueCacheTtl: 0,
    redisUrl: '',
    maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
  app = undefined;
  tmpRoot = undefined;
});

describe('startup recovery and server readiness', () => {
  it('startup recovery: the server is ready while the recovery of queued scans is still running', async () => {
    const recover = vi
      .spyOn(ScanService.prototype, 'recoverQueuedScans')
      .mockImplementation(() => new Promise<RecoveryResult>(() => undefined));
    const server = await boot();

    const outcome = await Promise.race([
      server.ready().then(() => 'ready' as const),
      new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), READY_BOUND_MS)),
    ]);

    expect(outcome).toBe('ready');
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
  }, 120_000);

  it('startup recovery: a recovery that fails is logged and the server stays ready', async () => {
    const recover = vi
      .spyOn(ScanService.prototype, 'recoverQueuedScans')
      .mockRejectedValue(new Error('recovery failed'));
    const server = await boot();
    const warn = vi.spyOn(server.log, 'warn');

    await server.ready();
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());

    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  }, 120_000);
});

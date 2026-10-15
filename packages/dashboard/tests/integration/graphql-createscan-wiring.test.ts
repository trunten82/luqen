/**
 * Proves GraphQL createScan reaches the scan orchestrator through the REAL
 * createServer wiring (the unit tests in tests/graphql/create-scan-shared-path
 * prove the resolver against a hand-built context; this proves the context
 * createServer actually builds carries the scan service and the compliance
 * token). Hosts are placeholders; DNS is hermetic.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

vi.mock('../../src/services/host-resolver.js', () => ({
  systemHostResolver: async (): Promise<readonly string[]> => ['93.184.215.14'],
}));

import { createServer } from '../../src/server.js';
import { generateApiKey, storeApiKey } from '../../src/auth/api-key.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';

const SENTINEL = 'w1-compliance-token-sentinel';
const PREVIOUS_KEY = process.env['DASHBOARD_COMPLIANCE_API_KEY'];

let app: FastifyInstance | undefined;
afterAll(async () => {
  await app?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (PREVIOUS_KEY === undefined) delete process.env['DASHBOARD_COMPLIANCE_API_KEY'];
  else process.env['DASHBOARD_COMPLIANCE_API_KEY'] = PREVIOUS_KEY;
});

describe('createServer wires GraphQL createScan to the orchestrator', () => {
  it('SCAN-01 wiring createServer graphql createScan reaches the orchestrator', async () => {
    process.env['DASHBOARD_COMPLIANCE_API_KEY'] = SENTINEL;
    const startScan = vi
      .spyOn(ScanOrchestrator.prototype, 'startScan')
      .mockImplementation(() => undefined as never);

    const root = mkdtempSync(join(tmpdir(), 'luqen-graphql-createscan-'));
    const dbPath = join(root, 'dashboard.db');
    const config = {
      dbPath,
      reportsDir: join(root, 'reports'),
      sessionSecret: 'c'.repeat(32),
      catalogueUrl: '',
      catalogueCacheTtl: 0,
      redisUrl: '',
      maxConcurrentScans: 1,
    };
    app = (await createServer(config as never)) as FastifyInstance;
    await app.ready();

    // The reachability probe uses global fetch; stub it AFTER boot so server
    // start-up traffic is untouched.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const key = generateApiKey();
    const db = new Database(dbPath);
    try { storeApiKey(db, key, 'createscan-wiring-probe', 'admin'); } finally { db.close(); }

    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      payload: JSON.stringify({
        query: 'mutation { createScan(input: { siteUrl: "https://example.com" }) { id status } }',
      }),
    });
    const body = JSON.parse(res.body) as {
      errors?: unknown;
      data?: { createScan?: { id: string; status: string } };
    };

    expect(body.errors).toBeUndefined();
    expect(startScan).toHaveBeenCalledTimes(1);
    const [startedId, startConfig] = startScan.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(startedId).toBe(body.data?.createScan?.id);
    expect(startConfig['siteUrl']).toBe('https://example.com/');
    expect(startConfig['complianceToken']).toBe(SENTINEL);
    expect(startConfig['orgId']).toBe('system');
  }, 120_000);
});

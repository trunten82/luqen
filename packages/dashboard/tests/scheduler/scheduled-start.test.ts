/**
 * HARD-14 (scheduled-run half) — a due schedule starts its scan only after the stored start URL
 * passes the shared start validation at run time.
 *
 * Drives `runDueSchedules` directly over a real SQLite store: no interval timer, no sleeps, no
 * fake timers. DNS goes through an injected resolver (a name containing `private-name` resolves
 * to a private address, every other name to a public documentation address). The scan-start
 * limiter is injected with an inspectable store so a test can read which keys were charged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { runDueSchedules } from '../../src/scheduler.js';
import { computeNextRunAt } from '../../src/routes/schedules.js';
import {
  PRIVATE_TARGET_ERROR,
  ScanService,
  createScanStartLimiter,
} from '../../src/services/scan-service.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const CREATOR = 'u-schedule-creator';
const PUBLIC_URL = 'https://www.example.com/';
const PRIVATE_URL = 'https://private-name.example.com/';

interface Harness {
  readonly storage: SqliteStorageAdapter;
  readonly orchestrator: ScanOrchestrator;
  readonly startScan: ReturnType<typeof vi.fn>;
  readonly config: DashboardConfig;
  readonly scanService: ScanService;
  readonly limiterStore: Map<string, readonly number[]>;
  readonly orgId: string;
  readonly cleanup: () => Promise<void>;
}

async function build(): Promise<Harness> {
  const dbPath = join(tmpdir(), `test-scheduled-start-${randomUUID()}.db`);
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
  const orchestrator = { startScan } as unknown as ScanOrchestrator;
  const limiterStore = new Map<string, readonly number[]>();
  const limiter = createScanStartLimiter({ now: () => NOW.getTime(), store: limiterStore });
  const resolver = async (hostname: string): Promise<readonly string[]> =>
    hostname.includes('private-name') ? ['10.0.0.5'] : ['93.184.215.14'];
  const scanService = new ScanService(storage, orchestrator, config, resolver, limiter);
  return {
    storage,
    orchestrator,
    startScan,
    config,
    scanService,
    limiterStore,
    orgId,
    async cleanup() {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

async function dueSchedule(h: Harness, siteUrl: string): Promise<string> {
  const id = randomUUID();
  await h.storage.schedules.createSchedule({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    scanMode: 'single',
    jurisdictions: ['EU'],
    frequency: 'daily',
    nextRunAt: '2020-01-01T00:00:00.000Z',
    createdBy: CREATOR,
    orgId: h.orgId,
    runner: 'axe',
    incremental: true,
  });
  return id;
}

function run(h: Harness): Promise<void> {
  return runDueSchedules(h.storage, h.scanService, NOW);
}

describe('scheduled runs', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('HARD-14 scheduled run starts a scan for a valid start url', async () => {
    await dueSchedule(h, PUBLIC_URL);
    await run(h);

    const rows = await h.storage.scans.listScans({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdBy).toBe(`scheduler:${CREATOR}`);
    expect(rows[0]!.orgId).toBe(h.orgId);
    expect(rows[0]!.standard).toBe('WCAG2AA');
    expect(rows[0]!.jurisdictions).toEqual(['EU']);
    expect(h.startScan).toHaveBeenCalledTimes(1);
    expect(h.startScan).toHaveBeenCalledWith(
      rows[0]!.id,
      expect.objectContaining({
        scanMode: 'single',
        runner: 'axe',
        incremental: true,
        maxPages: 100,
        orgId: h.orgId,
      }),
    );
  });

  it('HARD-14 scheduled run records a failed scan for a start url that now resolves privately and starts nothing', async () => {
    await dueSchedule(h, PRIVATE_URL);
    await run(h);

    const rows = await h.storage.scans.listScans({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.error).toBe(PRIVATE_TARGET_ERROR);
    expect(h.startScan).not.toHaveBeenCalled();
  });

  it('HARD-14 scheduled run advances the next run after a refused start', async () => {
    const id = await dueSchedule(h, PRIVATE_URL);
    await run(h);

    const schedule = await h.storage.schedules.getSchedule(id);
    expect(schedule).not.toBeNull();
    expect(schedule!.lastRunAt).toBe(NOW.toISOString());
    expect(schedule!.nextRunAt).toBe(computeNextRunAt('daily', NOW));
    expect(await h.storage.schedules.getDueSchedules(NOW)).toHaveLength(0);
  });

  it('HARD-14 scheduled run does not draw from any user start limit', async () => {
    const full = Array.from({ length: 30 }, () => NOW.getTime());
    h.limiterStore.set(`user:${CREATOR}`, full);
    h.limiterStore.set('ip:unknown', full);
    await dueSchedule(h, PUBLIC_URL);
    await run(h);

    expect(h.startScan).toHaveBeenCalledTimes(1);
    expect(h.limiterStore.get(`user:${CREATOR}`)).toEqual(full);
    expect(h.limiterStore.get('ip:unknown')).toEqual(full);
    expect([...h.limiterStore.keys()].sort()).toEqual([`user:${CREATOR}`, 'ip:unknown'].sort());
  });

  it('HARD-14 a scheduled run whose start throws still advances that schedule and the next one runs', async () => {
    // The orchestrator throws on the first start only; both schedules are due.
    h.startScan.mockImplementationOnce(() => {
      throw new Error('orchestrator unavailable');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = await dueSchedule(h, PUBLIC_URL);
    const second = await dueSchedule(h, 'https://www.example.org/');

    await expect(run(h)).resolves.toBeUndefined();

    // Both schedules advanced, so neither is due again on the next tick.
    for (const id of [first, second]) {
      const schedule = await h.storage.schedules.getSchedule(id);
      expect(schedule!.lastRunAt).toBe(NOW.toISOString());
      expect(schedule!.nextRunAt).toBe(computeNextRunAt('daily', NOW));
    }
    expect(await h.storage.schedules.getDueSchedules(NOW)).toHaveLength(0);

    // The throwing start left a failed row, and the other schedule still started.
    expect(h.startScan).toHaveBeenCalledTimes(2);
    const statuses = (await h.storage.scans.listScans({})).map((row) => row.status).sort();
    expect(statuses).toEqual(['failed', 'queued']);

    // The log names the schedule and the error type, never the start URL or the message.
    const lines = logged.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines.some((line) => line.includes(first) || line.includes(second))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain('example.com');
      expect(line).not.toContain('example.org');
      expect(line).not.toContain('orchestrator unavailable');
    }
    logged.mockRestore();
  });
});

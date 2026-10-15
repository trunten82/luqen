/**
 * The scheduler tick: one pass claims each due schedule before the slow start work, a second
 * tick does not begin while one is still running, and one schedule's failure never reaches
 * the others.
 *
 * Drives `runDueSchedules` and `startScheduler` over a real SQLite store. DNS goes through an
 * injected resolver that stays pending until the test releases it, so the "pass outlasts the
 * interval" situation is built directly rather than waited for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { runDueSchedules, startScheduler } from '../../src/scheduler.js';
import { computeNextRunAt } from '../../src/routes/schedules.js';
import { ScanService, createScanStartLimiter } from '../../src/services/scan-service.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const CREATOR = 'u-tick-creator';

interface Harness {
  readonly storage: SqliteStorageAdapter;
  readonly startScan: ReturnType<typeof vi.fn>;
  readonly scanService: ScanService;
  readonly orgId: string;
  /** Number of hostname lookups begun so far. */
  readonly lookups: () => number;
  /** Let every pending lookup answer with a public address. */
  readonly release: () => void;
  readonly cleanup: () => Promise<void>;
}

async function build(): Promise<Harness> {
  const dbPath = join(tmpdir(), `test-scheduler-tick-${randomUUID()}.db`);
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
  let begun = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const resolver = async (): Promise<readonly string[]> => {
    begun += 1;
    await gate;
    return ['93.184.215.14'];
  };
  const limiter = createScanStartLimiter({ now: () => NOW.getTime(), store: new Map() });
  const scanService = new ScanService(storage, orchestrator, config, resolver, limiter);
  return {
    storage,
    startScan,
    scanService,
    orgId,
    lookups: () => begun,
    release: () => open(),
    async cleanup() {
      open();
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
    incremental: false,
  });
  return id;
}

describe('scheduler tick', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await h.cleanup();
  });

  it('scheduler: a due schedule is claimed before its start work so a second pass finds it not due', async () => {
    const id = await dueSchedule(h, 'https://www.example.com/');

    const first = runDueSchedules(h.storage, h.scanService, NOW);
    await vi.waitFor(() => expect(h.lookups()).toBe(1));
    // The first pass is still waiting on DNS. A second pass over the same instant has nothing due.
    const second = runDueSchedules(h.storage, h.scanService, NOW);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    h.release();
    await Promise.all([first, second]);

    expect(await h.storage.scans.listScans({})).toHaveLength(1);
    expect(h.lookups()).toBe(1);
    const schedule = await h.storage.schedules.getSchedule(id);
    expect(schedule!.nextRunAt).toBe(computeNextRunAt('daily', NOW));
  });

  it('scheduler: no tick begins while the previous tick is still running', async () => {
    vi.useFakeTimers();
    await dueSchedule(h, 'https://www.example.com/');
    const dueQuery = vi.spyOn(h.storage.schedules, 'getDueSchedules');

    const timer = startScheduler(h.storage, h.scanService, 1_000);
    try {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(dueQuery).toHaveBeenCalledTimes(1);
      // Three more intervals pass while the first tick waits on DNS: no further tick starts.
      await vi.advanceTimersByTimeAsync(3_000);
      expect(dueQuery).toHaveBeenCalledTimes(1);

      h.release();
      await vi.advanceTimersByTimeAsync(0);
      // Once the tick has finished, the next interval runs a tick again.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(dueQuery).toHaveBeenCalledTimes(2);
    } finally {
      clearInterval(timer);
    }
    expect(await h.storage.scans.listScans({})).toHaveLength(1);
  });

  it('scheduler: one schedule whose advance fails does not stop the others and starts nothing for itself', async () => {
    h.release();
    const failing = await dueSchedule(h, 'https://www.example.com/');
    const healthy = await dueSchedule(h, 'https://www.example.org/');
    const realUpdate = h.storage.schedules.updateSchedule.bind(h.storage.schedules);
    vi.spyOn(h.storage.schedules, 'updateSchedule').mockImplementation(async (id, data) => {
      if (id === failing) throw new Error('database is locked for www.example.com');
      return realUpdate(id, data);
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(runDueSchedules(h.storage, h.scanService, NOW)).resolves.toBeUndefined();

    // The healthy schedule advanced and started; the failing one created no row.
    const advanced = await h.storage.schedules.getSchedule(healthy);
    expect(advanced!.nextRunAt).toBe(computeNextRunAt('daily', NOW));
    const rows = await h.storage.scans.listScans({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.siteUrl).toBe('https://www.example.org/');
    expect(h.startScan).toHaveBeenCalledTimes(1);

    // The log names the schedule and the error type, never the start URL or the message.
    const lines = logged.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines.some((line) => line.includes(failing))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain('example.com');
      expect(line).not.toContain('database is locked');
    }
    logged.mockRestore();
  });
});

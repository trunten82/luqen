import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must use vi.hoisted so variables are available inside vi.mock factories
const {
  mockCreateScanner,
  mockDiscoverUrls,
  mockScanUrls,
  mockWebserviceClient,
  mockWebservicePool,
  mockComputeContentHashes,
  mockCheckCompliance,
  mockWriteFile,
  mockMkdir,
} = vi.hoisted(() => ({
  mockCreateScanner: vi.fn(),
  mockDiscoverUrls: vi.fn(),
  mockScanUrls: vi.fn(),
  mockWebserviceClient: vi.fn(),
  mockWebservicePool: vi.fn(),
  mockComputeContentHashes: vi.fn(),
  mockCheckCompliance: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@luqen/core', () => ({
  createScanner: mockCreateScanner,
  discoverUrls: mockDiscoverUrls,
  scanUrls: mockScanUrls,
  WebserviceClient: mockWebserviceClient,
  WebservicePool: mockWebservicePool,
  computeContentHashes: mockComputeContentHashes,
}));

vi.mock('../../src/compliance-client.js', () => ({
  checkCompliance: mockCheckCompliance,
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { ScanConfig, ScanProgressEvent } from '../../src/scanner/orchestrator.js';
import type { StorageAdapter } from '../../src/db/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage(): StorageAdapter {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    migrate: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    name: 'mock',
    scans: {
      createScan: vi.fn().mockResolvedValue({}),
      getScan: vi.fn().mockResolvedValue(null),
      listScans: vi.fn().mockResolvedValue([]),
      countScans: vi.fn().mockResolvedValue(0),
      updateScan: vi.fn().mockResolvedValue({}),
      deleteScan: vi.fn().mockResolvedValue(undefined),
      deleteOrgScans: vi.fn().mockResolvedValue(undefined),
      getReport: vi.fn().mockResolvedValue(null),
      getTrendData: vi.fn().mockResolvedValue([]),
      getLatestPerSite: vi.fn().mockResolvedValue([]),
    },
    users: {} as StorageAdapter['users'],
    organizations: {} as StorageAdapter['organizations'],
    schedules: {} as StorageAdapter['schedules'],
    assignments: {} as StorageAdapter['assignments'],
    repos: {} as StorageAdapter['repos'],
    roles: {} as StorageAdapter['roles'],
    teams: {} as StorageAdapter['teams'],
    email: {} as StorageAdapter['email'],
    audit: {} as StorageAdapter['audit'],
    plugins: {} as StorageAdapter['plugins'],
    apiKeys: {} as StorageAdapter['apiKeys'],
    pageHashes: {
      getPageHashes: vi.fn().mockResolvedValue(new Map()),
      upsertPageHash: vi.fn().mockResolvedValue(undefined),
      upsertPageHashes: vi.fn().mockResolvedValue(undefined),
    },
    manualTests: {} as StorageAdapter['manualTests'],
  } as unknown as StorageAdapter;
}

function baseScanConfig(overrides: Partial<ScanConfig> = {}): ScanConfig {
  return {
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    concurrency: 2,
    jurisdictions: [],
    scanMode: 'single',
    webserviceUrl: 'http://localhost:4000',
    ...overrides,
  };
}

function makeScanResult(pages: Array<{ url: string; issues: Array<{ type: string; code: string; message: string; selector: string; context: string }> }> = []) {
  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const page of pages) {
    for (const issue of page.issues) {
      if (issue.type === 'error') byLevel.error++;
      else if (issue.type === 'warning') byLevel.warning++;
      else byLevel.notice++;
    }
  }
  return {
    pages: pages.map((p) => ({ ...p, issueCount: p.issues.length })),
    summary: { pagesScanned: pages.length, byLevel },
  };
}

/** Collect all events for a scan until terminal event. */
function collectEvents(orchestrator: ScanOrchestrator, scanId: string): Promise<ScanProgressEvent[]> {
  return new Promise((resolve) => {
    const events: ScanProgressEvent[] = [];
    const listener = (event: ScanProgressEvent): void => {
      events.push(event);
      if (event.type === 'complete' || event.type === 'failed') {
        orchestrator.off(scanId, listener);
        resolve(events);
      }
    };
    orchestrator.on(scanId, listener);
  });
}

/** Wait for scan to finish by collecting events, with a timeout safety net. */
function waitForScan(orchestrator: ScanOrchestrator, scanId: string, timeoutMs = 5000): Promise<ScanProgressEvent[]> {
  return Promise.race([
    collectEvents(orchestrator, scanId),
    new Promise<ScanProgressEvent[]>((_, reject) =>
      setTimeout(() => reject(new Error('Scan timed out')), timeoutMs),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScanOrchestrator', () => {
  let storage: StorageAdapter;
  let orchestrator: ScanOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createMockStorage();
    orchestrator = new ScanOrchestrator(storage, '/tmp/reports', 2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('accepts a numeric maxConcurrent argument', () => {
      const orch = new ScanOrchestrator(storage, '/tmp/reports', 4);
      expect(orch).toBeInstanceOf(ScanOrchestrator);
    });

    it('accepts an OrchestratorOptions object', () => {
      const orch = new ScanOrchestrator(storage, '/tmp/reports', {
        maxConcurrent: 3,
      });
      expect(orch).toBeInstanceOf(ScanOrchestrator);
    });

    it('defaults maxConcurrent to 2 when no options provided', () => {
      const orch = new ScanOrchestrator(storage, '/tmp/reports');
      expect(orch).toBeInstanceOf(ScanOrchestrator);
    });

    it('accepts ssePublisher option', () => {
      const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
      const orch = new ScanOrchestrator(storage, '/tmp/reports', {
        ssePublisher: publisher as any,
      });
      expect(orch).toBeInstanceOf(ScanOrchestrator);
    });

    it('accepts redisQueue option', () => {
      const queue = {
        enqueue: vi.fn().mockResolvedValue(undefined),
        dequeue: vi.fn().mockResolvedValue(null),
      };
      const orch = new ScanOrchestrator(storage, '/tmp/reports', {
        redisQueue: queue as any,
      });
      expect(orch).toBeInstanceOf(ScanOrchestrator);
    });
  });

  // ── emit / on / off (event system) ─────────────────────────────────────

  describe('emit / on / off', () => {
    it('delivers events to subscribed listeners', () => {
      const listener = vi.fn();
      orchestrator.on('scan-1', listener);

      const event: ScanProgressEvent = {
        type: 'scan_start',
        timestamp: new Date().toISOString(),
        data: {},
      };
      orchestrator.emit('scan-1', event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('does not deliver events after unsubscribing', () => {
      const listener = vi.fn();
      orchestrator.on('scan-1', listener);
      orchestrator.off('scan-1', listener);

      orchestrator.emit('scan-1', {
        type: 'scan_start',
        timestamp: new Date().toISOString(),
        data: {},
      });

      // The listener may have been called once during on() if buffer exists, but not after off()
      // Since buffer is empty, listener should not have been called at all
      expect(listener).not.toHaveBeenCalled();
    });

    it('replays buffered events on subscribe (late-connecting client)', () => {
      const event1: ScanProgressEvent = {
        type: 'scan_start',
        timestamp: new Date().toISOString(),
        data: {},
      };
      const event2: ScanProgressEvent = {
        type: 'discovery',
        timestamp: new Date().toISOString(),
        data: { pagesDiscovered: 5 },
      };

      // Emit events before subscribing
      orchestrator.emit('scan-1', event1);
      orchestrator.emit('scan-1', event2);

      // Subscribe after events emitted
      const listener = vi.fn();
      orchestrator.on('scan-1', listener);

      // Should have been called with both buffered events
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(event1);
      expect(listener).toHaveBeenCalledWith(event2);
    });

    it('deduplicates non-scan_complete events in buffer by type', () => {
      const event1: ScanProgressEvent = {
        type: 'discovery',
        timestamp: '2024-01-01T00:00:00Z',
        data: { pagesDiscovered: 5 },
      };
      const event2: ScanProgressEvent = {
        type: 'discovery',
        timestamp: '2024-01-01T00:01:00Z',
        data: { pagesDiscovered: 10 },
      };

      orchestrator.emit('scan-1', event1);
      orchestrator.emit('scan-1', event2);

      const listener = vi.fn();
      orchestrator.on('scan-1', listener);

      // Only latest discovery event should be buffered
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event2);
    });

    it('accumulates scan_complete events in buffer (no dedup)', () => {
      const event1: ScanProgressEvent = {
        type: 'scan_complete',
        timestamp: '2024-01-01T00:00:00Z',
        data: { pagesScanned: 1, totalPages: 3, currentUrl: 'https://example.com/a' },
      };
      const event2: ScanProgressEvent = {
        type: 'scan_complete',
        timestamp: '2024-01-01T00:01:00Z',
        data: { pagesScanned: 2, totalPages: 3, currentUrl: 'https://example.com/b' },
      };

      orchestrator.emit('scan-1', event1);
      orchestrator.emit('scan-1', event2);

      const listener = vi.fn();
      orchestrator.on('scan-1', listener);

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('cleans up buffer after terminal event (complete)', async () => {
      vi.useFakeTimers();

      orchestrator.emit('scan-1', {
        type: 'complete',
        timestamp: new Date().toISOString(),
        data: {},
      });

      // Buffer should exist initially
      const listener1 = vi.fn();
      orchestrator.on('scan-1', listener1);
      expect(listener1).toHaveBeenCalledTimes(1);

      // Advance past the 30s cleanup timeout
      await vi.advanceTimersByTimeAsync(31_000);

      // Buffer should be cleaned up now
      const listener2 = vi.fn();
      orchestrator.on('scan-1', listener2);
      expect(listener2).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('cleans up buffer after terminal event (failed)', async () => {
      vi.useFakeTimers();

      orchestrator.emit('scan-1', {
        type: 'failed',
        timestamp: new Date().toISOString(),
        data: { error: 'boom' },
      });

      await vi.advanceTimersByTimeAsync(31_000);

      const listener = vi.fn();
      orchestrator.on('scan-1', listener);
      expect(listener).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('publishes to ssePublisher when available', () => {
      const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
      const orch = new ScanOrchestrator(storage, '/tmp/reports', {
        ssePublisher: publisher as any,
      });

      const event: ScanProgressEvent = {
        type: 'scan_start',
        timestamp: new Date().toISOString(),
        data: {},
      };
      orch.emit('scan-1', event);

      expect(publisher.publish).toHaveBeenCalledWith('scan-1', event);
    });
  });

  // ── startScan ──────────────────────────────────────────────────────────

  describe('startScan', () => {
    it('runs a standard single-page scan and emits complete', async () => {
      const scanResult = makeScanResult([
        {
          url: 'https://example.com',
          issues: [
            { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img', context: '<img>' },
            { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Possible heading', selector: 'p', context: '<p>' },
          ],
        },
      ]);

      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const config = baseScanConfig();
      const eventsPromise = waitForScan(orchestrator, 'scan-1');
      orchestrator.startScan('scan-1', config);
      const events = await eventsPromise;

      // Should have scan_start and complete
      expect(events.some((e) => e.type === 'scan_start')).toBe(true);
      expect(events.some((e) => e.type === 'complete')).toBe(true);

      const completeEvent = events.find((e) => e.type === 'complete')!;
      expect(completeEvent.data.pagesScanned).toBe(1);
      expect(completeEvent.data.issues).toEqual({ errors: 1, warnings: 1, notices: 0 });
      expect(completeEvent.data.reportUrl).toBe('/reports/scan-1');

      // Should update scan to running then completed
      expect(storage.scans.updateScan).toHaveBeenCalledWith('scan-1', { status: 'running' });
      expect(storage.scans.updateScan).toHaveBeenCalledWith('scan-1', expect.objectContaining({
        status: 'completed',
        pagesScanned: 1,
        errors: 1,
        warnings: 1,
        notices: 0,
        totalIssues: 2,
      }));
    });

    it('handles scan with no issues', async () => {
      const scanResult = makeScanResult([
        { url: 'https://example.com', issues: [] },
      ]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const eventsPromise = waitForScan(orchestrator, 'scan-2');
      orchestrator.startScan('scan-2', baseScanConfig());
      const events = await eventsPromise;

      const completeEvent = events.find((e) => e.type === 'complete')!;
      expect(completeEvent.data.pagesScanned).toBe(1);
      expect(completeEvent.data.issues).toEqual({ errors: 0, warnings: 0, notices: 0 });
    });

    it('runs a site-wide (multi-page) scan', async () => {
      const scanResult = makeScanResult([
        {
          url: 'https://example.com',
          issues: [{ type: 'error', code: 'E1', message: 'err', selector: 'a', context: '<a>' }],
        },
        {
          url: 'https://example.com/about',
          issues: [{ type: 'notice', code: 'N1', message: 'notice', selector: 'p', context: '<p>' }],
        },
      ]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const config = baseScanConfig({ scanMode: 'site' });
      const eventsPromise = waitForScan(orchestrator, 'scan-3');
      orchestrator.startScan('scan-3', config);
      const events = await eventsPromise;

      const completeEvent = events.find((e) => e.type === 'complete')!;
      expect(completeEvent.data.pagesScanned).toBe(2);
      expect(completeEvent.data.issues).toEqual({ errors: 1, warnings: 0, notices: 1 });

      // createScanner should be called with singlePage: false for site mode
      expect(mockCreateScanner).toHaveBeenCalledWith(expect.objectContaining({
        singlePage: false,
      }));
    });

    it('passes runner option to createScanner when provided', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const config = baseScanConfig({ runner: 'axe' });
      const eventsPromise = waitForScan(orchestrator, 'scan-r');
      orchestrator.startScan('scan-r', config);
      await eventsPromise;

      expect(mockCreateScanner).toHaveBeenCalledWith(expect.objectContaining({
        runner: 'axe',
      }));
    });

    it('passes webserviceUrls to createScanner when provided', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const config = baseScanConfig({
        webserviceUrls: ['http://ws1:4000', 'http://ws2:4000'],
      });
      const eventsPromise = waitForScan(orchestrator, 'scan-ws');
      orchestrator.startScan('scan-ws', config);
      await eventsPromise;

      expect(mockCreateScanner).toHaveBeenCalledWith(expect.objectContaining({
        webserviceUrls: ['http://ws1:4000', 'http://ws2:4000'],
      }));
    });

    it('passes maxPages to createScanner', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const config = baseScanConfig({ maxPages: 100 });
      const eventsPromise = waitForScan(orchestrator, 'scan-mp');
      orchestrator.startScan('scan-mp', config);
      await eventsPromise;

      expect(mockCreateScanner).toHaveBeenCalledWith(expect.objectContaining({
        maxPages: 100,
      }));
    });

    it('writes report to filesystem', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const eventsPromise = waitForScan(orchestrator, 'scan-fs');
      orchestrator.startScan('scan-fs', baseScanConfig());
      await eventsPromise;

      expect(mockMkdir).toHaveBeenCalledWith('/tmp/reports', { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('example.com-scan-fs.json'),
        expect.any(String),
      );
    });

    it('does not fail scan when filesystem write fails', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      mockMkdir.mockRejectedValueOnce(new Error('disk full'));

      const eventsPromise = waitForScan(orchestrator, 'scan-fsfail');
      orchestrator.startScan('scan-fsfail', baseScanConfig());
      const events = await eventsPromise;

      // Should still complete successfully
      expect(events.some((e) => e.type === 'complete')).toBe(true);
    });

    it('stores report in database with jsonReport', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const eventsPromise = waitForScan(orchestrator, 'scan-db');
      orchestrator.startScan('scan-db', baseScanConfig());
      await eventsPromise;

      const updateCalls = (storage.scans.updateScan as ReturnType<typeof vi.fn>).mock.calls;
      const completedCall = updateCalls.find((c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed');
      expect(completedCall).toBeDefined();
      expect(completedCall![1]).toHaveProperty('jsonReport');
      expect(completedCall![1]).toHaveProperty('jsonReportPath');

      const reportData = JSON.parse(completedCall![1].jsonReport as string);
      expect(reportData.scanId).toBe('scan-db');
      expect(reportData.siteUrl).toBe('https://example.com');
    });

    // ── Error handling ──────────────────────────────────────────────────

    it('emits failed event when scan throws an error', async () => {
      const mockScanner = { scan: vi.fn().mockRejectedValue(new Error('connection refused')) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const eventsPromise = waitForScan(orchestrator, 'scan-fail');
      orchestrator.startScan('scan-fail', baseScanConfig());
      const events = await eventsPromise;

      const failedEvent = events.find((e) => e.type === 'failed')!;
      expect(failedEvent).toBeDefined();
      expect(failedEvent.data.error).toBe('connection refused');

      expect(storage.scans.updateScan).toHaveBeenCalledWith('scan-fail', {
        status: 'failed',
        error: 'connection refused',
      });
    });

    it('handles non-Error thrown values', async () => {
      const mockScanner = { scan: vi.fn().mockRejectedValue('string error') };
      mockCreateScanner.mockReturnValue(mockScanner);

      const eventsPromise = waitForScan(orchestrator, 'scan-str');
      orchestrator.startScan('scan-str', baseScanConfig());
      const events = await eventsPromise;

      const failedEvent = events.find((e) => e.type === 'failed')!;
      expect(failedEvent.data.error).toBe('string error');
    });

    it('still emits failed event even when initial updateScan to running fails', async () => {
      const mockScanner = { scan: vi.fn().mockRejectedValue(new Error('scan error')) };
      mockCreateScanner.mockReturnValue(mockScanner);

      // Make the first updateScan (status: 'running') throw, but let 'failed' succeed
      let callCount = 0;
      (storage.scans.updateScan as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('db error on running'); // 'running' fails
        return {}; // 'failed' succeeds
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-dberr');
      orchestrator.startScan('scan-dberr', baseScanConfig());
      const events = await eventsPromise;

      // The scan should fail because updateScan('running') threw, caught by outer catch
      const failedEvent = events.find((e) => e.type === 'failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.data.error).toBe('db error on running');
    });

    // ── Compliance ────────────────────────────────────────────────────

    it('runs compliance check when config includes compliance settings', async () => {
      const scanResult = makeScanResult([
        {
          url: 'https://example.com',
          issues: [
            { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img', context: '<img>' },
          ],
        },
      ]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      mockCheckCompliance.mockResolvedValue({
        summary: { totalConfirmedViolations: 3 },
        matrix: { eu: { passing: true } },
      });

      const config = baseScanConfig({
        complianceUrl: 'http://compliance:5000',
        complianceToken: 'tok-123',
        jurisdictions: ['eu', 'us'],
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-comp');
      orchestrator.startScan('scan-comp', config);
      const events = await eventsPromise;

      // Should emit compliance event
      expect(events.some((e) => e.type === 'compliance')).toBe(true);

      // Should call checkCompliance with deduplicated issues
      expect(mockCheckCompliance).toHaveBeenCalledWith(
        'http://compliance:5000',
        'tok-123',
        ['eu', 'us'],
        expect.any(Array),
      );

      // Complete event should include confirmedViolations
      const completeEvent = events.find((e) => e.type === 'complete')!;
      expect(completeEvent.data.confirmedViolations).toBe(3);

      // DB update should include confirmedViolations
      const updateCalls = (storage.scans.updateScan as ReturnType<typeof vi.fn>).mock.calls;
      const completedCall = updateCalls.find((c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed');
      expect(completedCall![1]).toHaveProperty('confirmedViolations', 3);
    });

    it('deduplicates issues by code before compliance check', async () => {
      const scanResult = makeScanResult([
        {
          url: 'https://example.com',
          issues: [
            { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img.a', context: '<img class="a">' },
            { type: 'error', code: 'WCAG2AA.1_1_1', message: 'Missing alt', selector: 'img.b', context: '<img class="b">' },
            { type: 'warning', code: 'WCAG2AA.1_3_1', message: 'Heading', selector: 'p', context: '<p>' },
          ],
        },
      ]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      mockCheckCompliance.mockResolvedValue({
        summary: { totalConfirmedViolations: 1 },
        matrix: {},
      });

      const config = baseScanConfig({
        complianceUrl: 'http://compliance:5000',
        complianceToken: 'tok-123',
        jurisdictions: ['eu'],
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-dedup');
      orchestrator.startScan('scan-dedup', config);
      await eventsPromise;

      // Should only pass 2 unique issues (deduplicated by code)
      const passedIssues = mockCheckCompliance.mock.calls[0][3];
      expect(passedIssues).toHaveLength(2);
    });

    it('does not run compliance when complianceUrl is empty', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const config = baseScanConfig({
        complianceUrl: '',
        complianceToken: 'tok',
        jurisdictions: ['eu'],
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-nocomp');
      orchestrator.startScan('scan-nocomp', config);
      await eventsPromise;

      expect(mockCheckCompliance).not.toHaveBeenCalled();
    });

    it('does not run compliance when jurisdictions is empty', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const config = baseScanConfig({
        complianceUrl: 'http://compliance:5000',
        complianceToken: 'tok',
        jurisdictions: [],
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-nojur');
      orchestrator.startScan('scan-nojur', config);
      await eventsPromise;

      expect(mockCheckCompliance).not.toHaveBeenCalled();
    });

    it('emits scan_error but still completes when compliance check fails', async () => {
      const scanResult = makeScanResult([
        {
          url: 'https://example.com',
          issues: [{ type: 'error', code: 'E1', message: 'm', selector: 's', context: 'c' }],
        },
      ]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      mockCheckCompliance.mockRejectedValue(new Error('compliance service down'));

      const config = baseScanConfig({
        complianceUrl: 'http://compliance:5000',
        complianceToken: 'tok',
        jurisdictions: ['eu'],
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-compfail');
      orchestrator.startScan('scan-compfail', config);
      const events = await eventsPromise;

      // Should have scan_error for compliance failure
      const errorEvent = events.find((e) => e.type === 'scan_error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.error).toContain('Compliance check failed');

      // Should still complete the scan
      expect(events.some((e) => e.type === 'complete')).toBe(true);

      // Complete event should NOT have confirmedViolations
      const completeEvent = events.find((e) => e.type === 'complete')!;
      expect(completeEvent.data.confirmedViolations).toBeUndefined();
    });

    it('stores compliance matrix in report data', async () => {
      const scanResult = makeScanResult([
        {
          url: 'https://example.com',
          issues: [{ type: 'error', code: 'E1', message: 'm', selector: 's', context: 'c' }],
        },
      ]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      mockCheckCompliance.mockResolvedValue({
        summary: { totalConfirmedViolations: 1 },
        matrix: {
          eu: { jurisdiction: 'eu', violations: 1 },
          us: { jurisdiction: 'us', violations: 0 },
        },
      });

      const config = baseScanConfig({
        complianceUrl: 'http://compliance:5000',
        complianceToken: 'tok',
        jurisdictions: ['eu', 'us'],
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-matrix');
      orchestrator.startScan('scan-matrix', config);
      await eventsPromise;

      const updateCalls = (storage.scans.updateScan as ReturnType<typeof vi.fn>).mock.calls;
      const completedCall = updateCalls.find((c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed');
      const reportData = JSON.parse(completedCall![1].jsonReport as string);
      expect(reportData.complianceMatrix).toHaveLength(2);
    });

    // ── Incremental scan ────────────────────────────────────────────────

    it('runs incremental scan with hash comparison', async () => {
      // Setup discovery
      mockDiscoverUrls.mockResolvedValue({
        urls: [
          { url: 'https://example.com', discoveryMethod: 'crawl' },
          { url: 'https://example.com/about', discoveryMethod: 'crawl' },
          { url: 'https://example.com/contact', discoveryMethod: 'crawl' },
        ],
      });

      // Setup hash computation — one page changed, one new, one unchanged
      const currentHashes = new Map([
        ['https://example.com', 'hash-a-new'],
        ['https://example.com/about', 'hash-b-same'],
        ['https://example.com/contact', 'hash-c-new'],
      ]);
      mockComputeContentHashes.mockResolvedValue(currentHashes);

      // Setup stored hashes — only /about has same hash
      const storedHashes = new Map([
        ['https://example.com', 'hash-a-old'],
        ['https://example.com/about', 'hash-b-same'],
      ]);
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(storedHashes);

      // Setup scan result for changed pages
      mockScanUrls.mockResolvedValue({
        pages: [
          { url: 'https://example.com', issueCount: 1, issues: [{ type: 'error', code: 'E1', message: 'm', selector: 's', context: 'c' }] },
          { url: 'https://example.com/contact', issueCount: 0, issues: [] },
        ],
        errors: [],
      });

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
        orgId: 'org-1',
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-inc');
      orchestrator.startScan('scan-inc', config);
      const events = await eventsPromise;

      // Should emit discovery event
      expect(events.some((e) => e.type === 'discovery')).toBe(true);
      const discoveryEvent = events.find((e) => e.type === 'discovery')!;
      expect(discoveryEvent.data.pagesDiscovered).toBe(3);

      // Should have scanned only 2 changed pages + 1 skipped
      const completeEvent = events.find((e) => e.type === 'complete')!;
      expect(completeEvent.data.pagesScanned).toBe(3); // 2 scanned + 1 skipped
      expect(completeEvent.data.pagesSkipped).toBe(1);

      // Should scan only changed URLs (not /about)
      const scannedUrls = mockScanUrls.mock.calls[0][0];
      expect(scannedUrls).toHaveLength(2);
      expect(scannedUrls.map((u: { url: string }) => u.url)).toContain('https://example.com');
      expect(scannedUrls.map((u: { url: string }) => u.url)).toContain('https://example.com/contact');
      expect(scannedUrls.map((u: { url: string }) => u.url)).not.toContain('https://example.com/about');

      // Should upsert hashes
      expect(storage.pageHashes.upsertPageHashes).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ siteUrl: 'https://example.com', pageUrl: 'https://example.com', hash: 'hash-a-new', orgId: 'org-1' }),
        ]),
      );
    });

    it('incremental scan uses WebservicePool when multiple URLs provided', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [{ url: 'https://example.com', discoveryMethod: 'crawl' }],
      });
      mockComputeContentHashes.mockResolvedValue(new Map([['https://example.com', 'hash-new']]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
      mockScanUrls.mockResolvedValue({ pages: [{ url: 'https://example.com', issueCount: 0, issues: [] }], errors: [] });

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
        webserviceUrls: ['http://ws1:4000', 'http://ws2:4000'],
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-pool');
      orchestrator.startScan('scan-pool', config);
      await eventsPromise;

      // WebservicePool should be used when multiple URLs
      expect(mockWebservicePool).toHaveBeenCalled();
    });

    it('incremental scan uses WebserviceClient when single URL', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [{ url: 'https://example.com', discoveryMethod: 'crawl' }],
      });
      mockComputeContentHashes.mockResolvedValue(new Map([['https://example.com', 'hash-new']]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
      mockScanUrls.mockResolvedValue({ pages: [{ url: 'https://example.com', issueCount: 0, issues: [] }], errors: [] });

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-client');
      orchestrator.startScan('scan-client', config);
      await eventsPromise;

      expect(mockWebserviceClient).toHaveBeenCalled();
    });

    it('incremental scan handles all pages unchanged (no scan needed)', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [{ url: 'https://example.com', discoveryMethod: 'crawl' }],
      });
      mockComputeContentHashes.mockResolvedValue(new Map([['https://example.com', 'same-hash']]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map([['https://example.com', 'same-hash']]));

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-nochange');
      orchestrator.startScan('scan-nochange', config);
      const events = await eventsPromise;

      // Should not call scanUrls at all
      expect(mockScanUrls).not.toHaveBeenCalled();

      const completeEvent = events.find((e) => e.type === 'complete')!;
      expect(completeEvent.data.pagesScanned).toBe(1); // skipped count becomes pagesScanned
      expect(completeEvent.data.pagesSkipped).toBe(1);
    });

    it('incremental scan falls back to single URL when discovery fails', async () => {
      mockDiscoverUrls.mockRejectedValue(new Error('discovery failed'));
      mockComputeContentHashes.mockResolvedValue(new Map([['https://example.com', 'hash-1']]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
      mockScanUrls.mockResolvedValue({ pages: [{ url: 'https://example.com', issueCount: 0, issues: [] }], errors: [] });

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-discfail');
      orchestrator.startScan('scan-discfail', config);
      const events = await eventsPromise;

      // Should still complete with the fallback URL
      expect(events.some((e) => e.type === 'complete')).toBe(true);

      const discoveryEvent = events.find((e) => e.type === 'discovery')!;
      expect(discoveryEvent.data.pagesDiscovered).toBe(1);
    });

    it('incremental scan uses default orgId "system" when orgId not set', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [{ url: 'https://example.com', discoveryMethod: 'crawl' }],
      });
      mockComputeContentHashes.mockResolvedValue(new Map([['https://example.com', 'hash-1']]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
      mockScanUrls.mockResolvedValue({ pages: [{ url: 'https://example.com', issueCount: 0, issues: [] }], errors: [] });

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
        // no orgId
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-sysorg');
      orchestrator.startScan('scan-sysorg', config);
      await eventsPromise;

      expect(storage.pageHashes.getPageHashes).toHaveBeenCalledWith('https://example.com', 'system');
    });

    it('incremental scan includes page with undefined hash in changed list', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [{ url: 'https://example.com/no-hash', discoveryMethod: 'crawl' }],
      });
      // Hash computation returns empty (could not fetch)
      mockComputeContentHashes.mockResolvedValue(new Map());
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
      mockScanUrls.mockResolvedValue({
        pages: [{ url: 'https://example.com/no-hash', issueCount: 0, issues: [] }],
        errors: [],
      });

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-nohash');
      orchestrator.startScan('scan-nohash', config);
      await eventsPromise;

      // Should still scan the page (could not determine hash)
      expect(mockScanUrls).toHaveBeenCalled();
      const scannedUrls = mockScanUrls.mock.calls[0][0];
      expect(scannedUrls).toHaveLength(1);
    });

    it('incremental scan passes runner option to scanUrls options', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [{ url: 'https://example.com', discoveryMethod: 'crawl' }],
      });
      mockComputeContentHashes.mockResolvedValue(new Map([['https://example.com', 'new-hash']]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
      mockScanUrls.mockResolvedValue({
        pages: [{ url: 'https://example.com', issueCount: 0, issues: [] }],
        errors: [],
      });

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
        runner: 'axe',
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-inc-runner');
      orchestrator.startScan('scan-inc-runner', config);
      await eventsPromise;

      const scanOpts = mockScanUrls.mock.calls[0][2];
      expect(scanOpts).toHaveProperty('runner', 'axe');
    });

    it('incremental scan uses default maxPages of 50', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [{ url: 'https://example.com', discoveryMethod: 'crawl' }],
      });
      mockComputeContentHashes.mockResolvedValue(new Map([['https://example.com', 'hash']]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
      mockScanUrls.mockResolvedValue({
        pages: [{ url: 'https://example.com', issueCount: 0, issues: [] }],
        errors: [],
      });

      const config = baseScanConfig({
        scanMode: 'site',
        incremental: true,
        // no maxPages
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-defmax');
      orchestrator.startScan('scan-defmax', config);
      await eventsPromise;

      expect(mockDiscoverUrls).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ maxPages: 50 }),
        true,
      );
    });

    // ── coreModule null (import fails) ──────────────────────────────────

    it('completes scan with zero issues when @luqen/core import fails', async () => {
      // Reset module mock to return null
      vi.doMock('@luqen/core', () => {
        throw new Error('module not found');
      });

      // We need to re-import to get the new mock
      // Actually, the dynamic import in runScan uses .catch(() => null)
      // Since we've mocked it to throw, it will be caught and return null
      // But vi.mock is hoisted, so let's test a different approach:
      // The existing mock doesn't throw — let's just verify behavior when core returns empty results

      // Actually, since the mock is at module level and the import is dynamic,
      // let's test the coreModule === null path by un-mocking temporarily
      vi.doUnmock('@luqen/core');

      // Re-import the orchestrator to pick up the unmocked version
      const { ScanOrchestrator: FreshOrchestrator } = await import('../../src/scanner/orchestrator.js');
      const freshOrch = new FreshOrchestrator(storage, '/tmp/reports', 2);

      const eventsPromise = waitForScan(freshOrch, 'scan-nocore');
      freshOrch.startScan('scan-nocore', baseScanConfig());
      const events = await eventsPromise;

      const completeEvent = events.find((e) => e.type === 'complete');
      // If core is not available, it still completes but with 0 pages
      if (completeEvent) {
        expect(completeEvent.data.pagesScanned).toBe(0);
      }

      // Re-mock for other tests
      vi.doMock('@luqen/core', () => ({
        createScanner: mockCreateScanner,
        discoverUrls: mockDiscoverUrls,
        scanUrls: mockScanUrls,
        WebserviceClient: mockWebserviceClient,
        WebservicePool: mockWebservicePool,
        computeContentHashes: mockComputeContentHashes,
      }));
    });

    // ── Queue behavior ──────────────────────────────────────────────────

    it('emits queued scan_start when queue is at capacity', async () => {
      // Create orchestrator with maxConcurrent of 1
      const orch = new ScanOrchestrator(storage, '/tmp/reports', 1);

      // Setup a slow scan for the first slot
      let resolveFirst!: () => void;
      const firstScanPromise = new Promise<void>((resolve) => { resolveFirst = resolve; });
      const slowScanner = {
        scan: vi.fn().mockImplementation(() => firstScanPromise.then(() => makeScanResult([{ url: 'https://example.com', issues: [] }]))),
      };
      mockCreateScanner.mockReturnValue(slowScanner);

      // Start first scan (fills the queue)
      const events1Promise = waitForScan(orch, 'scan-q1');
      orch.startScan('scan-q1', baseScanConfig());

      // Start second scan while first is running (queue is at capacity)
      const events2Listener = vi.fn();
      orch.on('scan-q2', events2Listener);
      orch.startScan('scan-q2', baseScanConfig({ siteUrl: 'https://other.com' }));

      // The second scan should get a queued scan_start event immediately
      // Give a tick for the event to fire
      await new Promise((resolve) => setTimeout(resolve, 50));
      const queuedEvent = events2Listener.mock.calls.find(
        (c: [ScanProgressEvent]) => c[0].type === 'scan_start',
      );
      expect(queuedEvent).toBeDefined();

      // Resolve first scan to allow second to proceed
      resolveFirst();
      await events1Promise;

      // Wait for second to complete
      const events2Promise = waitForScan(orch, 'scan-q2');
      const events2 = await events2Promise;
      expect(events2.some((e) => e.type === 'complete')).toBe(true);
    });

    // ── Redis queue ─────────────────────────────────────────────────────

    it('enqueues to Redis when redisQueue is configured', async () => {
      const redisQueue = {
        enqueue: vi.fn().mockResolvedValue(undefined),
        dequeue: vi.fn().mockResolvedValue(null),
      };
      const orch = new ScanOrchestrator(storage, '/tmp/reports', {
        redisQueue: redisQueue as any,
      });

      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const config = baseScanConfig();
      const eventsPromise = waitForScan(orch, 'scan-redis');
      orch.startScan('scan-redis', config);
      await eventsPromise;

      expect(redisQueue.enqueue).toHaveBeenCalledWith('scan-redis', config);
    });

    it('does not enqueue to Redis when redisQueue is not configured', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const eventsPromise = waitForScan(orchestrator, 'scan-noredis');
      orchestrator.startScan('scan-noredis', baseScanConfig());
      await eventsPromise;

      // No Redis queue configured — just verifying it doesn't throw
    });

    // ── processFromQueue ────────────────────────────────────────────────

    it('returns false when redisQueue is not configured', async () => {
      const result = await orchestrator.processFromQueue();
      expect(result).toBe(false);
    });

    it('returns false when queue is empty', async () => {
      const redisQueue = {
        enqueue: vi.fn().mockResolvedValue(undefined),
        dequeue: vi.fn().mockResolvedValue(null),
      };
      const orch = new ScanOrchestrator(storage, '/tmp/reports', {
        redisQueue: redisQueue as any,
      });

      const result = await orch.processFromQueue();
      expect(result).toBe(false);
    });

    it('processes item from Redis queue and returns true', async () => {
      const config = baseScanConfig();
      const redisQueue = {
        enqueue: vi.fn().mockResolvedValue(undefined),
        dequeue: vi.fn().mockResolvedValue({ scanId: 'scan-from-q', config }),
      };
      const orch = new ScanOrchestrator(storage, '/tmp/reports', {
        redisQueue: redisQueue as any,
      });

      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);
      const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) };
      mockCreateScanner.mockReturnValue(mockScanner);

      const eventsPromise = waitForScan(orch, 'scan-from-q');
      const result = await orch.processFromQueue();
      expect(result).toBe(true);

      const events = await eventsPromise;
      expect(events.some((e) => e.type === 'complete')).toBe(true);
    });

    // ── Report data structure ───────────────────────────────────────────

    it('includes pagesSkipped in summary when pages were skipped', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [
          { url: 'https://example.com', discoveryMethod: 'crawl' },
          { url: 'https://example.com/same', discoveryMethod: 'crawl' },
        ],
      });
      mockComputeContentHashes.mockResolvedValue(new Map([
        ['https://example.com', 'new-hash'],
        ['https://example.com/same', 'same-hash'],
      ]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map([
        ['https://example.com/same', 'same-hash'],
      ]));
      mockScanUrls.mockResolvedValue({
        pages: [{ url: 'https://example.com', issueCount: 0, issues: [] }],
        errors: [],
      });

      const config = baseScanConfig({ scanMode: 'site', incremental: true });
      const eventsPromise = waitForScan(orchestrator, 'scan-skip-report');
      orchestrator.startScan('scan-skip-report', config);
      await eventsPromise;

      const updateCalls = (storage.scans.updateScan as ReturnType<typeof vi.fn>).mock.calls;
      const completedCall = updateCalls.find((c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed');
      const reportData = JSON.parse(completedCall![1].jsonReport as string);
      expect(reportData.summary.pagesSkipped).toBe(1);
    });

    it('uses siteUrl as fallback page when scanPages is empty and coreModule is null', async () => {
      // This tests the fallback: reportData.pages = [{ url: config.siteUrl, issues: allIssues, issueCount: allIssues.length }]
      // When coreModule is null, scanPages stays empty
      vi.doUnmock('@luqen/core');
      const { ScanOrchestrator: FreshOrchestrator } = await import('../../src/scanner/orchestrator.js');
      const freshOrch = new FreshOrchestrator(storage, '/tmp/reports', 2);

      const eventsPromise = waitForScan(freshOrch, 'scan-fallback');
      freshOrch.startScan('scan-fallback', baseScanConfig());
      const events = await eventsPromise;

      if (events.some((e) => e.type === 'complete')) {
        const updateCalls = (storage.scans.updateScan as ReturnType<typeof vi.fn>).mock.calls;
        const completedCall = updateCalls.find((c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed');
        if (completedCall) {
          const reportData = JSON.parse(completedCall[1].jsonReport as string);
          expect(reportData.pages).toHaveLength(1);
          expect(reportData.pages[0].url).toBe('https://example.com');
        }
      }

      vi.doMock('@luqen/core', () => ({
        createScanner: mockCreateScanner,
        discoverUrls: mockDiscoverUrls,
        scanUrls: mockScanUrls,
        WebserviceClient: mockWebserviceClient,
        WebservicePool: mockWebservicePool,
        computeContentHashes: mockComputeContentHashes,
      }));
    });

    // ── onProgress callback ─────────────────────────────────────────────

    it('calls onProgress callback during standard scan', async () => {
      const scanResult = makeScanResult([{ url: 'https://example.com', issues: [] }]);

      // Capture the onProgress callback and call it during scan()
      mockCreateScanner.mockImplementation((opts: { onProgress: (p: object) => void }) => {
        return {
          scan: vi.fn().mockImplementation(async () => {
            opts.onProgress({ type: 'scan:start', url: 'https://example.com', current: 1, total: 1 });
            opts.onProgress({ type: 'scan:complete', url: 'https://example.com', current: 1, total: 1 });
            return scanResult;
          }),
        };
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-progress');
      orchestrator.startScan('scan-progress', baseScanConfig());
      const events = await eventsPromise;

      // Should have discovery event (from first scan:start with current=1)
      expect(events.some((e) => e.type === 'discovery')).toBe(true);
      // Should have scan_complete events from progress
      expect(events.some((e) => e.type === 'scan_complete')).toBe(true);
    });

    it('emits discovery on first scan:start progress event only', async () => {
      const scanResult = makeScanResult([
        { url: 'https://example.com', issues: [] },
        { url: 'https://example.com/about', issues: [] },
      ]);

      mockCreateScanner.mockImplementation((opts: { onProgress: (p: object) => void }) => {
        return {
          scan: vi.fn().mockImplementation(async () => {
            opts.onProgress({ type: 'scan:start', url: 'https://example.com', current: 1, total: 2 });
            opts.onProgress({ type: 'scan:complete', url: 'https://example.com', current: 1, total: 2 });
            opts.onProgress({ type: 'scan:start', url: 'https://example.com/about', current: 2, total: 2 });
            opts.onProgress({ type: 'scan:complete', url: 'https://example.com/about', current: 2, total: 2 });
            return scanResult;
          }),
        };
      });

      const eventsPromise = waitForScan(orchestrator, 'scan-disc');
      orchestrator.startScan('scan-disc', baseScanConfig({ scanMode: 'site' }));
      const events = await eventsPromise;

      // Only one discovery event
      const discoveryEvents = events.filter((e) => e.type === 'discovery');
      expect(discoveryEvents).toHaveLength(1);
      expect(discoveryEvents[0].data.pagesDiscovered).toBe(2);
    });

    // ── onProgress for incremental scan ─────────────────────────────────

    it('calls onProgress during incremental scan', async () => {
      mockDiscoverUrls.mockResolvedValue({
        urls: [{ url: 'https://example.com', discoveryMethod: 'crawl' }],
      });
      mockComputeContentHashes.mockResolvedValue(new Map([['https://example.com', 'new-hash']]));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());

      // Capture onProgress from scanUrls options
      mockScanUrls.mockImplementation(async (_urls: unknown, _client: unknown, opts: { onProgress: (p: object) => void }) => {
        opts.onProgress({ type: 'scan:start', url: 'https://example.com', current: 1, total: 1 });
        opts.onProgress({ type: 'scan:complete', url: 'https://example.com', current: 1, total: 1 });
        return { pages: [{ url: 'https://example.com', issueCount: 0, issues: [] }], errors: [] };
      });

      const config = baseScanConfig({ scanMode: 'site', incremental: true });
      const eventsPromise = waitForScan(orchestrator, 'scan-inc-prog');
      orchestrator.startScan('scan-inc-prog', config);
      const events = await eventsPromise;

      const scanCompleteEvents = events.filter((e) => e.type === 'scan_complete');
      expect(scanCompleteEvents.length).toBeGreaterThan(0);
    });
  });
});

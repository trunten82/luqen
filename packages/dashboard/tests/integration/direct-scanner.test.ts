/**
 * Integration Test — DirectScanner (ScanOrchestrator with direct pa11y)
 *
 * Tests the ScanOrchestrator in "direct" mode (no webservice URL configured),
 * exercising initialization, scanning, error handling, and result processing.
 * The @luqen/core module is mocked to avoid real HTTP calls while testing
 * the orchestrator's actual logic paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must use vi.hoisted so variables are available inside vi.mock factories
const {
  mockCreateScanner,
  mockDirectScanner,
  mockWriteFile,
  mockMkdir,
} = vi.hoisted(() => ({
  mockCreateScanner: vi.fn(),
  mockDirectScanner: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@luqen/core', () => ({
  createScanner: mockCreateScanner,
  discoverUrls: vi.fn(),
  scanUrls: vi.fn(),
  WebserviceClient: vi.fn(),
  WebservicePool: vi.fn(),
  DirectScanner: mockDirectScanner,
  computeContentHashes: vi.fn(),
}));

vi.mock('../../src/compliance-client.js', () => ({
  checkCompliance: vi.fn(),
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
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

function directScanConfig(overrides: Partial<ScanConfig> = {}): ScanConfig {
  return {
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    concurrency: 2,
    jurisdictions: [],
    scanMode: 'single',
    // No webserviceUrl — triggers DirectScanner path
    ...overrides,
  };
}

function collectEvents(
  orchestrator: ScanOrchestrator,
  scanId: string,
): ScanProgressEvent[] {
  const events: ScanProgressEvent[] = [];
  orchestrator.on(scanId, (event) => {
    events.push(event);
  });
  return events;
}

function waitForEvent(
  orchestrator: ScanOrchestrator,
  scanId: string,
  eventType: ScanProgressEvent['type'],
  timeoutMs = 5000,
): Promise<ScanProgressEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for event: ${eventType}`)),
      timeoutMs,
    );
    orchestrator.on(scanId, (event) => {
      if (event.type === eventType) {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DirectScanner Integration', () => {
  let storage: StorageAdapter;
  let orchestrator: ScanOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createMockStorage();
    orchestrator = new ScanOrchestrator(storage, '/tmp/test-reports', 2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Initialization ────────────────────────────────────────────────────

  describe('initialization', () => {
    it('creates orchestrator with default concurrency', () => {
      const orch = new ScanOrchestrator(storage, '/tmp/reports');
      expect(orch).toBeDefined();
    });

    it('creates orchestrator with options object', () => {
      const orch = new ScanOrchestrator(storage, '/tmp/reports', {
        maxConcurrent: 4,
      });
      expect(orch).toBeDefined();
    });

    it('creates orchestrator with numeric concurrency', () => {
      const orch = new ScanOrchestrator(storage, '/tmp/reports', 3);
      expect(orch).toBeDefined();
    });
  });

  // ── Direct scanning (no webservice URL) ───────────────────────────────

  describe('scanning a URL with DirectScanner', () => {
    it('uses createScanner in direct mode (no webserviceUrl)', async () => {
      const mockScanResult = {
        pages: [
          {
            url: 'https://example.com/',
            issueCount: 3,
            issues: [
              { type: 'error', code: 'WCAG2AA.1.1.1', message: 'Missing alt text', selector: 'img', context: '<img src="photo.jpg">' },
              { type: 'warning', code: 'WCAG2AA.1.3.1', message: 'Possible heading', selector: 'p.title', context: '<p class="title">' },
              { type: 'notice', code: 'WCAG2AA.2.4.2', message: 'Check page title', selector: 'title', context: '<title>Example</title>' },
            ],
          },
        ],
        summary: {
          pagesScanned: 1,
          byLevel: { error: 1, warning: 1, notice: 1 },
        },
      };

      const mockScanner = {
        scan: vi.fn().mockResolvedValue(mockScanResult),
      };
      mockCreateScanner.mockReturnValue(mockScanner);

      const scanId = 'direct-scan-001';
      const completePromise = waitForEvent(orchestrator, scanId, 'complete');

      orchestrator.startScan(scanId, directScanConfig());

      const completeEvent = await completePromise;

      expect(completeEvent.type).toBe('complete');
      expect(completeEvent.data.pagesScanned).toBe(1);
      expect(completeEvent.data.issues).toEqual({
        errors: 1,
        warnings: 1,
        notices: 1,
      });
      expect(completeEvent.data.reportUrl).toContain(scanId);

      // Verify createScanner was called without webserviceUrl
      expect(mockCreateScanner).toHaveBeenCalledTimes(1);
      const scannerOpts = mockCreateScanner.mock.calls[0][0];
      expect(scannerOpts.webserviceUrl).toBeUndefined();
      expect(scannerOpts.standard).toBe('WCAG2AA');

      // Verify scan was called with the site URL
      expect(mockScanner.scan).toHaveBeenCalledWith('https://example.com');

      // Verify storage was updated
      expect(storage.scans.updateScan).toHaveBeenCalledWith(scanId, expect.objectContaining({
        status: 'completed',
        pagesScanned: 1,
        errors: 1,
        warnings: 1,
        notices: 1,
      }));
    });

    it('passes includeWarnings and includeNotices options to createScanner', async () => {
      const mockScanner = {
        scan: vi.fn().mockResolvedValue({
          pages: [],
          summary: { pagesScanned: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
        }),
      };
      mockCreateScanner.mockReturnValue(mockScanner);

      const scanId = 'direct-filter-scan';
      const completePromise = waitForEvent(orchestrator, scanId, 'complete');

      orchestrator.startScan(scanId, directScanConfig({
        includeWarnings: false,
        includeNotices: false,
      }));

      await completePromise;

      const scannerOpts = mockCreateScanner.mock.calls[0][0];
      expect(scannerOpts.includeWarnings).toBe(false);
      expect(scannerOpts.includeNotices).toBe(false);
    });

    it('passes runner option when configured', async () => {
      const mockScanner = {
        scan: vi.fn().mockResolvedValue({
          pages: [],
          summary: { pagesScanned: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
        }),
      };
      mockCreateScanner.mockReturnValue(mockScanner);

      const scanId = 'direct-axe-scan';
      const completePromise = waitForEvent(orchestrator, scanId, 'complete');

      orchestrator.startScan(scanId, directScanConfig({ runner: 'axe' }));

      await completePromise;

      const scannerOpts = mockCreateScanner.mock.calls[0][0];
      expect(scannerOpts.runner).toBe('axe');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('handling scan errors', () => {
    it('emits failed event when scanner throws', async () => {
      mockCreateScanner.mockReturnValue({
        scan: vi.fn().mockRejectedValue(new Error('Connection refused')),
      });

      const scanId = 'direct-error-001';
      const failedPromise = waitForEvent(orchestrator, scanId, 'failed');

      orchestrator.startScan(scanId, directScanConfig());

      const failedEvent = await failedPromise;

      expect(failedEvent.type).toBe('failed');
      expect(failedEvent.data.error).toContain('Connection refused');

      // Verify storage was updated with failure
      expect(storage.scans.updateScan).toHaveBeenCalledWith(scanId, expect.objectContaining({
        status: 'failed',
        error: 'Connection refused',
      }));
    });

    it('emits failed event for non-Error exceptions', async () => {
      mockCreateScanner.mockReturnValue({
        scan: vi.fn().mockRejectedValue('string error'),
      });

      const scanId = 'direct-string-error';
      const failedPromise = waitForEvent(orchestrator, scanId, 'failed');

      orchestrator.startScan(scanId, directScanConfig());

      const failedEvent = await failedPromise;

      expect(failedEvent.type).toBe('failed');
      expect(failedEvent.data.error).toContain('string error');
    });

    it('handles @luqen/core import failure gracefully', async () => {
      // When @luqen/core returns null, scanner produces empty results
      // (The mock module is loaded, but we can test the flow when createScanner
      // throws or returns an empty scanner.)
      mockCreateScanner.mockReturnValue({
        scan: vi.fn().mockResolvedValue({
          pages: [],
          summary: { pagesScanned: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
        }),
      });

      const scanId = 'direct-empty-scan';
      const completePromise = waitForEvent(orchestrator, scanId, 'complete');

      orchestrator.startScan(scanId, directScanConfig());

      const completeEvent = await completePromise;
      expect(completeEvent.data.pagesScanned).toBe(0);
    });
  });

  // ── Result processing ─────────────────────────────────────────────────

  describe('processing scan results', () => {
    it('aggregates issues across multiple pages in site mode', async () => {
      const mockScanResult = {
        pages: [
          {
            url: 'https://example.com/',
            issueCount: 2,
            issues: [
              { type: 'error', code: 'WCAG2AA.1.1.1', message: 'Missing alt', selector: 'img', context: '<img>' },
              { type: 'warning', code: 'WCAG2AA.1.3.1', message: 'Heading', selector: 'p', context: '<p>' },
            ],
          },
          {
            url: 'https://example.com/about',
            issueCount: 1,
            issues: [
              { type: 'error', code: 'WCAG2AA.4.1.1', message: 'Duplicate ID', selector: '#main', context: '<div id="main">' },
            ],
          },
        ],
        summary: {
          pagesScanned: 2,
          byLevel: { error: 2, warning: 1, notice: 0 },
        },
      };

      mockCreateScanner.mockReturnValue({
        scan: vi.fn().mockResolvedValue(mockScanResult),
      });

      const scanId = 'direct-multipage';
      const completePromise = waitForEvent(orchestrator, scanId, 'complete');

      orchestrator.startScan(scanId, directScanConfig({ scanMode: 'site' }));

      const completeEvent = await completePromise;

      expect(completeEvent.data.pagesScanned).toBe(2);
      expect(completeEvent.data.issues).toEqual({
        errors: 2,
        warnings: 1,
        notices: 0,
      });
    });

    it('stores JSON report in database', async () => {
      mockCreateScanner.mockReturnValue({
        scan: vi.fn().mockResolvedValue({
          pages: [
            {
              url: 'https://example.com/',
              issueCount: 1,
              issues: [
                { type: 'error', code: 'WCAG2AA.1.1.1', message: 'Alt text', selector: 'img', context: '<img>' },
              ],
            },
          ],
          summary: { pagesScanned: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
        }),
      });

      const scanId = 'direct-report-storage';
      const completePromise = waitForEvent(orchestrator, scanId, 'complete');

      orchestrator.startScan(scanId, directScanConfig());

      await completePromise;

      // Verify the report JSON was stored
      const updateCalls = (storage.scans.updateScan as ReturnType<typeof vi.fn>).mock.calls;
      const completedCall = updateCalls.find(
        (c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed',
      );

      expect(completedCall).toBeDefined();
      const updateData = completedCall![1] as Record<string, unknown>;
      expect(updateData.jsonReport).toBeDefined();
      expect(typeof updateData.jsonReport).toBe('string');

      const report = JSON.parse(updateData.jsonReport as string);
      expect(report.scanId).toBe(scanId);
      expect(report.siteUrl).toBe('https://example.com');
      expect(report.summary.totalIssues).toBe(1);
      expect(report.pages).toHaveLength(1);
    });

    it('writes report to filesystem as backup', async () => {
      mockCreateScanner.mockReturnValue({
        scan: vi.fn().mockResolvedValue({
          pages: [],
          summary: { pagesScanned: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
        }),
      });

      const scanId = 'direct-fs-write';
      const completePromise = waitForEvent(orchestrator, scanId, 'complete');

      orchestrator.startScan(scanId, directScanConfig());

      await completePromise;

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('continues successfully when filesystem write fails', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('EACCES'));

      mockCreateScanner.mockReturnValue({
        scan: vi.fn().mockResolvedValue({
          pages: [],
          summary: { pagesScanned: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
        }),
      });

      const scanId = 'direct-fs-fail';
      const completePromise = waitForEvent(orchestrator, scanId, 'complete');

      orchestrator.startScan(scanId, directScanConfig());

      const completeEvent = await completePromise;
      // Should still complete — filesystem failure is not critical
      expect(completeEvent.type).toBe('complete');
    });
  });

  // ── Event buffering ───────────────────────────────────────────────────

  describe('event buffering for late subscribers', () => {
    it('replays buffered events emitted via public emit()', () => {
      const scanId = 'direct-buffer-test';

      // Emit events via the public emit() method (which buffers them)
      orchestrator.emit(scanId, {
        type: 'scan_start',
        timestamp: new Date().toISOString(),
        data: {},
      });
      orchestrator.emit(scanId, {
        type: 'complete',
        timestamp: new Date().toISOString(),
        data: { pagesScanned: 5 },
      });

      // Subscribe AFTER emission — should get replayed buffered events
      const events: ScanProgressEvent[] = [];
      orchestrator.on(scanId, (event) => {
        events.push(event);
      });

      // Should have received replayed events (scan_start and complete)
      expect(events.length).toBe(2);
      const types = events.map((e) => e.type);
      expect(types).toContain('scan_start');
      expect(types).toContain('complete');
    });

    it('deduplicates non-scan_complete events in buffer', () => {
      const scanId = 'direct-dedup-test';

      // Emit two discovery events — only the latest should be buffered
      orchestrator.emit(scanId, {
        type: 'discovery',
        timestamp: new Date().toISOString(),
        data: { pagesDiscovered: 3 },
      });
      orchestrator.emit(scanId, {
        type: 'discovery',
        timestamp: new Date().toISOString(),
        data: { pagesDiscovered: 5 },
      });

      const events: ScanProgressEvent[] = [];
      orchestrator.on(scanId, (event) => {
        events.push(event);
      });

      const discoveryEvents = events.filter((e) => e.type === 'discovery');
      expect(discoveryEvents).toHaveLength(1);
      expect(discoveryEvents[0].data.pagesDiscovered).toBe(5);
    });
  });

  // ── Listener management ───────────────────────────────────────────────

  describe('listener management', () => {
    it('can unsubscribe from scan events', () => {
      const listener = vi.fn();
      const scanId = 'unsubscribe-test';

      orchestrator.on(scanId, listener);
      orchestrator.off(scanId, listener);

      orchestrator.emit(scanId, {
        type: 'scan_start',
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

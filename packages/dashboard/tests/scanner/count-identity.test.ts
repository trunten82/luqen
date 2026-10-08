/**
 * D-09(a) count-identity gate: with ZERO dismissals, countIssues(stored jsonReport)
 * must equal the errors / warnings / notices / totalIssues columns the REAL
 * ScanOrchestrator wrote for the same scan.
 *
 * The report and the columns are both taken from the completed updateScan call
 * of a real ScanOrchestrator.startScan — the test never builds the report.
 *
 * What is mocked: @luqen/core. On the STANDARD path the orchestrator copies core's
 * `result.summary.byLevel`, so `coreByLevel` below MIRRORS packages/core/src/index.ts
 * lines 388-400 (error -> error, warning -> warning, anything else -> notice). That
 * is a mirror, not a measurement of real core output; the read-only prod run in
 * Plan 05 (D-09 part b) is what measures real core output against the stored columns.
 * The INCREMENTAL path computes its own counts inside the orchestrator, so there the
 * counting loop under test is the real one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockCreateScanner,
  mockDiscoverUrls,
  mockScanUrls,
  mockWebserviceClient,
  mockWebservicePool,
  mockDirectScanner,
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
  mockDirectScanner: vi.fn(),
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
  DirectScanner: mockDirectScanner,
  computeContentHashes: mockComputeContentHashes,
}));

vi.mock('../../src/compliance-client.js', () => ({
  checkCompliance: mockCheckCompliance,
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { ScanConfig, ScanProgressEvent } from '../../src/scanner/orchestrator.js';
import type { StorageAdapter } from '../../src/db/index.js';
import { countIssues } from '../../src/services/count-issues.js';
import { applyDismissals } from '../../src/services/issue-dismissals/apply-dismissals.js';
import { toSiteKey } from '../../src/services/issue-dismissals/site-key.js';

// ---------------------------------------------------------------------------
// Scaffolding (copied from tests/scanner/orchestrator.test.ts)
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
    regulations: [],
    scanMode: 'single',
    webserviceUrl: 'http://localhost:4000',
    ...overrides,
  };
}

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

function waitForScan(orchestrator: ScanOrchestrator, scanId: string, timeoutMs = 5000): Promise<ScanProgressEvent[]> {
  return Promise.race([
    collectEvents(orchestrator, scanId),
    new Promise<ScanProgressEvent[]>((_, reject) =>
      setTimeout(() => reject(new Error('Scan timed out')), timeoutMs),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Fixtures — every call builds fresh objects
// ---------------------------------------------------------------------------

interface FixtureIssue {
  readonly type?: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
}
interface FixturePage {
  readonly url: string;
  readonly issueCount: number;
  readonly issues: FixtureIssue[];
}

function issue(code: string, selector: string, type?: string): FixtureIssue {
  return {
    ...(type !== undefined ? { type } : {}),
    code,
    message: `message for ${code}`,
    selector,
    context: `<x data-code="${code}">`,
  };
}

function page(url: string, issues: FixtureIssue[]): FixturePage {
  return { url, issueCount: issues.length, issues };
}

/** Mirrors packages/core/src/index.ts:388-400 — error / warning / ELSE notice. */
function coreByLevel(pages: readonly FixturePage[]): { error: number; warning: number; notice: number } {
  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const p of pages) {
    for (const i of p.issues) {
      if (i.type === 'error') byLevel.error++;
      else if (i.type === 'warning') byLevel.warning++;
      else byLevel.notice++;
    }
  }
  return byLevel;
}

const REPEATED = { code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18', selector: '.nav > a.low-contrast' };

/** 4-page site: error / warning / notice / unknown 'info' / NO type, plus one finding repeated on 3 pages. */
function mixedPages(): FixturePage[] {
  return [
    page('https://example.com/', [
      issue('E1', '#a', 'error'),
      issue('W1', '#b', 'warning'),
      issue('N1', '#c', 'notice'),
      issue('I1', '#d', 'info'),
      issue('T1', '#e'),
      issue(REPEATED.code, REPEATED.selector, 'warning'),
    ]),
    page('https://example.com/about', [
      issue(REPEATED.code, REPEATED.selector, 'warning'),
      issue('E2', '#f', 'error'),
    ]),
    page('https://example.com/contact', [issue(REPEATED.code, REPEATED.selector, 'warning')]),
    page('https://example.com/empty', []),
  ];
}

interface StoredScan {
  readonly columns: { errors: number; warnings: number; notices: number; totalIssues: number };
  readonly jsonReport: string;
}

function completedUpdate(storage: StorageAdapter): StoredScan {
  const calls = (storage.scans.updateScan as ReturnType<typeof vi.fn>).mock.calls;
  const completed = calls.find((c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed');
  expect(completed, 'orchestrator never wrote a completed updateScan').toBeDefined();
  const update = completed![1] as Record<string, unknown>;
  return {
    columns: {
      errors: update.errors as number,
      warnings: update.warnings as number,
      notices: update.notices as number,
      totalIssues: update.totalIssues as number,
    },
    jsonReport: update.jsonReport as string,
  };
}

function asColumns(c: ReturnType<typeof countIssues>): StoredScan['columns'] {
  return { errors: c.errors, warnings: c.warnings, notices: c.notices, totalIssues: c.total };
}

describe('count identity: countIssues reproduces the columns the real orchestrator stores (D-09a)', () => {
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

  async function runStandardScan(scanId: string, pages: FixturePage[]): Promise<StoredScan> {
    const scanResult = {
      pages,
      summary: { pagesScanned: pages.length, byLevel: coreByLevel(pages) },
    };
    mockCreateScanner.mockReturnValue({ scan: vi.fn().mockResolvedValue(scanResult) });
    const done = waitForScan(orchestrator, scanId);
    orchestrator.startScan(scanId, baseScanConfig({ scanMode: 'site' }));
    await done;
    return completedUpdate(storage);
  }

  it('standard path: countIssues(stored jsonReport) equals the stored columns', async () => {
    const stored = await runStandardScan('scan-std', mixedPages());

    // The fixture really exercises every branch (a vacuous all-zero identity would prove nothing).
    expect(stored.columns).toEqual({ errors: 2, warnings: 4, notices: 3, totalIssues: 9 });
    expect(asColumns(countIssues(JSON.parse(stored.jsonReport)))).toEqual(stored.columns);
  });

  it('tracer: one dismissal removes exactly its 3 occurrences and the count drops by exactly 3', async () => {
    const stored = await runStandardScan('scan-tracer', mixedPages());
    const raw = JSON.parse(stored.jsonReport);
    const siteKey = toSiteKey('https://example.com');

    const applied = applyDismissals(
      raw,
      [{ id: 'd-1', code: REPEATED.code, selector: REPEATED.selector, siteKey }],
      siteKey,
    );

    expect(applied.dismissed).toHaveLength(3);
    expect(applied.dismissed.map((d) => d.pageUrl).sort()).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/contact',
    ]);
    expect(applied.dismissed.every((d) => d.dismissalId === 'd-1')).toBe(true);

    // The three occurrences are all warnings.
    expect(asColumns(countIssues(applied.report))).toEqual({
      errors: stored.columns.errors,
      warnings: stored.columns.warnings - 3,
      notices: stored.columns.notices,
      totalIssues: stored.columns.totalIssues - 3,
    });
  });

  it('standard path with zero issues: columns and countIssues are both zero', async () => {
    const stored = await runStandardScan('scan-zero', [page('https://example.com/', [])]);

    expect(stored.columns).toEqual({ errors: 0, warnings: 0, notices: 0, totalIssues: 0 });
    expect(asColumns(countIssues(JSON.parse(stored.jsonReport)))).toEqual(stored.columns);
  });

  describe('incremental path (the orchestrator runs its own counting loop)', () => {
    const SITE = 'https://example.com';

    function discover(urls: string[], current: Record<string, string>, stored: Record<string, string>): void {
      mockDiscoverUrls.mockResolvedValue({ urls: urls.map((url) => ({ url, discoveryMethod: 'crawl' })) });
      mockComputeContentHashes.mockResolvedValue(new Map(Object.entries(current)));
      (storage.pageHashes.getPageHashes as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Map(Object.entries(stored)),
      );
    }

    async function runIncremental(scanId: string): Promise<StoredScan> {
      const done = waitForScan(orchestrator, scanId);
      orchestrator.startScan(scanId, baseScanConfig({ scanMode: 'site', incremental: true, orgId: 'org-1' }));
      await done;
      return completedUpdate(storage);
    }

    it('skips an unchanged page and still reproduces the columns for the changed ones', async () => {
      discover(
        [`${SITE}/`, `${SITE}/about`, `${SITE}/contact`],
        { [`${SITE}/`]: 'a-new', [`${SITE}/about`]: 'b-same', [`${SITE}/contact`]: 'c-new' },
        { [`${SITE}/`]: 'a-old', [`${SITE}/about`]: 'b-same' },
      );
      const changed = [
        page(`${SITE}/`, [
          issue('E1', '#a', 'error'),
          issue('I1', '#b', 'info'),
          issue('T1', '#c'),
          issue('W1', '#d', 'warning'),
        ]),
        page(`${SITE}/contact`, [issue('N1', '#e', 'notice'), issue('E2', '#f', 'error')]),
      ];
      mockScanUrls.mockResolvedValue({ pages: changed, errors: [] });

      const stored = await runIncremental('scan-inc-mixed');

      expect(mockScanUrls.mock.calls[0][0]).toHaveLength(2);
      expect(stored.columns).toEqual({ errors: 2, warnings: 1, notices: 3, totalIssues: 6 });
      expect(asColumns(countIssues(JSON.parse(stored.jsonReport)))).toEqual(stored.columns);
    });

    it('with NO changed pages the columns are all 0 and so is countIssues', async () => {
      discover([`${SITE}/`], { [`${SITE}/`]: 'same' }, { [`${SITE}/`]: 'same' });

      const stored = await runIncremental('scan-inc-nochange');

      expect(mockScanUrls).not.toHaveBeenCalled();
      expect(stored.columns).toEqual({ errors: 0, warnings: 0, notices: 0, totalIssues: 0 });
      expect(asColumns(countIssues(JSON.parse(stored.jsonReport)))).toEqual(stored.columns);
    });
  });
});

/**
 * Phase 18 rewire invariant tests — scanner branding integration.
 *
 * Seven invariant-pinning tests that lock in the Plan 18-03 behavior:
 *
 *  1. One match call per scan (Pitfall #10)
 *  2. Matched branch persists a scored ScoreResult with mode tag
 *  3. Matched branch preserves display enrichment (brandMatch on page issues)
 *  4. CRITICAL: Degraded result STILL persists an unscorable row and the
 *     scan still completes (BSTORE-02 + no-silent-cross-route)
 *  5. No-guideline result does NOT call insert (absence = "not measured")
 *  6. Persistence failure is non-blocking — scan still completes
 *  7. BSTORE-06: scanner only inserts for the current scan (no backfill)
 *
 * Kept in a dedicated file (separate from tests/scanner/orchestrator.test.ts)
 * so when Phase 18 regresses, the failure localizes to a single file whose
 * sole purpose is enforcing the rewire invariants.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks for @luqen/core + fs (borrowed from tests/scanner/orchestrator.test.ts) ──
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
import type {
  BrandingOrchestrator,
  MatchAndScoreResult,
} from '../../src/services/branding/branding-orchestrator.js';
import type { BrandScoreRepository } from '../../src/db/interfaces/brand-score-repository.js';
import type { ScoreResult } from '../../src/services/scoring/types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURE_SCORE_RESULT: ScoreResult = {
  kind: 'scored',
  overall: 72,
  color: {
    kind: 'scored',
    value: 80,
    detail: { dimension: 'color', passes: 8, fails: 2 },
  },
  typography: {
    kind: 'scored',
    value: 67,
    detail: {
      dimension: 'typography',
      fontOk: true,
      sizeOk: true,
      lineHeightOk: false,
    },
  },
  components: {
    kind: 'scored',
    value: 60,
    detail: { dimension: 'components', matched: 3, total: 5 },
  },
  coverage: {
    color: true,
    typography: true,
    components: true,
    contributingWeight: 1.0,
  },
};

const FIXTURE_GUIDELINE_RECORD = {
  id: 'gd-test',
  orgId: 'org-test',
  name: 'Test Guideline',
  version: 1,
  active: true,
  colors: [{ id: 'c1', name: 'Brand Orange', hexValue: '#FF6900' }],
  fonts: [{ id: 'f1', family: 'Helvetica' }],
  selectors: [{ id: 's1', pattern: '.btn-primary' }],
};

const FIXTURE_SCAN_PAGE = {
  url: 'https://test.example.com/',
  discoveryMethod: 'seed',
  issueCount: 1,
  issues: [
    {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
      type: 'error' as const,
      message: 'Contrast 2:1',
      selector: '.hero-cta',
      context: '<button class="hero-cta">Go</button>',
    },
  ],
};

// ── Mock factories ──────────────────────────────────────────────────────────

function makeMockStorage(
  guideline: typeof FIXTURE_GUIDELINE_RECORD | null,
): StorageAdapter {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    migrate: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    name: 'mock',
    scans: {
      createScan: vi.fn().mockResolvedValue({}),
      updateScan: vi.fn().mockResolvedValue(undefined),
      getScan: vi.fn().mockResolvedValue(null),
      listScans: vi.fn().mockResolvedValue([]),
      countScans: vi.fn().mockResolvedValue(0),
      deleteScan: vi.fn().mockResolvedValue(undefined),
      deleteOrgScans: vi.fn().mockResolvedValue(undefined),
      getReport: vi.fn().mockResolvedValue(null),
      getTrendData: vi.fn().mockResolvedValue([]),
      getLatestPerSite: vi.fn().mockResolvedValue([]),
    },
    branding: {
      getGuidelineForSite: vi.fn().mockResolvedValue(guideline),
    },
    pageHashes: {
      getPageHashes: vi.fn().mockResolvedValue(new Map()),
      upsertPageHash: vi.fn().mockResolvedValue(undefined),
      upsertPageHashes: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as StorageAdapter;
}

function makeMockBrandingOrchestrator(
  result: MatchAndScoreResult,
): BrandingOrchestrator {
  return {
    matchAndScore: vi.fn().mockResolvedValue(result),
  } as unknown as BrandingOrchestrator;
}

function makeMockBrandScoreRepository(
  insertImpl: (result: ScoreResult) => Promise<void> = async () => undefined,
): BrandScoreRepository {
  return {
    insert: vi.fn(insertImpl),
    getLatestForScan: vi.fn().mockResolvedValue(null),
    getHistoryForSite: vi.fn().mockResolvedValue([]),
  } as unknown as BrandScoreRepository;
}

const BASE_CONFIG: ScanConfig = {
  siteUrl: 'https://test.example.com/',
  standard: 'WCAG2AA',
  concurrency: 1,
  jurisdictions: [],
  regulations: [],
  scanMode: 'single',
  orgId: 'org-test',
  maxPages: 1,
};

async function runScanAndWait(
  orchestrator: ScanOrchestrator,
  scanId: string,
  config: ScanConfig = BASE_CONFIG,
): Promise<ScanProgressEvent> {
  return new Promise((resolve) => {
    const listener = (event: ScanProgressEvent): void => {
      if (event.type === 'complete' || event.type === 'failed') {
        orchestrator.off(scanId, listener);
        resolve(event);
      }
    };
    orchestrator.on(scanId, listener);
    orchestrator.startScan(scanId, config);
  });
}

// Stub @luqen/core so the scanner's pa11y path yields deterministic pages.
// BASE_CONFIG uses `scanMode: 'single'` which goes through the "Standard
// (non-incremental)" branch — createScanner(...).scan(url). The returned
// scanResult shape must match { pages: [...], summary: { pagesScanned, byLevel } }.
function setupCoreMockForSinglePage(): void {
  const byLevel = { error: 1, warning: 0, notice: 0 };
  const scanResult = {
    pages: [
      {
        url: FIXTURE_SCAN_PAGE.url,
        issueCount: FIXTURE_SCAN_PAGE.issues.length,
        issues: FIXTURE_SCAN_PAGE.issues,
      },
    ],
    summary: { pagesScanned: 1, byLevel },
  };
  mockCreateScanner.mockReturnValue({
    scan: vi.fn().mockResolvedValue(scanResult),
  });
  mockDiscoverUrls.mockResolvedValue({
    urls: [{ url: FIXTURE_SCAN_PAGE.url, discoveryMethod: 'seed' }],
  });
  mockScanUrls.mockResolvedValue({
    pages: [FIXTURE_SCAN_PAGE],
    errors: [],
  });
  mockComputeContentHashes.mockResolvedValue(new Map());
  mockCheckCompliance.mockResolvedValue({
    ok: true,
    matrix: {},
    regulationMatrix: {},
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Phase 18 rewire invariant — scanner branding integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCoreMockForSinglePage();
  });

  it('Test 1: calls brandingOrchestrator.matchAndScore EXACTLY once per scan (Pitfall #10)', async () => {
    const storage = makeMockStorage(FIXTURE_GUIDELINE_RECORD);
    const brandingOrchestrator = makeMockBrandingOrchestrator({
      kind: 'matched',
      mode: 'embedded',
      brandedIssues: [],
      scoreResult: FIXTURE_SCORE_RESULT,
      brandRelatedCount: 0,
    });
    const brandScoreRepository = makeMockBrandScoreRepository();

    const orchestrator = new ScanOrchestrator(storage, '/tmp/reports', {
      maxConcurrent: 1,
      brandingOrchestrator,
      brandScoreRepository,
    });

    await runScanAndWait(orchestrator, 'scan-01');

    expect(brandingOrchestrator.matchAndScore).toHaveBeenCalledTimes(1);
  });

  it('Test 2: matched branch persists ScoreResult with mode tag', async () => {
    const storage = makeMockStorage(FIXTURE_GUIDELINE_RECORD);
    const brandingOrchestrator = makeMockBrandingOrchestrator({
      kind: 'matched',
      mode: 'embedded',
      brandedIssues: [],
      scoreResult: FIXTURE_SCORE_RESULT,
      brandRelatedCount: 0,
    });
    const brandScoreRepository = makeMockBrandScoreRepository();

    const orchestrator = new ScanOrchestrator(storage, '/tmp/reports', {
      maxConcurrent: 1,
      brandingOrchestrator,
      brandScoreRepository,
    });

    await runScanAndWait(orchestrator, 'scan-02');

    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(1);
    const [writtenResult, writtenContext] = (
      brandScoreRepository.insert as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(writtenResult.kind).toBe('scored');
    expect(writtenResult.overall).toBe(72);
    expect(writtenContext.scanId).toBe('scan-02');
    expect(writtenContext.mode).toBe('embedded');
    expect(writtenContext.orgId).toBe('org-test');
    expect(writtenContext.siteUrl).toBe('https://test.example.com/');
    expect(writtenContext.guidelineId).toBe('gd-test');
    expect(writtenContext.guidelineVersion).toBe(1);
  });

  it('Test 3: matched branch preserves display enrichment — brandMatch attached to matching issue', async () => {
    const storage = makeMockStorage(FIXTURE_GUIDELINE_RECORD);
    // Return a single branded issue that matches the fixture page issue
    const brandingOrchestrator = makeMockBrandingOrchestrator({
      kind: 'matched',
      mode: 'embedded',
      brandedIssues: [
        {
          issue: FIXTURE_SCAN_PAGE.issues[0] as any,
          brandMatch: {
            matched: true,
            reason: 'color',
            tokenId: 'c1',
          } as any,
        } as any,
      ],
      scoreResult: FIXTURE_SCORE_RESULT,
      brandRelatedCount: 1,
    });
    const brandScoreRepository = makeMockBrandScoreRepository();
    const orchestrator = new ScanOrchestrator(storage, '/tmp/reports', {
      maxConcurrent: 1,
      brandingOrchestrator,
      brandScoreRepository,
    });

    await runScanAndWait(orchestrator, 'scan-03');

    // The scanner persists reportData via storage.scans.updateScan; inspect the call
    const updateCall = (
      storage.scans.updateScan as ReturnType<typeof vi.fn>
    ).mock.calls.find((c: any[]) => c[1].status === 'completed');
    expect(updateCall).toBeDefined();
    const jsonReport = JSON.parse(updateCall![1].jsonReport as string);
    const page = jsonReport.pages[0];
    expect(page.issues[0].brandMatch).toBeDefined();
    expect(page.issues[0].brandMatch.matched).toBe(true);
    expect(updateCall![1].brandRelatedCount).toBe(1);
  });

  it('Test 4 (CRITICAL): degraded result STILL persists an unscorable row and scan still completes', async () => {
    const storage = makeMockStorage(FIXTURE_GUIDELINE_RECORD);
    const brandingOrchestrator = makeMockBrandingOrchestrator({
      kind: 'degraded',
      mode: 'remote',
      reason: 'remote-unavailable',
      error: 'ECONNREFUSED 127.0.0.1:4100',
    });
    const brandScoreRepository = makeMockBrandScoreRepository();
    const orchestrator = new ScanOrchestrator(storage, '/tmp/reports', {
      maxConcurrent: 1,
      brandingOrchestrator,
      brandScoreRepository,
    });

    const terminal = await runScanAndWait(orchestrator, 'scan-04');

    expect(terminal.type).toBe('complete');
    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(1);
    const [writtenResult, writtenContext] = (
      brandScoreRepository.insert as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(writtenResult.kind).toBe('unscorable');
    expect(writtenContext.mode).toBe('remote');
    expect(writtenContext.brandRelatedCount).toBe(0);
    expect(writtenContext.scanId).toBe('scan-04');
  });

  it('Test 5: no-guideline result does NOT call brandScoreRepository.insert', async () => {
    const storage = makeMockStorage(null);
    const brandingOrchestrator = makeMockBrandingOrchestrator({
      kind: 'no-guideline',
      mode: 'embedded',
    });
    const brandScoreRepository = makeMockBrandScoreRepository();
    const orchestrator = new ScanOrchestrator(storage, '/tmp/reports', {
      maxConcurrent: 1,
      brandingOrchestrator,
      brandScoreRepository,
    });

    const terminal = await runScanAndWait(orchestrator, 'scan-05');

    expect(terminal.type).toBe('complete');
    expect(brandScoreRepository.insert).not.toHaveBeenCalled();
  });

  it('Test 6: persistence failure is NON-BLOCKING — scan still completes', async () => {
    const storage = makeMockStorage(FIXTURE_GUIDELINE_RECORD);
    const brandingOrchestrator = makeMockBrandingOrchestrator({
      kind: 'matched',
      mode: 'embedded',
      brandedIssues: [],
      scoreResult: FIXTURE_SCORE_RESULT,
      brandRelatedCount: 0,
    });
    const brandScoreRepository = makeMockBrandScoreRepository(async () => {
      throw new Error('simulated insert failure');
    });
    const orchestrator = new ScanOrchestrator(storage, '/tmp/reports', {
      maxConcurrent: 1,
      brandingOrchestrator,
      brandScoreRepository,
    });

    const terminal = await runScanAndWait(orchestrator, 'scan-06');

    expect(terminal.type).toBe('complete');
    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(1);
    // The scan record update was still called with status: completed
    const updateCall = (
      storage.scans.updateScan as ReturnType<typeof vi.fn>
    ).mock.calls.find((c: any[]) => c[1].status === 'completed');
    expect(updateCall).toBeDefined();
  });

  it('Test 7 (BSTORE-06): scanner only calls insert for the current scan, never backfills others', async () => {
    const storage = makeMockStorage(FIXTURE_GUIDELINE_RECORD);
    const brandingOrchestrator = makeMockBrandingOrchestrator({
      kind: 'matched',
      mode: 'embedded',
      brandedIssues: [],
      scoreResult: FIXTURE_SCORE_RESULT,
      brandRelatedCount: 0,
    });
    const brandScoreRepository = makeMockBrandScoreRepository();
    const orchestrator = new ScanOrchestrator(storage, '/tmp/reports', {
      maxConcurrent: 1,
      brandingOrchestrator,
      brandScoreRepository,
    });

    await runScanAndWait(orchestrator, 'scan-07-current');

    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(1);
    const [, writtenContext] = (
      brandScoreRepository.insert as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(writtenContext.scanId).toBe('scan-07-current');
    // Explicit no-backfill: there is no other scan_id in any insert call
    const allScanIds = (
      brandScoreRepository.insert as ReturnType<typeof vi.fn>
    ).mock.calls.map((c: any[]) => c[1].scanId);
    expect(allScanIds).toEqual(['scan-07-current']);
  });
});

/**
 * Phase 27 Plan 01 — RescoreService unit tests.
 *
 * All repository dependencies are mocked with vi.fn() to isolate the
 * service logic. Tests verify:
 *   - Org-level lock (D-09)
 *   - Idempotent skip of already-scored scans (BRESCORE-02)
 *   - Batch size capped at 50 (BRESCORE-03)
 *   - Guideline-deleted warning skip (BRESCORE-04)
 *   - Embedded-only scoring via calculateBrandScore (BRESCORE-05)
 *   - Progress tracking and completion
 *   - Error handling with status='failed'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import { RescoreService } from '../../src/services/rescore/rescore-service.js';
import type { RescoreProgressRepository } from '../../src/db/interfaces/rescore-progress-repository.js';
import type { RescoreProgress } from '../../src/services/rescore/rescore-types.js';
import type { BrandScoreRepository } from '../../src/db/interfaces/brand-score-repository.js';
import type { ScanRepository } from '../../src/db/interfaces/scan-repository.js';
import type { BrandingRepository } from '../../src/db/interfaces/branding-repository.js';
import type { ScanRecord } from '../../src/db/types.js';
import type { ScoreResult } from '../../src/services/scoring/types.js';

// ── Mock helpers ────────────────────────────────────────────────────────────

function makeMockProgressRepo(): RescoreProgressRepository {
  return {
    getByOrgId: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    deleteByOrgId: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockBrandScoreRepo(): BrandScoreRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    getLatestForScan: vi.fn().mockResolvedValue(null),
    getHistoryForSite: vi.fn().mockResolvedValue([]),
  };
}

function makeMockScanRepo(): ScanRepository {
  return {
    listScans: vi.fn().mockResolvedValue([]),
    countScans: vi.fn().mockResolvedValue(0),
    getLatestPerSite: vi.fn().mockResolvedValue([]),
    createScan: vi.fn(),
    getScan: vi.fn(),
    updateScan: vi.fn(),
    deleteScan: vi.fn(),
    deleteOrgScans: vi.fn(),
    getReport: vi.fn(),
    getTrendData: vi.fn(),
  };
}

function makeMockBrandingRepo(): Pick<BrandingRepository, 'getGuidelineForSite'> {
  return {
    getGuidelineForSite: vi.fn().mockResolvedValue(null),
  };
}

const SCORED_RESULT: ScoreResult = {
  kind: 'scored',
  overall: 80,
  color: { kind: 'scored', value: 90, detail: { dimension: 'color', passes: 9, fails: 1 } },
  typography: { kind: 'scored', value: 70, detail: { dimension: 'typography', fontOk: true, sizeOk: true, lineHeightOk: false } },
  components: { kind: 'scored', value: 50, detail: { dimension: 'components', matched: 2, total: 4 } },
  coverage: { color: true, typography: true, components: true, contributingWeight: 1.0 },
};

function makeScan(id: string, siteUrl: string, orgId: string): ScanRecord {
  return {
    id,
    siteUrl,
    status: 'completed',
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    orgId,
    jsonReport: JSON.stringify({
      pages: [
        {
          url: siteUrl,
          issues: [
            { code: 'color-contrast', selector: 'p', context: '<p>text</p>', type: 'error' },
          ],
        },
      ],
    }),
  };
}

function makeGuideline(orgId: string) {
  return {
    id: randomUUID(),
    orgId,
    name: 'Test Guideline',
    version: 1,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    colors: [{ id: randomUUID(), guidelineId: '', hexValue: '#FF0000', name: 'Red', usage: 'primary' }],
    fonts: [{ id: randomUUID(), guidelineId: '', family: 'Arial' }],
    selectors: [{ id: randomUUID(), guidelineId: '', pattern: '.brand' }],
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RescoreService', () => {
  let progressRepo: ReturnType<typeof makeMockProgressRepo>;
  let brandScoreRepo: ReturnType<typeof makeMockBrandScoreRepo>;
  let scanRepo: ReturnType<typeof makeMockScanRepo>;
  let brandingRepo: ReturnType<typeof makeMockBrandingRepo>;
  let service: RescoreService;

  beforeEach(() => {
    progressRepo = makeMockProgressRepo();
    brandScoreRepo = makeMockBrandScoreRepo();
    scanRepo = makeMockScanRepo();
    brandingRepo = makeMockBrandingRepo();
    service = new RescoreService({
      scanRepository: scanRepo,
      brandScoreRepository: brandScoreRepo,
      progressRepository: progressRepo,
      brandingRepository: brandingRepo,
    });
  });

  // ── startRescore ──────────────────────────────────────────────────────

  it('Test 1: startRescore returns already-running when progress row has status running (D-09 lock)', async () => {
    const orgId = randomUUID();
    const existing: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 50,
      processedScans: 10,
      scoredCount: 8,
      skippedCount: 2,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(existing);

    const result = await service.startRescore(orgId);

    expect(result.status).toBe('already-running');
    expect(result.candidateCount).toBe(0);
  });

  it('Test 2: startRescore counts only completed scans for the org', async () => {
    const orgId = randomUUID();
    const scans = [makeScan('s1', 'https://a.com', orgId), makeScan('s2', 'https://b.com', orgId)];
    vi.mocked(scanRepo.listScans).mockResolvedValue(scans);
    // Both scans have no existing brand_scores (getLatestForScan returns null)

    const result = await service.startRescore(orgId);

    expect(result.status).toBe('started');
    expect(result.candidateCount).toBe(2);
    expect(scanRepo.listScans).toHaveBeenCalledWith(
      expect.objectContaining({ orgId, status: 'completed' }),
    );
  });

  it('Test 3: startRescore returns no-candidates when no completed scans exist', async () => {
    const orgId = randomUUID();
    vi.mocked(scanRepo.listScans).mockResolvedValue([]);

    const result = await service.startRescore(orgId);

    expect(result.status).toBe('no-candidates');
    expect(result.candidateCount).toBe(0);
    expect(progressRepo.upsert).not.toHaveBeenCalled();
  });

  // ── processNextBatch ──────────────────────────────────────────────────

  it('Test 4: processNextBatch skips scans that already have a brand_scores row (BRESCORE-02)', async () => {
    const orgId = randomUUID();
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 1,
      processedScans: 0,
      scoredCount: 0,
      skippedCount: 0,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(progress);
    vi.mocked(scanRepo.listScans).mockResolvedValue([makeScan('s1', 'https://a.com', orgId)]);
    // Scan already has a score
    vi.mocked(brandScoreRepo.getLatestForScan).mockResolvedValue(SCORED_RESULT);

    const result = await service.processNextBatch(orgId);

    expect(result).not.toBeNull();
    expect(result!.skippedCount).toBe(1);
    expect(brandScoreRepo.insert).not.toHaveBeenCalled();
  });

  it('Test 5: processNextBatch skips scans whose guideline no longer exists and increments warningCount (BRESCORE-04)', async () => {
    const orgId = randomUUID();
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 1,
      processedScans: 0,
      scoredCount: 0,
      skippedCount: 0,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(progress);
    vi.mocked(scanRepo.listScans).mockResolvedValue([makeScan('s1', 'https://a.com', orgId)]);
    vi.mocked(brandScoreRepo.getLatestForScan).mockResolvedValue(null);
    // No guideline for this site
    vi.mocked(brandingRepo.getGuidelineForSite).mockResolvedValue(null);

    const result = await service.processNextBatch(orgId);

    expect(result).not.toBeNull();
    expect(result!.warningCount).toBe(1);
    expect(brandScoreRepo.insert).not.toHaveBeenCalled();
  });

  it('Test 6: processNextBatch processes at most 50 scans per call (BRESCORE-03)', async () => {
    const orgId = randomUUID();
    const scans = Array.from({ length: 60 }, (_, i) => makeScan(`s${i}`, `https://site${i}.com`, orgId));
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 60,
      processedScans: 0,
      scoredCount: 0,
      skippedCount: 0,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(progress);
    vi.mocked(scanRepo.listScans).mockResolvedValue(scans);
    vi.mocked(brandScoreRepo.getLatestForScan).mockResolvedValue(null);
    const guideline = makeGuideline(orgId);
    vi.mocked(brandingRepo.getGuidelineForSite).mockResolvedValue(guideline as any);

    const result = await service.processNextBatch(orgId);

    expect(result).not.toBeNull();
    expect(result!.processedScans).toBe(50);
    // Should NOT have processed all 60
    expect(result!.status).toBe('running');
  });

  it('Test 7: processNextBatch calls calculateBrandScore with embedded mode, never the branding orchestrator (BRESCORE-05)', async () => {
    const orgId = randomUUID();
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 1,
      processedScans: 0,
      scoredCount: 0,
      skippedCount: 0,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(progress);
    vi.mocked(scanRepo.listScans).mockResolvedValue([makeScan('s1', 'https://a.com', orgId)]);
    vi.mocked(brandScoreRepo.getLatestForScan).mockResolvedValue(null);
    const guideline = makeGuideline(orgId);
    vi.mocked(brandingRepo.getGuidelineForSite).mockResolvedValue(guideline as any);

    await service.processNextBatch(orgId);

    // Verify insert was called with mode: 'embedded'
    expect(brandScoreRepo.insert).toHaveBeenCalledTimes(1);
    const insertCall = vi.mocked(brandScoreRepo.insert).mock.calls[0];
    expect(insertCall[1].mode).toBe('embedded');
  });

  it('Test 8: processNextBatch updates progress row with counts and lastProcessedScanId', async () => {
    const orgId = randomUUID();
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 2,
      processedScans: 0,
      scoredCount: 0,
      skippedCount: 0,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(progress);

    const scan1 = makeScan('s1', 'https://a.com', orgId);
    const scan2 = makeScan('s2', 'https://b.com', orgId);
    vi.mocked(scanRepo.listScans).mockResolvedValue([scan1, scan2]);
    // s1 already scored (skip), s2 no guideline (warning)
    vi.mocked(brandScoreRepo.getLatestForScan)
      .mockResolvedValueOnce(SCORED_RESULT)
      .mockResolvedValueOnce(null);
    vi.mocked(brandingRepo.getGuidelineForSite).mockResolvedValue(null);

    const result = await service.processNextBatch(orgId);

    expect(result).not.toBeNull();
    expect(result!.processedScans).toBe(2);
    expect(result!.skippedCount).toBe(1);
    expect(result!.warningCount).toBe(1);
    expect(result!.lastProcessedScanId).toBe('s2');
    expect(progressRepo.upsert).toHaveBeenCalled();
  });

  it('Test 9: processNextBatch sets status=completed when processedScans reaches totalScans', async () => {
    const orgId = randomUUID();
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 1,
      processedScans: 0,
      scoredCount: 0,
      skippedCount: 0,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(progress);
    vi.mocked(scanRepo.listScans).mockResolvedValue([makeScan('s1', 'https://a.com', orgId)]);
    vi.mocked(brandScoreRepo.getLatestForScan).mockResolvedValue(null);
    const guideline = makeGuideline(orgId);
    vi.mocked(brandingRepo.getGuidelineForSite).mockResolvedValue(guideline as any);

    const result = await service.processNextBatch(orgId);

    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
  });

  it('Test 10: processNextBatch sets status=failed and records error message on unexpected error', async () => {
    const orgId = randomUUID();
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 1,
      processedScans: 0,
      scoredCount: 0,
      skippedCount: 0,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(progress);
    // Force an error by making listScans throw
    vi.mocked(scanRepo.listScans).mockRejectedValue(new Error('DB connection lost'));

    const result = await service.processNextBatch(orgId);

    expect(result).not.toBeNull();
    expect(result!.status).toBe('failed');
    expect(result!.error).toBe('Batch processing failed');
  });

  // ── getProgress ───────────────────────────────────────────────────────

  it('Test 11: getProgress returns null when no progress row exists', async () => {
    const result = await service.getProgress(randomUUID());
    expect(result).toBeNull();
  });

  it('Test 12: getProgress returns current RescoreProgress when row exists', async () => {
    const orgId = randomUUID();
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: 100,
      processedScans: 50,
      scoredCount: 45,
      skippedCount: 5,
      warningCount: 0,
      lastProcessedScanId: 'scan-50',
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(progressRepo.getByOrgId).mockResolvedValue(progress);

    const result = await service.getProgress(orgId);

    expect(result).toEqual(progress);
  });

  // ── getCandidateCount ─────────────────────────────────────────────────

  it('Test 13: getCandidateCount returns count of completed scans that lack a brand_scores row', async () => {
    const orgId = randomUUID();
    const scans = [
      makeScan('s1', 'https://a.com', orgId),
      makeScan('s2', 'https://b.com', orgId),
      makeScan('s3', 'https://c.com', orgId),
    ];
    vi.mocked(scanRepo.listScans).mockResolvedValue(scans);
    // s1 has score, s2 and s3 do not
    vi.mocked(brandScoreRepo.getLatestForScan)
      .mockResolvedValueOnce(SCORED_RESULT)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const count = await service.getCandidateCount(orgId);

    expect(count).toBe(2);
  });
});

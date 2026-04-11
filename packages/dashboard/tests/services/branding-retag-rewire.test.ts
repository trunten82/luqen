/**
 * Phase 18 Plan 04 — Retag rewire invariant tests.
 *
 * Pins the five critical invariants of the Plan 18-04 rewire of
 * `retagScansForSite` / `retagAllSitesForGuideline`:
 *
 *  Test 1 (CRITICAL BSTORE-03): append-only retag against real in-memory
 *    SQLite — a mocked repository cannot distinguish "append" from
 *    "secret UPDATE/REPLACE", so this test uses the real SqliteStorageAdapter
 *    with full migrations and asserts via raw `SELECT COUNT(*)` that two
 *    retags produce exactly 2 brand_scores rows for the same scan_id.
 *
 *  Test 1b (mock sanity): retagging twice calls insert exactly twice — cheap
 *    backup check to catch gross signature regressions.
 *
 *  Test 2: linear scaling — a site with N completed scans triggers exactly
 *    N matchAndScore calls (not quadratic, not 1, not 0).
 *
 *  Test 3: no active guideline → early return with retagged=0 and zero
 *    orchestrator calls.
 *
 *  Test 4: degraded result still persists an unscorable brand_scores row so
 *    trend rendering has a "we tried, service was down" marker (same
 *    invariant as Plan 18-03 Test 4).
 *
 *  Test 5: insert failure is non-blocking — mid-loop persistence error does
 *    not crash the retag loop; remaining scans are still processed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

import { retagScansForSite } from '../../src/services/branding-retag.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { SqliteBrandingRepository } from '../../src/db/sqlite/repositories/branding-repository.js';

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
  overall: 80,
  color: {
    kind: 'scored',
    value: 90,
    detail: { dimension: 'color', passes: 9, fails: 1 },
  },
  typography: {
    kind: 'scored',
    value: 70,
    detail: { dimension: 'typography', fontOk: true, sizeOk: true, lineHeightOk: false },
  },
  components: {
    kind: 'scored',
    value: 75,
    detail: { dimension: 'components', matched: 3, total: 4 },
  },
  coverage: { color: true, typography: true, components: true, contributingWeight: 1.0 },
};

const FIXTURE_GUIDELINE = {
  id: 'gd-test',
  orgId: 'org-test',
  name: 'Test Guideline',
  version: 1,
  active: true,
  colors: [{ id: 'c1', name: 'Brand Color', hexValue: '#FF6900' }],
  fonts: [{ id: 'f1', family: 'Helvetica' }],
  selectors: [{ id: 's1', pattern: '.btn' }],
};

function makeIssueReport(): string {
  return JSON.stringify({
    pages: [
      {
        url: 'https://test.example.com/',
        issueCount: 1,
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
            type: 'error',
            message: 'Contrast',
            selector: '.btn',
            context: '<button class="btn">X</button>',
          },
        ],
      },
    ],
  });
}

function makeMockScan(id: string) {
  return {
    id,
    siteUrl: 'https://test.example.com/',
    orgId: 'org-test',
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'test',
    createdAt: new Date().toISOString(),
    status: 'completed' as const,
    jsonReport: makeIssueReport(),
  };
}

function makeMockStorage(
  guideline: typeof FIXTURE_GUIDELINE | null,
  scans: ReturnType<typeof makeMockScan>[],
) {
  return {
    scans: {
      listScans: vi.fn().mockResolvedValue(scans),
      updateScan: vi.fn().mockResolvedValue(undefined),
    },
    branding: {
      getGuidelineForSite: vi.fn().mockResolvedValue(guideline),
    },
    brandScores: {
      insert: vi.fn().mockResolvedValue(undefined),
      getLatestForScan: vi.fn().mockResolvedValue(null),
      getHistoryForSite: vi.fn().mockResolvedValue([]),
    },
  } as unknown as StorageAdapter;
}

function makeMockBrandingOrchestrator(
  resultFactory: (input: unknown) => MatchAndScoreResult,
): BrandingOrchestrator {
  return {
    matchAndScore: vi.fn((input: unknown) => Promise.resolve(resultFactory(input))),
  } as unknown as BrandingOrchestrator;
}

function makeMockBrandScoreRepository(
  insertImpl: (result: ScoreResult, ctx: unknown) => Promise<void> = async () => undefined,
): BrandScoreRepository {
  return {
    insert: vi.fn(insertImpl),
    getLatestForScan: vi.fn().mockResolvedValue(null),
    getHistoryForSite: vi.fn().mockResolvedValue([]),
  } as unknown as BrandScoreRepository;
}

const matchedResult = (): MatchAndScoreResult => ({
  kind: 'matched',
  mode: 'embedded',
  brandedIssues: [],
  scoreResult: FIXTURE_SCORE_RESULT,
  brandRelatedCount: 0,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Phase 18 retag rewire — BSTORE-03 append-only invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: CRITICAL BSTORE-03 integration test against real SQLite ─────
  // A mocked repository CANNOT distinguish "append" from "secret UPDATE/REPLACE".
  // This test uses the real SqliteStorageAdapter with all migrations applied,
  // then asserts against actual DB state via raw `SELECT COUNT(*)`.
  describe('Test 1 (CRITICAL BSTORE-03): append-only retag against real SQLite', () => {
    let storage: SqliteStorageAdapter;
    let dbPath: string;

    beforeEach(async () => {
      dbPath = join(tmpdir(), `test-retag-rewire-${randomUUID()}.db`);
      storage = new SqliteStorageAdapter(dbPath);
      await storage.migrate();

      // Seed an active guideline + site assignment + completed scan_record.
      // Reuses the production SqliteBrandingRepository so the schema is
      // guaranteed to match the current migrations (migration 034 branding
      // tables + migration 039 scan_records.regulations column).
      const repo = new SqliteBrandingRepository(storage.getRawDatabase());
      const guidelineId = 'gd-test-01';
      const orgId = 'org-test';
      const siteUrl = 'https://test.example.com/';

      await repo.createGuideline({
        orgId,
        name: 'Test Guideline',
        id: guidelineId,
        description: 'Test',
      });
      await repo.updateGuideline(guidelineId, { active: true });
      await repo.addColor(guidelineId, {
        id: 'c1',
        name: 'Brand Color',
        hexValue: '#FF6900',
      });
      await repo.addFont(guidelineId, {
        id: 'f1',
        family: 'Helvetica',
      });
      await repo.addSelector(guidelineId, {
        id: 's1',
        pattern: '.btn',
      });
      await repo.assignToSite(guidelineId, siteUrl, orgId);

      // Insert a scan_records row with status='completed' and a jsonReport
      // containing one issue so the retag loop has something to match.
      await storage.scans.createScan({
        id: 'scan-01',
        siteUrl,
        standard: 'WCAG2AA',
        jurisdictions: ['en'],
        createdBy: 'test',
        createdAt: new Date().toISOString(),
        orgId,
      });
      await storage.scans.updateScan('scan-01', {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReport: makeIssueReport(),
      });
    });

    afterEach(async () => {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    });

    it('two retags of the same site produce 2 brand_scores rows for that scan_id (never 1 updated row)', async () => {
      // Stub the BrandingOrchestrator to return a deterministic matched result.
      // We only care about the PERSISTENCE invariant here, not the matching
      // logic — the real EmbeddedBrandingAdapter is exercised by other
      // integration tests.
      const stubOrchestrator = makeMockBrandingOrchestrator(() => matchedResult());

      // First retag
      const r1 = await retagScansForSite(
        storage,
        'https://test.example.com/',
        'org-test',
        stubOrchestrator,
        storage.brandScores,
      );
      expect(r1.retagged).toBe(1);

      // Second retag — same site, same scan. Must APPEND, not replace.
      const r2 = await retagScansForSite(
        storage,
        'https://test.example.com/',
        'org-test',
        stubOrchestrator,
        storage.brandScores,
      );
      expect(r2.retagged).toBe(1);

      // ── CRITICAL ASSERTION ─────────────────────────────────────────────
      // Raw SQL COUNT against brand_scores. If retag secretly REPLACEd, this
      // would be 1. BSTORE-03 requires it to be 2.
      const db = storage.getRawDatabase();
      const { n } = db
        .prepare('SELECT COUNT(*) as n FROM brand_scores WHERE scan_id = ?')
        .get('scan-01') as { n: number };
      expect(n).toBe(2);

      // Also verify the repository's getHistoryForSite sees both rows —
      // this exercises the read path Phase 20/21 trend display will use.
      const history = await storage.brandScores.getHistoryForSite(
        'org-test',
        'https://test.example.com/',
        10,
      );
      expect(history).toHaveLength(2);

      // The two orchestrator calls fire linearly (Pitfall #10 sanity —
      // one matchAndScore call per retag, not per row).
      expect(stubOrchestrator.matchAndScore).toHaveBeenCalledTimes(2);
    });
  });

  // Legacy mock-based sanity (kept as a secondary check — cheap, catches
  // gross signature regressions even if the schema drifts before the
  // integration seed helpers are updated). The RAW COUNT test above is the
  // load-bearing BSTORE-03 proof; this one is backup.
  it('Test 1b (mock sanity): retagging twice calls insert exactly twice', async () => {
    const mockStorage = makeMockStorage(FIXTURE_GUIDELINE, [makeMockScan('scan-01')]);
    const brandingOrchestrator = makeMockBrandingOrchestrator(() => matchedResult());
    const brandScoreRepository = makeMockBrandScoreRepository();

    await retagScansForSite(
      mockStorage,
      'https://test.example.com/',
      'org-test',
      brandingOrchestrator,
      brandScoreRepository,
    );
    await retagScansForSite(
      mockStorage,
      'https://test.example.com/',
      'org-test',
      brandingOrchestrator,
      brandScoreRepository,
    );

    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(2);
    const insertCalls = (brandScoreRepository.insert as ReturnType<typeof vi.fn>).mock.calls;
    const scanIds = insertCalls.map((call: unknown[]) => (call[1] as { scanId: string }).scanId);
    expect(scanIds).toEqual(['scan-01', 'scan-01']);
  });

  it('Test 2: calls matchAndScore once per completed scan (linear scaling, not quadratic)', async () => {
    const scans = [makeMockScan('scan-A'), makeMockScan('scan-B'), makeMockScan('scan-C')];
    const mockStorage = makeMockStorage(FIXTURE_GUIDELINE, scans);
    const brandingOrchestrator = makeMockBrandingOrchestrator(() => matchedResult());
    const brandScoreRepository = makeMockBrandScoreRepository();

    const r = await retagScansForSite(
      mockStorage,
      'https://test.example.com/',
      'org-test',
      brandingOrchestrator,
      brandScoreRepository,
    );

    expect(r.retagged).toBe(3);
    expect(brandingOrchestrator.matchAndScore).toHaveBeenCalledTimes(3);
    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(3);
    const matchCalls = (brandingOrchestrator.matchAndScore as ReturnType<typeof vi.fn>).mock.calls;
    const scanIds = matchCalls.map((call: unknown[]) => (call[0] as { scanId: string }).scanId);
    expect(scanIds.sort()).toEqual(['scan-A', 'scan-B', 'scan-C']);
  });

  it('Test 3: no active guideline → early return with retagged: 0 and zero calls', async () => {
    const mockStorage = makeMockStorage(null, [makeMockScan('scan-01')]);
    const brandingOrchestrator = makeMockBrandingOrchestrator(() => matchedResult());
    const brandScoreRepository = makeMockBrandScoreRepository();

    const r = await retagScansForSite(
      mockStorage,
      'https://test.example.com/',
      'org-test',
      brandingOrchestrator,
      brandScoreRepository,
    );

    expect(r.retagged).toBe(0);
    expect(brandingOrchestrator.matchAndScore).toHaveBeenCalledTimes(0);
    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(0);
  });

  it('Test 4: degraded retag still persists an unscorable row', async () => {
    const mockStorage = makeMockStorage(FIXTURE_GUIDELINE, [makeMockScan('scan-degraded')]);
    const brandingOrchestrator = makeMockBrandingOrchestrator(() => ({
      kind: 'degraded',
      mode: 'remote',
      reason: 'remote-unavailable',
      error: 'ECONNREFUSED',
    }));
    const brandScoreRepository = makeMockBrandScoreRepository();

    const r = await retagScansForSite(
      mockStorage,
      'https://test.example.com/',
      'org-test',
      brandingOrchestrator,
      brandScoreRepository,
    );

    expect(r.retagged).toBe(1);
    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(1);
    const [writtenResult, writtenContext] = (
      brandScoreRepository.insert as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [ScoreResult, { mode: string; scanId: string; brandRelatedCount: number }];
    expect(writtenResult.kind).toBe('unscorable');
    expect(writtenContext.mode).toBe('remote');
    expect(writtenContext.scanId).toBe('scan-degraded');
    expect(writtenContext.brandRelatedCount).toBe(0);
  });

  it('Test 5: insert failure is non-blocking — retag loop continues to the next scan', async () => {
    const scans = [makeMockScan('scan-1'), makeMockScan('scan-2-fails'), makeMockScan('scan-3')];
    const mockStorage = makeMockStorage(FIXTURE_GUIDELINE, scans);
    const brandingOrchestrator = makeMockBrandingOrchestrator(() => matchedResult());
    const brandScoreRepository = makeMockBrandScoreRepository(async (_result, ctx) => {
      if ((ctx as { scanId: string }).scanId === 'scan-2-fails') {
        throw new Error('simulated insert failure');
      }
      return undefined;
    });

    // Must NOT throw
    const r = await retagScansForSite(
      mockStorage,
      'https://test.example.com/',
      'org-test',
      brandingOrchestrator,
      brandScoreRepository,
    );

    // - All 3 matchAndScore calls happened (linear processing)
    // - All 3 insert attempts happened (loop continued past the failure)
    // - Function did NOT throw
    // - At least scan-1 + scan-3 should have incremented retagged
    expect(brandingOrchestrator.matchAndScore).toHaveBeenCalledTimes(3);
    expect(brandScoreRepository.insert).toHaveBeenCalledTimes(3);
    expect(r.retagged).toBeGreaterThanOrEqual(2);
  });
});

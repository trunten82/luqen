/**
 * Phase 18-05 BSTORE-04 regression suite.
 *
 * Pins the LEFT JOIN contract on ScanRepository.getTrendData:
 *  - pre-v2.11.0 scans (no brand_scores row) return brandScore strictly null
 *  - matched scored scans return a kind:'scored' ScoreResult
 *  - matched unscorable scans return a kind:'unscorable' ScoreResult
 *  - retag history (multi-row per scan_id from Phase 18-04) collapses to the
 *    latest row (greatest rowid wins)
 *  - mixed-org trends preserve scans with and without brand_scores rows
 *
 * Critical assertion: Test 1 asserts `expect(entry.brandScore).toBe(null)`
 * with strict equality — not `toBeFalsy`, not `toBeNull` with undefined
 * allowed, not `not.toBeDefined`. This is the exact shape the Phase 21 widget
 * will check with `if (scan.brandScore === null) { renderEmptyState() }`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import type { ScoreResult } from '../../src/services/scoring/types.js';

const FIXTURE_SCORED: ScoreResult = {
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
    detail: { dimension: 'typography', fontOk: true, sizeOk: true, lineHeightOk: false },
  },
  components: {
    kind: 'scored',
    value: 60,
    detail: { dimension: 'components', matched: 3, total: 5 },
  },
  coverage: { color: true, typography: true, components: true, contributingWeight: 1.0 },
};

const FIXTURE_UNSCORABLE: ScoreResult = {
  kind: 'unscorable',
  reason: 'no-branded-issues',
};

describe('Phase 18-05 BSTORE-04 — getTrendData LEFT JOIN brand_scores', () => {
  let tmpDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'luqen-trend-test-'));
    storage = new SqliteStorageAdapter(join(tmpDir, 'test.sqlite'));
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.disconnect();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createCompletedScan(id: string, orgId: string): Promise<void> {
    await storage.scans.createScan({
      id,
      siteUrl: 'https://test.example.com/',
      standard: 'WCAG2AA',
      jurisdictions: [],
      regulations: [],
      createdBy: 'test',
      createdAt: new Date().toISOString(),
      orgId,
    });
    await storage.scans.updateScan(id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      pagesScanned: 1,
      totalIssues: 3,
      errors: 1,
      warnings: 1,
      notices: 1,
    });
  }

  it('Test 1 (CRITICAL BSTORE-04): pre-v2.11.0 scan returns brandScore strictly equal to null', async () => {
    await createCompletedScan('scan-pre-v2-11', 'org-test');
    // NO brand_scores insert — simulating a pre-v2.11.0 scan where migration 043
    // applied but no scanner rewrite has ever run against this row.

    const trend = await storage.scans.getTrendData('org-test');

    expect(trend).toHaveLength(1);
    const entry = trend[0]!;
    expect(entry.id).toBe('scan-pre-v2-11');
    // Strict null — the BSTORE-04 fix pinpoint. The Phase 21 widget will
    // check `scan.brandScore === null` for the empty-state branch; anything
    // that coerces to null (undefined, { overall: 0 }, NaN) would masquerade
    // as "measured zero" and break the widget.
    expect(entry.brandScore).toBe(null);
    expect(entry.brandScore).not.toBe(undefined);
    expect(entry.brandScore).not.toEqual({ overall: 0 });
    expect(entry.brandScore).not.toEqual({ kind: 'scored', overall: 0 });
  });

  it('Test 2: matched scored scan returns brandScore with kind=scored and correct overall', async () => {
    await createCompletedScan('scan-matched', 'org-test');
    await storage.brandScores.insert(FIXTURE_SCORED, {
      scanId: 'scan-matched',
      orgId: 'org-test',
      siteUrl: 'https://test.example.com/',
      mode: 'embedded',
      brandRelatedCount: 2,
      totalIssues: 3,
    });

    const trend = await storage.scans.getTrendData('org-test');
    expect(trend).toHaveLength(1);
    const bs = trend[0]!.brandScore;
    expect(bs).not.toBe(null);
    expect(bs).not.toBe(undefined);
    expect(bs!.kind).toBe('scored');
    if (bs!.kind === 'scored') {
      expect(bs.overall).toBe(72);
      expect(bs.color.kind).toBe('scored');
      expect(bs.typography.kind).toBe('scored');
      expect(bs.components.kind).toBe('scored');
      expect(bs.coverage).toEqual({
        color: true,
        typography: true,
        components: true,
        contributingWeight: 1.0,
      });
    }
  });

  it('Test 3: unscorable scan returns brandScore with kind=unscorable and valid reason', async () => {
    await createCompletedScan('scan-unscorable', 'org-test');
    await storage.brandScores.insert(FIXTURE_UNSCORABLE, {
      scanId: 'scan-unscorable',
      orgId: 'org-test',
      siteUrl: 'https://test.example.com/',
      mode: 'remote',
      brandRelatedCount: 0,
      totalIssues: 5,
    });

    const trend = await storage.scans.getTrendData('org-test');
    expect(trend).toHaveLength(1);
    const bs = trend[0]!.brandScore;
    expect(bs).not.toBe(null);
    expect(bs!.kind).toBe('unscorable');
    if (bs!.kind === 'unscorable') {
      expect(bs.reason).toBe('no-branded-issues');
    }
  });

  it('Test 4: retag history (2 brand_scores rows for same scan) returns LATEST only (rowid wins)', async () => {
    await createCompletedScan('scan-retagged', 'org-test');

    // First score (lower) — first insert, smaller rowid
    await storage.brandScores.insert(
      { ...FIXTURE_SCORED, overall: 50 },
      {
        scanId: 'scan-retagged',
        orgId: 'org-test',
        siteUrl: 'https://test.example.com/',
        mode: 'embedded',
        brandRelatedCount: 1,
        totalIssues: 3,
      },
    );
    // Second score (higher — retag with updated guideline) — greater rowid
    await storage.brandScores.insert(
      { ...FIXTURE_SCORED, overall: 80 },
      {
        scanId: 'scan-retagged',
        orgId: 'org-test',
        siteUrl: 'https://test.example.com/',
        mode: 'embedded',
        brandRelatedCount: 2,
        totalIssues: 3,
      },
    );

    const trend = await storage.scans.getTrendData('org-test');
    // ONE row returned for the one scan — not two (the LEFT JOIN subquery
    // collapses retag history to a single latest row).
    expect(trend).toHaveLength(1);
    const bs = trend[0]!.brandScore;
    expect(bs).not.toBe(null);
    expect(bs!.kind).toBe('scored');
    if (bs!.kind === 'scored') {
      expect(bs.overall).toBe(80); // LATEST row wins (rowid tie-breaker)
    }
  });

  it('Test 5: mixed org — one org scored, other org pre-v2.11.0 — both returned correctly', async () => {
    await createCompletedScan('scan-org-a', 'org-A');
    await createCompletedScan('scan-org-b', 'org-B');
    await storage.brandScores.insert(FIXTURE_SCORED, {
      scanId: 'scan-org-a',
      orgId: 'org-A',
      siteUrl: 'https://test.example.com/',
      mode: 'embedded',
      brandRelatedCount: 2,
      totalIssues: 3,
    });
    // Org B has NO brand_scores row — simulating a pre-v2.11.0 scan for orgB

    const trend = await storage.scans.getTrendData(); // no orgId filter
    expect(trend).toHaveLength(2);

    const entryA = trend.find((e) => e.id === 'scan-org-a')!;
    const entryB = trend.find((e) => e.id === 'scan-org-b')!;

    expect(entryA.brandScore).not.toBe(null);
    expect(entryA.brandScore!.kind).toBe('scored');

    expect(entryB.brandScore).toBe(null);
  });
});

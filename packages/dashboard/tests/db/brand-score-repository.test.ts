import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import type { ScoreResult, SubScore } from '../../src/services/scoring/types.js';
import type { BrandScoreScanContext } from '../../src/db/interfaces/brand-score-repository.js';

function makeTempStorage(): { storage: SqliteStorageAdapter; path: string } {
  const path = join(tmpdir(), `test-brand-scores-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

async function seedScanRecord(
  storage: SqliteStorageAdapter,
  scanId: string,
  siteUrl: string,
  orgId: string,
): Promise<void> {
  // Insert a minimal scan_records row to satisfy the FK
  const db = storage.getRawDatabase();
  // Note: scan_records.regulations was added by migration 039; this helper relies on
  // running the full DASHBOARD_MIGRATIONS array (which always includes 039 → 042 → 043).
  db.prepare(
    `INSERT INTO scan_records
       (id, site_url, status, standard, jurisdictions, regulations, created_by, created_at)
     VALUES (?, ?, 'completed', 'WCAG2AA', '[]', '[]', ?, ?)`,
  ).run(scanId, siteUrl, 'tester', new Date().toISOString());
  // Bind orgId via a separate column if present on the schema
  db.prepare('UPDATE scan_records SET org_id = ? WHERE id = ?').run(orgId, scanId);
}

const SCORED_COLOR: SubScore = {
  kind: 'scored',
  value: 80,
  detail: { dimension: 'color', passes: 8, fails: 2 },
};

const SCORED_TYPOGRAPHY: SubScore = {
  kind: 'scored',
  value: 67,
  detail: { dimension: 'typography', fontOk: true, sizeOk: true, lineHeightOk: false },
};

const SCORED_COMPONENTS: SubScore = {
  kind: 'scored',
  value: 50,
  detail: { dimension: 'components', matched: 2, total: 4 },
};

const SCORED_RESULT: ScoreResult = {
  kind: 'scored',
  overall: 73,
  color: SCORED_COLOR,
  typography: SCORED_TYPOGRAPHY,
  components: SCORED_COMPONENTS,
  coverage: { color: true, typography: true, components: true, contributingWeight: 1.0 },
};

const UNSCORABLE_TYPOGRAPHY: SubScore = {
  kind: 'unscorable',
  reason: 'no-typography-data',
};

const SCORED_WITH_UNSCORABLE_TYPO: ScoreResult = {
  kind: 'scored',
  overall: 71,
  color: SCORED_COLOR,
  typography: UNSCORABLE_TYPOGRAPHY,
  components: SCORED_COMPONENTS,
  coverage: { color: true, typography: false, components: true, contributingWeight: 0.7 },
};

function makeContext(
  scanId: string,
  siteUrl: string,
  orgId: string,
  overrides: Partial<BrandScoreScanContext> = {},
): BrandScoreScanContext {
  return {
    scanId,
    orgId,
    siteUrl,
    guidelineId: 'gl-1',
    guidelineVersion: 1,
    mode: 'embedded',
    brandRelatedCount: 5,
    totalIssues: 10,
    ...overrides,
  };
}

describe('SqliteBrandScoreRepository', () => {
  let storage: SqliteStorageAdapter;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempStorage();
    storage = result.storage;
    dbPath = result.path;
  });

  afterEach(() => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  // -------------------------------------------------------------------------
  // Round-trip 1: fully scored ScoreResult preserves SubScoreDetail
  // -------------------------------------------------------------------------

  it('round-trips a fully scored ScoreResult including per-dimension SubScoreDetail', async () => {
    const scanId = randomUUID();
    const orgId = 'org-1';
    const siteUrl = 'https://example.com';
    await seedScanRecord(storage, scanId, siteUrl, orgId);

    await storage.brandScores.insert(SCORED_RESULT, makeContext(scanId, siteUrl, orgId));

    const read = await storage.brandScores.getLatestForScan(scanId);
    expect(read).not.toBeNull();
    expect(read?.kind).toBe('scored');
    if (read?.kind !== 'scored') return; // narrowing for TS

    expect(read.overall).toBe(73);
    expect(read.coverage).toEqual({
      color: true,
      typography: true,
      components: true,
      contributingWeight: 1.0,
    });

    expect(read.color.kind).toBe('scored');
    if (read.color.kind === 'scored') {
      expect(read.color.value).toBe(80);
      expect(read.color.detail.dimension).toBe('color');
      if (read.color.detail.dimension === 'color') {
        expect(read.color.detail.passes).toBe(8);
        expect(read.color.detail.fails).toBe(2);
      }
    }

    expect(read.typography.kind).toBe('scored');
    if (read.typography.kind === 'scored') {
      expect(read.typography.value).toBe(67);
      expect(read.typography.detail.dimension).toBe('typography');
      if (read.typography.detail.dimension === 'typography') {
        expect(read.typography.detail.fontOk).toBe(true);
        expect(read.typography.detail.sizeOk).toBe(true);
        expect(read.typography.detail.lineHeightOk).toBe(false);
      }
    }

    expect(read.components.kind).toBe('scored');
    if (read.components.kind === 'scored') {
      expect(read.components.value).toBe(50);
      expect(read.components.detail.dimension).toBe('components');
      if (read.components.detail.dimension === 'components') {
        expect(read.components.detail.matched).toBe(2);
        expect(read.components.detail.total).toBe(4);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Round-trip 2: scored top-level with one unscorable sub-score
  // -------------------------------------------------------------------------

  it('round-trips a scored ScoreResult containing an unscorable typography sub-score', async () => {
    const scanId = randomUUID();
    const orgId = 'org-1';
    const siteUrl = 'https://example.com';
    await seedScanRecord(storage, scanId, siteUrl, orgId);

    await storage.brandScores.insert(
      SCORED_WITH_UNSCORABLE_TYPO,
      makeContext(scanId, siteUrl, orgId),
    );

    const read = await storage.brandScores.getLatestForScan(scanId);
    expect(read?.kind).toBe('scored');
    if (read?.kind !== 'scored') return;

    expect(read.typography.kind).toBe('unscorable');
    if (read.typography.kind === 'unscorable') {
      expect(read.typography.reason).toBe('no-typography-data');
    }

    expect(read.color.kind).toBe('scored');
    expect(read.components.kind).toBe('scored');
    expect(read.coverage.contributingWeight).toBe(0.7);
  });

  // -------------------------------------------------------------------------
  // Round-trip 3: top-level unscorable preserves reason and stores NULLs
  // -------------------------------------------------------------------------

  it('round-trips a top-level unscorable ScoreResult and stores NULL score columns', async () => {
    const scanId = randomUUID();
    const orgId = 'org-1';
    const siteUrl = 'https://example.com';
    await seedScanRecord(storage, scanId, siteUrl, orgId);

    const unscorable: ScoreResult = { kind: 'unscorable', reason: 'no-guideline' };
    await storage.brandScores.insert(unscorable, makeContext(scanId, siteUrl, orgId));

    const read = await storage.brandScores.getLatestForScan(scanId);
    expect(read).toEqual({ kind: 'unscorable', reason: 'no-guideline' });

    // Direct DB inspection: score columns must be NULL, unscorable_reason populated
    const db = storage.getRawDatabase();
    const row = db
      .prepare(
        'SELECT overall, color_contrast, typography, components, subscore_details, unscorable_reason FROM brand_scores WHERE scan_id = ?',
      )
      .get(scanId) as {
        overall: number | null;
        color_contrast: number | null;
        typography: number | null;
        components: number | null;
        subscore_details: string | null;
        unscorable_reason: string | null;
      };
    expect(row.overall).toBeNull();
    expect(row.color_contrast).toBeNull();
    expect(row.typography).toBeNull();
    expect(row.components).toBeNull();
    expect(row.subscore_details).toBeNull();
    expect(row.unscorable_reason).toBe('no-guideline');
  });

  // -------------------------------------------------------------------------
  // Round-trip 4: a different UnscorableReason literal
  // -------------------------------------------------------------------------

  it('round-trips an all-subs-unscorable ScoreResult', async () => {
    const scanId = randomUUID();
    const orgId = 'org-1';
    const siteUrl = 'https://example.com';
    await seedScanRecord(storage, scanId, siteUrl, orgId);

    const unscorable: ScoreResult = { kind: 'unscorable', reason: 'all-subs-unscorable' };
    await storage.brandScores.insert(unscorable, makeContext(scanId, siteUrl, orgId));

    const read = await storage.brandScores.getLatestForScan(scanId);
    expect(read).toEqual({ kind: 'unscorable', reason: 'all-subs-unscorable' });
  });

  // -------------------------------------------------------------------------
  // getLatestForScan: null vs unscorable distinction
  // -------------------------------------------------------------------------

  it('returns null from getLatestForScan when no row exists for the scan_id', async () => {
    const result = await storage.brandScores.getLatestForScan('scan-that-never-existed');
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // getHistoryForSite: ordering, limit, scope isolation
  // -------------------------------------------------------------------------

  it('returns history rows ordered by computedAt DESC and respects the limit', async () => {
    const orgId = 'org-1';
    const siteUrl = 'https://example.com';
    const db = storage.getRawDatabase();

    // Insert 5 rows with monotonically increasing computed_at, each tied to a
    // distinct scan_records row to satisfy the FK.
    for (let i = 0; i < 5; i++) {
      const scanId = randomUUID();
      await seedScanRecord(storage, scanId, siteUrl, orgId);
      const id = randomUUID();
      const computedAt = new Date(Date.UTC(2026, 3, 10, 12, i, 0)).toISOString();
      db.prepare(
        `INSERT INTO brand_scores
          (id, scan_id, org_id, site_url, guideline_id, guideline_version,
           overall, color_contrast, typography, components,
           coverage_profile, subscore_details, unscorable_reason,
           brand_related_count, total_issues, mode, computed_at)
         VALUES (?, ?, ?, ?, NULL, NULL,
                 ?, ?, ?, ?,
                 ?, ?, NULL,
                 0, 0, 'embedded', ?)`,
      ).run(
        id,
        scanId,
        orgId,
        siteUrl,
        50 + i,
        50,
        50,
        50,
        '{"color":true,"typography":true,"components":true,"contributingWeight":1.0}',
        JSON.stringify({
          color: SCORED_COLOR,
          typography: SCORED_TYPOGRAPHY,
          components: SCORED_COMPONENTS,
        }),
        computedAt,
      );
    }

    const history = await storage.brandScores.getHistoryForSite(orgId, siteUrl, 3);
    expect(history).toHaveLength(3);

    // DESC ordering: computedAt should strictly decrease across the 3 entries
    for (let i = 1; i < history.length; i++) {
      expect(history[i - 1].computedAt > history[i].computedAt).toBe(true);
    }

    // The newest entry corresponds to overall = 54 (i=4 in the loop)
    const newest = history[0].result;
    expect(newest.kind).toBe('scored');
    if (newest.kind === 'scored') {
      expect(newest.overall).toBe(54);
    }
  });

  it('isolates getHistoryForSite results to the requested (orgId, siteUrl)', async () => {
    const orgId = 'org-1';
    const siteA = 'https://a.example.com';
    const siteB = 'https://b.example.com';

    const scanA = randomUUID();
    const scanB = randomUUID();
    await seedScanRecord(storage, scanA, siteA, orgId);
    await seedScanRecord(storage, scanB, siteB, orgId);

    await storage.brandScores.insert(SCORED_RESULT, makeContext(scanA, siteA, orgId));
    await storage.brandScores.insert(SCORED_RESULT, makeContext(scanB, siteB, orgId));

    const onlyA = await storage.brandScores.getHistoryForSite(orgId, siteA, 10);
    expect(onlyA).toHaveLength(1);
    const onlyB = await storage.brandScores.getHistoryForSite(orgId, siteB, 10);
    expect(onlyB).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Append-only: retag scenario produces N+1 rows, never an in-place mutation
  // -------------------------------------------------------------------------

  it('retag scenario appends a new row instead of updating in place', async () => {
    const scanId = randomUUID();
    const orgId = 'org-1';
    const siteUrl = 'https://example.com';
    await seedScanRecord(storage, scanId, siteUrl, orgId);

    // First write
    await storage.brandScores.insert(SCORED_RESULT, makeContext(scanId, siteUrl, orgId));
    // Second write (simulating a retag that produced a different score)
    const updatedResult: ScoreResult = { ...SCORED_RESULT, overall: 90 };
    await storage.brandScores.insert(updatedResult, makeContext(scanId, siteUrl, orgId));

    // Two rows, never one
    const db = storage.getRawDatabase();
    const count = db
      .prepare('SELECT COUNT(*) as n FROM brand_scores WHERE scan_id = ?')
      .get(scanId) as { n: number };
    expect(count.n).toBe(2);

    // getLatestForScan returns the most recent one
    const latest = await storage.brandScores.getLatestForScan(scanId);
    expect(latest?.kind).toBe('scored');
    if (latest?.kind === 'scored') {
      expect(latest.overall).toBe(90);
    }
  });
});

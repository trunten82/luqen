/**
 * Tests for digest-service.ts — buildDigest period diff, trend, no-scan, and
 * conservative-framing assertions.
 *
 * Uses an in-memory stub StorageAdapter so no real DB is needed.
 * Tests verify:
 *   - Per-site hasNewScan=true when a completed scan falls in the period
 *   - Totals and per-criterion deltas (improved site, regressed site)
 *   - hasNewScan=false with deltas 0 when no completed scan in the period
 *     but currentExposure is still derived from the most recent scan (D-03)
 *   - direction: worsened/improved/unchanged via band ordinals
 *   - Org-scope ordering: highest band first (most at risk)
 *   - Conservative payload: no forbidden words, no numeric exposure band
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildDigest, type DigestPeriod, type DigestData } from '../../src/services/digest-service.js';
import type { StorageAdapter } from '../../src/db/adapter.js';
import type { ScanRecord } from '../../src/db/types.js';
import type { JsonReportFile } from '../../src/services/report-service.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeScan(overrides: Partial<ScanRecord> & { id: string; siteUrl: string; orgId: string }): ScanRecord {
  return {
    status: 'completed',
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'system',
    createdAt: overrides.completedAt ?? '2026-01-01T00:00:00Z',
    errors: 0,
    warnings: 0,
    notices: 0,
    confirmedViolations: 0,
    ...overrides,
  };
}

/**
 * Minimal JSON report with a given number of errors (on criterion "1.1.1") and
 * warnings (on criterion "1.3.1"). Feeds normalizeReportData correctly.
 */
function makeReport(errors: number, warnings: number): JsonReportFile {
  const errorIssues = Array.from({ length: errors }, (_, i) => ({
    type: 'error' as const,
    code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    message: `Alt text missing ${i}`,
    selector: `img:nth-child(${i + 1})`,
    context: '<img>',
    wcagCriterion: '1.1.1',
    wcagTitle: 'Non-text Content',
  }));
  const warningIssues = Array.from({ length: warnings }, (_, i) => ({
    type: 'warning' as const,
    code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42',
    message: `Heading order ${i}`,
    selector: `h2:nth-child(${i + 1})`,
    context: '<h2>',
    wcagCriterion: '1.3.1',
    wcagTitle: 'Info and Relationships',
  }));

  return {
    pages: [
      {
        url: 'https://example.com/',
        issueCount: errors + warnings,
        issues: [...errorIssues, ...warningIssues],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Stub StorageAdapter factory
// ---------------------------------------------------------------------------

interface ScanDb {
  scans: ScanRecord[];
  reports: Map<string, JsonReportFile>;
}

function makeStorage(db: ScanDb): StorageAdapter {
  const scans: StorageAdapter['scans'] = {
    async listScans(filters = {}) {
      let result = [...db.scans];
      if (filters.orgId) result = result.filter((s) => s.orgId === filters.orgId);
      if (filters.status) result = result.filter((s) => s.status === filters.status);
      if (filters.siteUrl) result = result.filter((s) => s.siteUrl.includes(filters.siteUrl!));
      return result;
    },
    async getScansForSite(orgId: string, siteUrl: string, limit = 100) {
      return db.scans
        .filter((s) => s.orgId === orgId && s.siteUrl === siteUrl)
        .sort((a, b) => {
          const ta = a.completedAt ?? a.createdAt;
          const tb = b.completedAt ?? b.createdAt;
          return tb.localeCompare(ta);
        })
        .slice(0, limit);
    },
    async getLatestCompletedForSite(orgId: string, siteUrl: string) {
      const completed = db.scans
        .filter((s) => s.orgId === orgId && s.siteUrl === siteUrl && s.status === 'completed')
        .sort((a, b) => {
          const ta = a.completedAt ?? a.createdAt;
          const tb = b.completedAt ?? b.createdAt;
          return tb.localeCompare(ta);
        });
      return completed[0] ?? null;
    },
    async getReport(id: string) {
      const r = db.reports.get(id);
      return r !== undefined ? r as unknown as Record<string, unknown> : null;
    },
    // Stubs for unused interface methods
    async createScan() { throw new Error('stub'); },
    async getScan() { return null; },
    async updateScan() { throw new Error('stub'); },
    async deleteScan() {},
    async deleteOrgScans() {},
    async listForOrg() { return { items: [], nextCursor: null }; },
    async countScans() { return 0; },
    async setPublicShare() { return false; },
    async listPubliclyShared() { return []; },
    async getLatestPerSite() { return []; },
    async getTrendData() { return []; },
  } as unknown as StorageAdapter['scans'];

  return {
    scans,
    // Unused repositories — return minimal stubs to satisfy interface
  } as unknown as StorageAdapter;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const PERIOD: DigestPeriod = {
  start: '2026-05-01T00:00:00Z',
  end: '2026-05-31T23:59:59Z',
};

const ORG_ID = 'org-test-001';
const SITE_A = 'https://site-a.example.com';
const SITE_B = 'https://site-b.example.com';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDigest', () => {
  describe('single-site scope', () => {
    it('returns hasNewScan=true with correct totals when a scan falls in the period', async () => {
      const baselineScan = makeScan({
        id: 'scan-base',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-04-15T10:00:00Z',
        createdAt: '2026-04-15T09:00:00Z',
        errors: 5,
        warnings: 3,
        notices: 2,
      });
      const currentScan = makeScan({
        id: 'scan-curr',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-05-15T10:00:00Z',
        createdAt: '2026-05-15T09:00:00Z',
        errors: 7,
        warnings: 2,
        notices: 1,
      });

      const reports = new Map<string, JsonReportFile>([
        ['scan-base', makeReport(5, 3)],
        ['scan-curr', makeReport(7, 2)],
      ]);

      const storage = makeStorage({ scans: [baselineScan, currentScan], reports });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      expect(digest.orgId).toBe(ORG_ID);
      expect(digest.siteUrl).toBe(SITE_A);
      expect(digest.sites).toHaveLength(1);

      const site = digest.sites[0];
      expect(site.hasNewScan).toBe(true);
      expect(site.siteUrl).toBe(SITE_A);
      expect(site.errors).toBe(7);
      expect(site.warnings).toBe(2);
      expect(site.notices).toBe(1);
      expect(site.errorsDelta).toBe(2);   // 7 - 5
      expect(site.warningsDelta).toBe(-1); // 2 - 3
      expect(site.noticesDelta).toBe(-1);  // 1 - 2
    });

    it('returns per-criterion criteriaChanges when reports are available', async () => {
      const baselineScan = makeScan({
        id: 'scan-crit-base',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-04-20T10:00:00Z',
        createdAt: '2026-04-20T09:00:00Z',
        errors: 3,
        warnings: 2,
      });
      const currentScan = makeScan({
        id: 'scan-crit-curr',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-05-20T10:00:00Z',
        createdAt: '2026-05-20T09:00:00Z',
        errors: 5,    // more errors (regressed on 1.1.1)
        warnings: 0,  // fewer warnings (improved on 1.3.1)
      });

      const reports = new Map<string, JsonReportFile>([
        ['scan-crit-base', makeReport(3, 2)],
        ['scan-crit-curr', makeReport(5, 0)],
      ]);

      const storage = makeStorage({ scans: [baselineScan, currentScan], reports });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      const site = digest.sites[0];
      expect(site.criteriaChanges.length).toBeGreaterThan(0);

      const c111 = site.criteriaChanges.find((c) => c.criterion === '1.1.1');
      expect(c111).toBeDefined();
      expect(c111!.newFindings).toBeGreaterThan(0); // regressed

      const c131 = site.criteriaChanges.find((c) => c.criterion === '1.3.1');
      expect(c131).toBeDefined();
      expect(c131!.fixedFindings).toBeGreaterThan(0); // improved
    });

    it('returns hasNewScan=false with deltas=0 when no scan falls within the period', async () => {
      const recentScan = makeScan({
        id: 'scan-old',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-03-10T10:00:00Z',  // before PERIOD.start
        createdAt: '2026-03-10T09:00:00Z',
        errors: 4,
        warnings: 6,
        notices: 1,
      });

      const storage = makeStorage({ scans: [recentScan], reports: new Map() });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      const site = digest.sites[0];
      expect(site.hasNewScan).toBe(false);
      expect(site.errorsDelta).toBe(0);
      expect(site.warningsDelta).toBe(0);
      expect(site.noticesDelta).toBe(0);
      expect(site.criteriaChanges).toHaveLength(0);
      // Still reports currentExposure from the most recent scan (conservative D-03)
      expect(site.currentExposure).not.toBeNull();
    });

    it('returns hasNewScan=false and currentExposure=null when no scan exists at all', async () => {
      const storage = makeStorage({ scans: [], reports: new Map() });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      const site = digest.sites[0];
      expect(site.hasNewScan).toBe(false);
      expect(site.currentExposure).toBeNull();
    });
  });

  describe('exposure direction', () => {
    it('computes direction=worsened when current band is higher than baseline band', async () => {
      // baseline: no findings → lower band; current: many errors → high band
      const baselineScan = makeScan({
        id: 'scan-dir-base',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-04-10T10:00:00Z',
        createdAt: '2026-04-10T09:00:00Z',
        errors: 0,
        warnings: 0,
        notices: 0,
        jurisdictions: [],
      });
      const currentScan = makeScan({
        id: 'scan-dir-curr',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-05-10T10:00:00Z',
        createdAt: '2026-05-10T09:00:00Z',
        errors: 50,
        warnings: 20,
        notices: 10,
        jurisdictions: [],
      });

      const storage = makeStorage({ scans: [baselineScan, currentScan], reports: new Map() });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      const site = digest.sites[0];
      expect(site.direction).toBe('worsened');
      expect(site.currentExposure).not.toBeNull();
      expect(site.baselineExposure).not.toBeNull();
    });

    it('computes direction=improved when current band is lower than baseline band', async () => {
      // baseline: many errors → high band; current: no findings → lower band
      const baselineScan = makeScan({
        id: 'scan-impr-base',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-04-10T10:00:00Z',
        createdAt: '2026-04-10T09:00:00Z',
        errors: 50,
        warnings: 20,
        notices: 10,
        jurisdictions: [],
      });
      const currentScan = makeScan({
        id: 'scan-impr-curr',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-05-10T10:00:00Z',
        createdAt: '2026-05-10T09:00:00Z',
        errors: 0,
        warnings: 0,
        notices: 0,
        jurisdictions: [],
      });

      const storage = makeStorage({ scans: [baselineScan, currentScan], reports: new Map() });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      const site = digest.sites[0];
      expect(site.direction).toBe('improved');
    });

    it('computes direction=unchanged when both scans yield the same band', async () => {
      // Both scans: no findings → lower band
      const baselineScan = makeScan({
        id: 'scan-same-base',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-04-10T10:00:00Z',
        createdAt: '2026-04-10T09:00:00Z',
        errors: 0,
        warnings: 0,
        notices: 0,
      });
      const currentScan = makeScan({
        id: 'scan-same-curr',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-05-10T10:00:00Z',
        createdAt: '2026-05-10T09:00:00Z',
        errors: 0,
        warnings: 0,
        notices: 0,
      });

      const storage = makeStorage({ scans: [baselineScan, currentScan], reports: new Map() });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      expect(digest.sites[0].direction).toBe('unchanged');
    });
  });

  describe('org-scope ordering', () => {
    it('sorts sites by current exposure band DESC (most at risk first)', async () => {
      // Site A: many errors → high band
      const siteABase = makeScan({
        id: 'scan-a-base',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-04-10T10:00:00Z',
        createdAt: '2026-04-10T09:00:00Z',
      });
      const siteACurr = makeScan({
        id: 'scan-a-curr',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-05-10T10:00:00Z',
        createdAt: '2026-05-10T09:00:00Z',
        errors: 50,
        warnings: 20,
        notices: 10,
        jurisdictions: [],
      });

      // Site B: no findings → lower band
      const siteBBase = makeScan({
        id: 'scan-b-base',
        siteUrl: SITE_B,
        orgId: ORG_ID,
        completedAt: '2026-04-12T10:00:00Z',
        createdAt: '2026-04-12T09:00:00Z',
      });
      const siteBCurr = makeScan({
        id: 'scan-b-curr',
        siteUrl: SITE_B,
        orgId: ORG_ID,
        completedAt: '2026-05-12T10:00:00Z',
        createdAt: '2026-05-12T09:00:00Z',
        errors: 0,
        warnings: 0,
        notices: 0,
        jurisdictions: [],
      });

      const storage = makeStorage({
        scans: [siteABase, siteACurr, siteBBase, siteBCurr],
        reports: new Map(),
      });

      // Org-wide scope: siteUrl = null
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: null }, PERIOD);

      expect(digest.sites).toHaveLength(2);
      // Site A (high band) must be first
      expect(digest.sites[0].siteUrl).toBe(SITE_A);
      expect(digest.sites[1].siteUrl).toBe(SITE_B);
    });
  });

  describe('conservative framing assertions (D-12)', () => {
    it('DigestData JSON contains no forbidden words', async () => {
      const scan = makeScan({
        id: 'scan-framing',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-05-10T10:00:00Z',
        createdAt: '2026-05-10T09:00:00Z',
        errors: 5,
        jurisdictions: ['EU'],
        regulations: ['EU-EAA'],
      });

      const storage = makeStorage({ scans: [scan], reports: new Map() });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);
      const payload = JSON.stringify(digest);

      expect(payload).not.toMatch(/\b(compliant|100%|lawsuit-proof|will be sued|guarantee)\b/i);
    });

    it('exposure band in DigestData is always a string label, never a number', async () => {
      const scan = makeScan({
        id: 'scan-band-check',
        siteUrl: SITE_A,
        orgId: ORG_ID,
        completedAt: '2026-05-10T10:00:00Z',
        createdAt: '2026-05-10T09:00:00Z',
        errors: 10,
        warnings: 5,
        jurisdictions: ['EU'],
        regulations: ['EU-EAA'],
      });

      const storage = makeStorage({ scans: [scan], reports: new Map() });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      for (const site of digest.sites) {
        if (site.currentExposure !== null) {
          expect(typeof site.currentExposure.band).toBe('string');
          expect(['lower', 'moderate', 'elevated', 'high']).toContain(site.currentExposure.band);
        }
      }
    });
  });

  describe('generatedAt', () => {
    it('sets generatedAt to a valid ISO date string', async () => {
      const storage = makeStorage({ scans: [], reports: new Map() });
      const digest = await buildDigest(storage, { orgId: ORG_ID, siteUrl: SITE_A }, PERIOD);

      expect(typeof digest.generatedAt).toBe('string');
      expect(() => new Date(digest.generatedAt)).not.toThrow();
      expect(new Date(digest.generatedAt).toISOString()).toBe(digest.generatedAt);
    });
  });
});

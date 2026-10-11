/**
 * Plan 88-02 Task 1: the one read path (D-05), error-name-only loading (D-14/IN-03),
 * per-criterion dismissed counts (D-10) and persisted counts (D-16).
 * Every storage here is the real SqliteStorageAdapter (88-01 harness) or a one-method stub for the failure case.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StorageAdapter } from '../../../src/db/index.js';
import {
  applyActiveDismissals,
  dismissedCountsByCriterion,
  loadReportForScan,
  persistedCountsFor,
} from '../../../src/services/issue-dismissals/load-dismissed-report.js';
import { countIssues } from '../../../src/services/count-issues.js';
import { normalizeReportData } from '../../../src/services/report-service.js';
import type { DismissedOccurrence } from '../../../src/services/issue-dismissals/apply-dismissals.js';
import {
  CODE,
  OTHER_SELECTOR,
  SELECTOR,
  defaultReport,
  openStore,
  seedDismissal,
  seedOrg,
  seedScan,
  type Store,
} from '../../helpers/issue-dismissal-route-harness.js';

const SITE = 'https://fabrikam.example/shop/';

describe('applyActiveDismissals (D-05)', () => {
  let store: Store;
  let orgA: string;
  let orgB: string;

  beforeEach(async () => {
    store = await openStore();
    orgA = await seedOrg(store.storage, `fabrikam-${randomUUID().slice(0, 8)}`);
    orgB = await seedOrg(store.storage, `northwind-${randomUUID().slice(0, 8)}`);
  });
  afterEach(async () => {
    await store.cleanup();
  });

  it('returns the raw report by reference when the storage has no dismissal repository', async () => {
    const raw = defaultReport(SITE);
    const noRepo = Object.create(store.storage, { issueDismissals: { value: undefined } }) as StorageAdapter;
    const result = await applyActiveDismissals(noRepo, { orgId: orgA, siteUrl: SITE }, raw);
    expect(result.report).toBe(raw);
    expect(result.dismissed).toEqual([]);
    expect(result.active).toEqual([]);
  });

  it('returns the raw report by reference when the site has no active dismissal', async () => {
    const raw = defaultReport(SITE);
    const result = await applyActiveDismissals(store.storage, { orgId: orgA, siteUrl: SITE }, raw);
    expect(result.report).toBe(raw);
    expect(result.dismissed).toEqual([]);
    expect(result.active).toEqual([]);
  });

  it('returns the raw report by reference and still returns the active rows when active dismissals match nothing', async () => {
    const raw = defaultReport(SITE);
    await seedDismissal(store.storage, { orgId: orgA, siteUrl: SITE, selector: '#nothing-matches-this' });
    const result = await applyActiveDismissals(store.storage, { orgId: orgA, siteUrl: SITE }, raw);
    expect(result.report).toBe(raw);
    expect(result.dismissed.length).toBe(0);
    expect(result.active.length).toBe(1);
  });

  it("removes one active dismissal's occurrences and returns them with the active rows", async () => {
    const raw = defaultReport(SITE);
    await seedDismissal(store.storage, { orgId: orgA, siteUrl: SITE, reason: 'verified by hand' });
    const result = await applyActiveDismissals(store.storage, { orgId: orgA, siteUrl: SITE }, raw);
    expect(result.report).not.toBe(raw);
    expect(result.dismissed.length).toBe(2);
    expect(result.active[0]?.reason).toBe('verified by hand');
    const summary = (result.report as { summary: { byLevel: { error: number } } }).summary;
    expect(summary.byLevel.error).toBe(0);
    // The raw object is never mutated (D-01).
    expect((raw as { summary: { byLevel: { error: number } } }).summary.byLevel.error).toBe(2);
  });

  it("never applies another org's dismissal for the same site URL", async () => {
    const raw = defaultReport(SITE);
    await seedDismissal(store.storage, { orgId: orgB, siteUrl: SITE });
    const result = await applyActiveDismissals(store.storage, { orgId: orgA, siteUrl: SITE }, raw);
    expect(result.report).toBe(raw);
    expect(result.dismissed.length).toBe(0);
    expect(result.active.length).toBe(0);
  });

  it('applies a dismissal recorded on a trailing-slash / host-case variant of the site URL', async () => {
    const raw = defaultReport('https://FABRIKAM.example/shop');
    await seedDismissal(store.storage, { orgId: orgA, siteUrl: 'https://fabrikam.example/shop/' });
    const result = await applyActiveDismissals(
      store.storage,
      { orgId: orgA, siteUrl: 'https://FABRIKAM.example/shop' },
      raw,
    );
    expect(result.dismissed.length).toBe(2);
  });

  it('does not apply a revoked dismissal', async () => {
    const raw = defaultReport(SITE);
    const d = await seedDismissal(store.storage, { orgId: orgA, siteUrl: SITE });
    const revoked = await store.storage.issueDismissals!.revoke({
      id: d.id,
      orgId: orgA,
      actor: 'seed',
      comment: 'changed my mind',
    });
    expect(revoked.kind).toBe('revoked');
    const result = await applyActiveDismissals(store.storage, { orgId: orgA, siteUrl: SITE }, raw);
    expect(result.report).toBe(raw);
    expect(result.dismissed.length).toBe(0);
  });

  it('applyActiveDismissals hands normalizeReportData a matrix without the fully dismissed criterion', async () => {
    const violation = { wcagCriterion: '1.4.3', obligation: 'mandatory', issueCount: 1 };
    const raw = {
      ...defaultReport(SITE),
      compliance: {
        matrix: {
          FAB: {
            jurisdictionId: 'FAB',
            jurisdictionName: 'Fabrikam Land',
            status: 'fail',
            mandatoryViolations: 1,
            recommendedViolations: 0,
            optionalViolations: 0,
            regulations: [
              { regulationId: 'R1', regulationName: 'Fabrikam Act', shortName: 'FA', status: 'fail', enforcementDate: '2025-01-01', scope: 'all', violations: [violation] },
            ],
          },
        },
        regulationMatrix: {},
        annotatedIssues: [{ code: CODE, wcagCriterion: '1.4.3', wcagLevel: 'AA', originalIssue: { code: CODE, selector: SELECTOR }, regulations: [] }],
        summary: { totalJurisdictions: 1, passing: 0, failing: 1, totalMandatoryViolations: 1, totalOptionalViolations: 0 },
      },
    };
    const scan = { orgId: orgA, siteUrl: SITE, errors: 2 };
    const before = normalizeReportData(raw as never, scan);
    expect(before.complianceMatrix?.[0]?.violations.map((v: { wcagCriterion: string }) => v.wcagCriterion)).toEqual(['1.4.3']);
    expect(before.complianceMatrix?.[0]?.reviewStatus).toBe('fail');

    await seedDismissal(store.storage, { orgId: orgA, siteUrl: SITE });
    const result = await applyActiveDismissals(store.storage, scan, raw);
    const after = normalizeReportData(result.report as never, { ...scan, errors: 0 });
    expect(after.complianceMatrix?.[0]?.violations).toEqual([]);
    expect(after.complianceMatrix?.[0]?.reviewStatus).toBe('pass');
  });

  it('propagates a repository failure instead of returning the raw report', async () => {
    const failing = {
      issueDismissals: { listActiveForSite: () => Promise.reject(new Error('repository down')) },
    } as unknown as StorageAdapter;
    await expect(
      applyActiveDismissals(failing, { orgId: orgA, siteUrl: SITE }, defaultReport(SITE)),
    ).rejects.toThrow('repository down');
  });
});

describe('loadReportForScan (D-14 / IN-03)', () => {
  let store: Store;
  let orgId: string;
  let dir: string;

  beforeEach(async () => {
    store = await openStore();
    orgId = await seedOrg(store.storage, `fabrikam-${randomUUID().slice(0, 8)}`);
    dir = mkdtempSync(join(tmpdir(), 'load-dismissed-report-'));
  });
  afterEach(async () => {
    rmSync(dir, { recursive: true, force: true });
    await store.cleanup();
  });

  it('reads the DB report first', async () => {
    const id = await seedScan(store.storage, { orgId, siteUrl: SITE });
    const result = await loadReportForScan(store.storage, { id, jsonReportPath: join(dir, 'absent.json') });
    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && (result.report as { pages: unknown[] }).pages.length).toBe(2);
  });

  it('falls back to the jsonReportPath file', async () => {
    const file = join(dir, 'report.json');
    writeFileSync(file, JSON.stringify({ pages: [], marker: 'from-file' }));
    const result = await loadReportForScan(store.storage, { id: 'scan_absent', jsonReportPath: file });
    expect(result).toEqual({ kind: 'ok', report: { pages: [], marker: 'from-file' } });
  });

  it('reports missing when neither exists', async () => {
    const noPath = await loadReportForScan(store.storage, { id: 'scan_absent' });
    expect(noPath).toEqual({ kind: 'missing' });
    const noFile = await loadReportForScan(store.storage, { id: 'scan_absent', jsonReportPath: join(dir, 'none.json') });
    expect(noFile).toEqual({ kind: 'missing' });
  });

  it('reports a parse failure by error name only', async () => {
    const token = `TOKEN-${randomUUID()}`;
    const file = join(dir, 'broken.json');
    writeFileSync(file, `{"pages": [ ${token} `);
    const result = await loadReportForScan(store.storage, { id: 'scan_absent', jsonReportPath: file });
    expect(result).toEqual({ kind: 'error', errorName: 'SyntaxError' });
    expect(JSON.stringify(result)).not.toContain(token);
  });
});

function occurrence(code: string, extra: Record<string, unknown> = {}): DismissedOccurrence {
  return { dismissalId: 'd1', pageUrl: `${SITE}a`, issue: { code, ...extra }, isTemplate: false };
}

describe('dismissedCountsByCriterion (D-10)', () => {
  it('counts dismissed occurrences per criterion', () => {
    const counts = dismissedCountsByCriterion([
      occurrence('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18'),
      occurrence('WCAG2AA.Principle1.Guideline1_4.1_4_3.G145'),
      occurrence('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'),
    ]);
    expect(counts.get('1.4.3')).toBe(2);
    expect(counts.get('1.1.1')).toBe(1);
  });

  it('prefers issue.wcagCriterion over the code', () => {
    const counts = dismissedCountsByCriterion([
      occurrence('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18', { wcagCriterion: '2.4.7' }),
    ]);
    expect(counts.get('2.4.7')).toBe(1);
    expect(counts.has('1.4.3')).toBe(false);
  });

  it('omits occurrences with no criterion', () => {
    const counts = dismissedCountsByCriterion([occurrence('lighthouse.fallback'), occurrence('x', { wcagCriterion: '' })]);
    expect(counts.size).toBe(0);
  });
});

describe('persistedCountsFor (D-16)', () => {
  let store: Store;
  let orgId: string;

  beforeEach(async () => {
    store = await openStore();
    orgId = await seedOrg(store.storage, `fabrikam-${randomUUID().slice(0, 8)}`);
  });
  afterEach(async () => {
    await store.cleanup();
  });

  const pages = () => (defaultReport(SITE).pages as unknown[]);

  it('zero dismissals returns the raw counts object even when it disagrees with the pages', async () => {
    const rawCounts = { errors: 99, warnings: 0, notices: 0, total: 99 };
    const result = await persistedCountsFor(store.storage, { orgId, siteUrl: SITE }, pages(), rawCounts);
    expect(result).toBe(rawCounts);
  });

  it('one dismissal returns countIssues of the filtered pages', async () => {
    await seedDismissal(store.storage, { orgId, siteUrl: SITE });
    const rawCounts = { errors: 99, warnings: 0, notices: 0, total: 99 };
    const result = await persistedCountsFor(store.storage, { orgId, siteUrl: SITE }, pages(), rawCounts);
    expect(result).toEqual({ errors: 0, warnings: 2, notices: 2, total: 4 });
    expect(result).toEqual(countIssues({ pages: pages().map((p) => ({ ...(p as object), issues: (p as { issues: { code: string; selector: string }[] }).issues.filter((i) => !(i.code === CODE && i.selector === SELECTOR)) })) }));
  });
});

// Keep the harness exports referenced so an accidental rename fails here, not silently.
void OTHER_SELECTOR;

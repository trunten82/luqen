/**
 * Plan 88-11: recomputeSiteCounts (D-13, D-14, D-15). Real SQLite throughout; the only stubs are thin
 * wrappers around one storage method (to record writes, force a failure, or commit a dismissal mid-run).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { StorageAdapter } from '../../../src/db/index.js';
import { recomputeSiteCounts } from '../../../src/services/issue-dismissals/recompute-site-counts.js';
import { toSiteKey } from '../../../src/services/issue-dismissals/site-key.js';
import { countIssues } from '../../../src/services/count-issues.js';
import {
  AFTER_BOTH,
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_OTHER_SITE,
  FABRIKAM_SITE,
  FABRIKAM_SITE_VARIANT,
  RAW_COUNTS,
  openSurfaceStore,
  seedForeignDismissals,
  seedSurfaceDismissal,
  seedSurfaceOrgs,
  seedSurfaceScan,
  surfaceReport,
  type ExpectedCounts,
  type SurfaceOrgs,
  type SurfaceStore,
} from '../../helpers/dismissal-surface-fixture.js';

const SITE_KEY = toSiteKey(FABRIKAM_SITE);

let store: SurfaceStore;
let orgs: SurfaceOrgs;

beforeEach(async () => {
  store = await openSurfaceStore();
  orgs = await seedSurfaceOrgs(store.storage);
});
afterEach(async () => {
  await store.cleanup();
});

async function columnsOf(storage: StorageAdapter, id: string): Promise<ExpectedCounts> {
  const scan = await storage.scans.getScan(id);
  if (scan === null) throw new Error('scan vanished');
  return {
    errors: scan.errors ?? -1,
    warnings: scan.warnings ?? -1,
    notices: scan.notices ?? -1,
    total: scan.totalIssues ?? -1,
  };
}

function silentLog() {
  return { warn: vi.fn() };
}

/** A storage whose scans repository is the real one with some methods replaced. */
function withScans(storage: StorageAdapter, overrides: Record<string, unknown>): StorageAdapter {
  const scans = Object.create(storage.scans, Object.fromEntries(
    Object.entries(overrides).map(([k, v]) => [k, { value: v }]),
  ));
  return Object.create(storage, { scans: { value: scans } }) as StorageAdapter;
}

describe('recomputeSiteCounts (FP-09, D-13)', () => {
  it('recomputes every completed scan of the org and site key, including trailing-slash variants', async () => {
    const a = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_SITE, location: 'db' });
    const b = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_SITE_VARIANT, location: 'db' });
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    expect(await columnsOf(store.storage, a)).toEqual(RAW_COUNTS);

    const result = await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, silentLog());

    expect(result).toMatchObject({ recomputedScans: 2, failedScans: 0, listed: true });
    expect(await columnsOf(store.storage, a)).toEqual(AFTER_PARTIAL);
    expect(await columnsOf(store.storage, b)).toEqual(AFTER_PARTIAL);
  });

  it("never touches another org's scan of the same URL or another site's scan", async () => {
    const mine = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    const theirs = await seedSurfaceScan(store.storage, { orgId: orgs.northwindOrgId, location: 'db' });
    const otherSite = await seedSurfaceScan(store.storage, {
      orgId: orgs.fabrikamOrgId,
      siteUrl: FABRIKAM_OTHER_SITE,
      location: 'db',
    });
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    // Poison the foreign scans so an accidental recompute would be visible.
    for (const id of [theirs, otherSite]) {
      await store.storage.scans.updateScan(id, { errors: 99, warnings: 99, notices: 99, totalIssues: 297 });
    }

    const result = await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, silentLog());

    expect(result.recomputedScans).toBe(1);
    expect(await columnsOf(store.storage, mine)).toEqual(AFTER_PARTIAL);
    const poisoned = { errors: 99, warnings: 99, notices: 99, total: 297 };
    expect(await columnsOf(store.storage, theirs)).toEqual(poisoned);
    expect(await columnsOf(store.storage, otherSite)).toEqual(poisoned);
  });

  it('writes only the four count columns', async () => {
    const id = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    await store.storage.scans.updateScan(id, { confirmedViolations: 7 });
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    const writes: Array<[string, Record<string, unknown>]> = [];
    const real = store.storage.scans.updateScan.bind(store.storage.scans);
    const spied = withScans(store.storage, {
      updateScan: (scanId: string, data: Record<string, unknown>) => {
        writes.push([scanId, data]);
        return real(scanId, data);
      },
    });

    await recomputeSiteCounts(spied, orgs.fabrikamOrgId, SITE_KEY, silentLog());

    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe(id);
    expect(Object.keys(writes[0][1]).sort()).toEqual(['errors', 'notices', 'totalIssues', 'warnings']);
    expect((await store.storage.scans.getScan(id))?.confirmedViolations).toBe(7);
  });
});

// ── Task 2 ───────────────────────────────────────────────────────────────────

describe('recomputeSiteCounts failure semantics (D-14, IN-03)', () => {
  it('counts a scan whose report cannot be read as failed and logs only its id and error name', async () => {
    const good = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    const bad = await seedSurfaceScan(store.storage, {
      orgId: orgs.fabrikamOrgId,
      location: 'fs',
      reportsDir: store.reportsDir,
    });
    const path = (await store.storage.scans.getScan(bad))?.jsonReportPath as string;
    writeFileSync(path, '{"pages": CORRUPT-TOKEN-5e2a', 'utf-8');
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    const log = silentLog();

    const result = await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, log);

    expect(result).toMatchObject({ recomputedScans: 1, failedScans: 1, listed: true });
    expect(await columnsOf(store.storage, good)).toEqual(AFTER_PARTIAL);
    expect(await columnsOf(store.storage, bad)).toEqual(RAW_COUNTS); // untouched, still the old columns
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [obj] = log.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(obj).toEqual({ scanId: bad, errorName: 'SyntaxError' });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('CORRUPT-TOKEN');
  });

  it('counts a scan with no report as failed', async () => {
    const id = 'scan_noreport_0001';
    await store.storage.scans.createScan({
      id,
      siteUrl: FABRIKAM_SITE,
      standard: 'WCAG2AA',
      jurisdictions: [],
      regulations: [],
      createdBy: 'seed',
      createdAt: new Date().toISOString(),
      orgId: orgs.fabrikamOrgId,
    });
    await store.storage.scans.updateScan(id, { status: 'completed', completedAt: new Date().toISOString() });
    const log = silentLog();

    const result = await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, log);

    expect(result).toMatchObject({ recomputedScans: 0, failedScans: 1, listed: true });
    expect(log.warn.mock.calls[0][0]).toEqual({ scanId: id, errorName: 'NoReport' });
  });

  it('WR-01: a stored report without a pages array is counted as failed and its columns are left untouched', async () => {
    const good = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    const flat = await seedSurfaceScan(store.storage, {
      orgId: orgs.fabrikamOrgId,
      location: 'db',
      report: { siteUrl: FABRIKAM_SITE, issues: [{ code: 'x', type: 'error', selector: 'a', message: 'm' }] },
    });
    // The columns are the only record of the original counts for such a row: poison them to prove no write.
    await store.storage.scans.updateScan(flat, { errors: 5, warnings: 4, notices: 3, totalIssues: 12 });
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    const log = silentLog();

    const result = await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, log);

    expect(result).toMatchObject({ recomputedScans: 1, failedScans: 1, listed: true });
    expect(await columnsOf(store.storage, good)).toEqual(AFTER_PARTIAL);
    expect(await columnsOf(store.storage, flat)).toEqual({ errors: 5, warnings: 4, notices: 3, total: 12 });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toEqual({ scanId: flat, errorName: 'UnsupportedReportShape' });
  });

  it('reports an incomplete recompute when the scan listing fails', async () => {
    await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    const boom = withScans(store.storage, {
      listScans: async () => {
        throw new TypeError('db is locked: secret-detail');
      },
    });
    const log = silentLog();

    const result = await recomputeSiteCounts(boom, orgs.fabrikamOrgId, SITE_KEY, log);

    expect(result).toMatchObject({ recomputedScans: 0, failedScans: 0, listed: false });
    expect(log.warn.mock.calls[0][0]).toEqual({ scanId: '-', errorName: 'TypeError' });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('secret-detail');
  });

  it('only completed scans are recomputed (queued and failed scans have no report to recount)', async () => {
    const queued = 'scan_queued_0001';
    await store.storage.scans.createScan({
      id: queued,
      siteUrl: FABRIKAM_SITE,
      standard: 'WCAG2AA',
      jurisdictions: [],
      regulations: [],
      createdBy: 'seed',
      createdAt: new Date().toISOString(),
      orgId: orgs.fabrikamOrgId,
    });
    const result = await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, silentLog());
    expect(result).toMatchObject({ recomputedScans: 0, failedScans: 0, listed: true });
  });
});

describe('recomputeSiteCounts semantics (FP-08 probe edges)', () => {
  it('reads the active set per scan so a dismissal committed mid-recompute applies to every scan written after it', async () => {
    const a = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    const b = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    const realGetReport = store.storage.scans.getReport.bind(store.storage.scans);
    let calls = 0;
    const racing = withScans(store.storage, {
      getReport: async (id: string) => {
        calls += 1;
        // A second dismissal commits while the first report is being loaded.
        if (calls === 1) {
          await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_WHOLE });
        }
        return realGetReport(id);
      },
    });

    const result = await recomputeSiteCounts(racing, orgs.fabrikamOrgId, SITE_KEY, silentLog());

    expect(result.recomputedScans).toBe(2);
    expect(await columnsOf(store.storage, a)).toEqual(AFTER_BOTH);
    expect(await columnsOf(store.storage, b)).toEqual(AFTER_BOTH);
  });

  it('is idempotent', async () => {
    const id = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, silentLog());
    const first = await columnsOf(store.storage, id);
    await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, silentLog());
    expect(await columnsOf(store.storage, id)).toEqual(first);
    expect(first).toEqual(AFTER_PARTIAL);
  });

  it('dismissing every error of a scan persists errors 0 and total = warnings + notices', async () => {
    const onlyErrors = surfaceReport(FABRIKAM_SITE);
    const id = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db', report: onlyErrors });
    // Dismiss every error occurrence: contrast (both selectors) and alt.
    for (const match of [
      DISMISS_PARTIAL,
      DISMISS_WHOLE,
      { code: DISMISS_PARTIAL.code, selector: '#fabrikam-footer-note' },
    ]) {
      await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match });
    }

    await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, silentLog());

    const cols = await columnsOf(store.storage, id);
    expect(cols.errors).toBe(0);
    expect(cols.total).toBe(cols.warnings + cols.notices);
    expect(cols).toEqual({ errors: 0, warnings: 2, notices: 1, total: 3 });
  });

  it('with zero active dismissals the recomputed columns equal the stored columns', async () => {
    const id = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    await seedForeignDismissals(store.storage, orgs); // other org / other site only
    const before = await columnsOf(store.storage, id);

    await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, SITE_KEY, silentLog());

    expect(await columnsOf(store.storage, id)).toEqual(before);
    expect(before).toEqual(RAW_COUNTS);
    expect(before.total).toBe(countIssues(surfaceReport(FABRIKAM_SITE)).total);
  });
});

/**
 * COPY-01 (D-01): the dismiss dialog says a dismissal also applies in EARLIER completed scans of the
 * same site. That claim is checked here against the real read path and the real recompute, on a real
 * SQLite store, BEFORE the wording says it: a dismissal marked after an earlier scan completed still
 * filters that scan, and the recompute rewrites its stored counts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StorageAdapter } from '../../../src/db/index.js';
import { applyActiveDismissals } from '../../../src/services/issue-dismissals/load-dismissed-report.js';
import { recomputeSiteCounts } from '../../../src/services/issue-dismissals/recompute-site-counts.js';
import { toSiteKey } from '../../../src/services/issue-dismissals/site-key.js';
import {
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  FABRIKAM_SITE,
  RAW_COUNTS,
  SEL_DISMISSED,
  openSurfaceStore,
  seedSurfaceDismissal,
  seedSurfaceOrgs,
  seedSurfaceScan,
  surfaceReport,
  type SurfaceOrgs,
  type SurfaceStore,
} from '../../helpers/dismissal-surface-fixture.js';

const EARLIER_AT = '2026-08-01T09:00:00.000Z';
const NEWER_AT = '2026-09-01T09:00:00.000Z';

let store: SurfaceStore;
let orgs: SurfaceOrgs;
let earlierId: string;

beforeEach(async () => {
  store = await openSurfaceStore();
  orgs = await seedSurfaceOrgs(store.storage);
  earlierId = await seedSurfaceScan(store.storage, {
    orgId: orgs.fabrikamOrgId, location: 'db', id: 'scan-fabrikam-earlier',
    createdAt: EARLIER_AT, completedAt: EARLIER_AT,
  });
  await seedSurfaceScan(store.storage, {
    orgId: orgs.fabrikamOrgId, location: 'db', id: 'scan-fabrikam-newer',
    createdAt: NEWER_AT, completedAt: NEWER_AT,
  });
});
afterEach(async () => {
  await store.cleanup();
});

async function totalOf(storage: StorageAdapter, id: string): Promise<number> {
  const scan = await storage.scans.getScan(id);
  return scan?.totalIssues ?? -1;
}

describe('a dismissal reaches scans that completed before it was marked', () => {
  it('COPY-01 a dismissal marked after an earlier scan completed filters that earlier scan', async () => {
    // The dismissal is marked now, long after both scans completed.
    const dismissal = await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    expect(new Date(dismissal.createdAt).getTime()).toBeGreaterThan(new Date(EARLIER_AT).getTime());

    const earlier = await store.storage.scans.getScan(earlierId);
    expect(earlier?.siteUrl).toBe(FABRIKAM_SITE);
    expect(toSiteKey(earlier!.siteUrl)).toBe(toSiteKey(dismissal.siteUrl));
    const raw = surfaceReport(FABRIKAM_SITE);
    expect(JSON.stringify(raw)).toContain(SEL_DISMISSED.slice(1)); // control: the raw report holds the finding

    const applied = await applyActiveDismissals(store.storage, earlier!, raw);
    expect(applied.dismissed.length).toBeGreaterThan(0);
    expect(applied.dismissed.every((d) => d.dismissalId === dismissal.id)).toBe(true);
    expect(JSON.stringify(applied.report)).not.toContain(SEL_DISMISSED.slice(1));
  });

  it('COPY-01 the recompute rewrites the stored counts of an earlier completed scan', async () => {
    expect(await totalOf(store.storage, earlierId)).toBe(RAW_COUNTS.total);
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });

    const result = await recomputeSiteCounts(store.storage, orgs.fabrikamOrgId, toSiteKey(FABRIKAM_SITE), { warn: () => undefined });

    expect(result).toMatchObject({ recomputedScans: 2, failedScans: 0, listed: true });
    expect(await totalOf(store.storage, earlierId)).toBe(AFTER_PARTIAL.total);
    expect(await totalOf(store.storage, earlierId)).toBeLessThan(RAW_COUNTS.total);
  });
});

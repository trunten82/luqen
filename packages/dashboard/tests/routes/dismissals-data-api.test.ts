/**
 * Phase 88 Plan 08: one test per REST report-read call site (D-06).
 *
 * Each test seeds its own dismissal for the Fabrikam org + site, drives the REAL
 * routes (Plan 03 drivers, real SQLite store, FS report reads) and asserts, at
 * string level over the WHOLE response, that the dismissed finding is gone while
 * its same-code sibling and the unrelated findings remain. Foreign dismissals
 * (Northwind on the same URL, Fabrikam on another site) are seeded by
 * createApiContext and must never apply.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import {
  apiShapedReport,
  createApiContext,
  driveRestComplianceSummary,
  driveRestScan,
  driveRestScanFixes,
  driveRestScanIssues,
} from '../golden/drivers/api-drivers.js';
import type { SurfaceContext } from '../golden/drivers/render-drivers.js';
import {
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_SITE,
  SEL_DISMISSED,
  SEL_SIBLING,
  assertDismissedAbsent,
  assertSiblingPresent,
  seedSurfaceDismissal,
  seedSurfaceScan,
} from '../helpers/dismissal-surface-fixture.js';

let ctx: SurfaceContext;

beforeEach(async () => {
  ctx = await createApiContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dismiss(match: { readonly code: string; readonly selector: string }): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

interface Envelope<T> {
  readonly status: number;
  readonly body: T;
}

describe('REST GET /api/v1/scans/:id/issues applies the scan org active dismissals', () => {
  it('REST scan issues omits a dismissed finding', async () => {
    await dismiss(DISMISS_PARTIAL);
    const out = (await driveRestScanIssues(ctx)) as {
      all: Envelope<{ data: ReadonlyArray<{ selector: string }>; total: number }>;
    };

    expect(out.all.status).toBe(200);
    const selectors = out.all.body.data.map((i) => i.selector);
    expect(selectors).not.toContain(SEL_DISMISSED);
    expect(selectors).toContain(SEL_SIBLING);
    // 8 raw occurrences, 3 dismissed (one per page).
    expect(out.all.body.total).toBe(AFTER_PARTIAL.total);
    const text = JSON.stringify(out);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });
});

/** A NEWER completed Fabrikam scan of the same site, so it is the site's latest. */
async function seedLatestScan(withSibling: boolean): Promise<string> {
  return seedSurfaceScan(ctx.storage, {
    orgId: ctx.orgs.fabrikamOrgId,
    location: 'both',
    reportsDir: ctx.store.reportsDir,
    id: 'scan-fabrikam-latest-0002',
    report: apiShapedReport(FABRIKAM_SITE, { withSibling }),
    createdAt: '2026-10-05T10:00:00.000Z',
    completedAt: '2026-10-05T10:05:00.000Z',
  });
}

describe('REST GET /api/v1/scans/:id applies the scan org active dismissals', () => {
  it('REST scan summary reflects a dismissal', async () => {
    await dismiss(DISMISS_PARTIAL);
    const out = (await driveRestScan(ctx)) as Envelope<{
      data: { summary: { totalIssues: number; byLevel: { error: number; warning: number; notice: number } } };
    }>;

    expect(out.status).toBe(200);
    const { summary } = out.body.data;
    expect(summary.byLevel).toEqual({
      error: AFTER_PARTIAL.errors,
      warning: AFTER_PARTIAL.warnings,
      notice: AFTER_PARTIAL.notices,
    });
    expect(summary.totalIssues).toBe(AFTER_PARTIAL.total);
  });

  it('REST scan carries no dismissed finding anywhere in the whole response', async () => {
    await dismiss(DISMISS_PARTIAL);
    const out = await driveRestScan(ctx);
    const text = JSON.stringify(out);

    // The scan row's raw jsonReport blob is part of this response (toPublicScan keeps it).
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });

  it('REST scan carries no dismissed finding in the row blob when only the DB copy of the report exists', async () => {
    const dbOnlyId = await seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      location: 'db',
      id: 'scan-fabrikam-dbonly-0003',
      report: apiShapedReport(),
      createdAt: '2026-10-06T10:00:00.000Z',
      completedAt: '2026-10-06T10:05:00.000Z',
    });
    await dismiss(DISMISS_PARTIAL);
    const out = await driveRestScan(ctx, dbOnlyId);
    const text = JSON.stringify(out);

    expect((out as Envelope<unknown>).status).toBe(200);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });
});

interface JurisdictionRow {
  readonly jurisdictionId: string;
  readonly status: string;
}
interface SummaryOut {
  readonly forSite: Envelope<{ data: ReadonlyArray<{ scanId: string; jurisdictions: readonly JurisdictionRow[] }> }>;
}

function euStatus(out: SummaryOut, scanId: string): string | undefined {
  const row = out.forSite.body.data.find((d) => d.scanId === scanId);
  return row?.jurisdictions.find((j) => j.jurisdictionId === 'EU')?.status;
}

describe('REST GET /api/v1/compliance-summary applies the scan org active dismissals', () => {
  it('REST compliance summary passes a jurisdiction whose mandatory issues are all dismissed', async () => {
    const scanId = await seedLatestScan(false);
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const out = (await driveRestComplianceSummary(ctx)) as SummaryOut;

    expect(euStatus(out, scanId)).toBe('pass');
  });

  it('REST compliance summary keeps a jurisdiction failing while a same-code sibling remains', async () => {
    const scanId = await seedLatestScan(true);
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const out = (await driveRestComplianceSummary(ctx)) as SummaryOut;

    expect(euStatus(out, scanId)).toBe('fail');
  });
});

describe('REST GET /api/v1/scans/:id/fixes applies the scan org active dismissals', () => {
  it('REST scan fixes proposes no fix for a dismissed issue', async () => {
    await dismiss(DISMISS_PARTIAL);
    const out = (await driveRestScanFixes(ctx)) as Envelope<{ data: ReadonlyArray<{ selector: string }> }>;

    expect(out.status).toBe(200);
    const selectors = out.body.data.map((f) => f.selector);
    expect(selectors).not.toContain(SEL_DISMISSED);
    expect(selectors).toContain(SEL_SIBLING);
    const text = JSON.stringify(out);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });
});

/**
 * Phase 88 Plan 17: one test per MCP report-read call site (D-06).
 *
 * Each test seeds its own dismissal for the Fabrikam org + site and drives the REAL
 * MCP route (Plan 03 drivers, real SQLite store, DB-only report reads). Assertions are
 * string-level over the WHOLE tool / resource output. Foreign dismissals (Northwind on
 * the same URL, Fabrikam on another site) are seeded by createApiContext and must never
 * apply. The scan ROW carries the raw jsonReport blob and these surfaces serialise it,
 * so the dismissed selector must be absent from that blob too.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import {
  FLEET_SINCE,
  apiShapedReport,
  createApiContext,
  driveMcpFleetCounts,
  driveMcpGetReport,
  driveMcpReportResource,
} from '../golden/drivers/api-drivers.js';
import type { SurfaceContext } from '../golden/drivers/render-drivers.js';
import {
  AFTER_BOTH,
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_SITE,
  SEL_ALT,
  SEL_DISMISSED,
  SEL_LINK,
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

interface ReportShape {
  readonly summary: { readonly totalIssues: number; readonly byLevel: { error: number; warning: number; notice: number } };
  readonly compliance: {
    readonly matrix: { readonly EU: { readonly status: string; readonly regulations: ReadonlyArray<{ readonly violations: ReadonlyArray<{ readonly wcagCriterion: string }> }> } };
  };
  readonly complianceMatrix: ReadonlyArray<{ readonly status: string }>;
}

describe('MCP dashboard_get_report applies the scan org active dismissals', () => {
  it('MCP get_report omits a dismissed finding everywhere in the report', async () => {
    // A Fabrikam scan with no same-code sibling, so both dismissals empty their criterion (FP-12).
    const scanId = await seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      location: 'db',
      id: 'scan-fabrikam-nosibling-0003',
      report: apiShapedReport(FABRIKAM_SITE, { withSibling: false }),
      createdAt: '2026-10-05T10:00:00.000Z',
      completedAt: '2026-10-05T10:05:00.000Z',
    });
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);

    const out = (await driveMcpGetReport(ctx, scanId)) as { report: ReportShape; scan: Record<string, unknown> };
    const text = JSON.stringify(out);

    // Whole output: report, matrices, and the scan row's raw jsonReport blob.
    expect(text).not.toContain(SEL_DISMISSED.replace(/^#/, ''));
    expect(text).not.toContain(SEL_ALT.replace(/^#/, ''));
    assertDismissedAbsent(text, 'both');
    expect(text).toContain(SEL_LINK.replace(/^#/, ''));

    // Summary recomputed: AFTER_BOTH minus the (absent) sibling error.
    expect(out.report.summary.byLevel).toEqual({
      error: AFTER_BOTH.errors - 1,
      warning: AFTER_BOTH.warnings,
      notice: AFTER_BOTH.notices,
    });
    expect(out.report.summary.totalIssues).toBe(AFTER_BOTH.total - 1);

    // FP-12: both mandatory criteria lost their only finding, so the jurisdiction passes.
    expect(out.report.compliance.matrix.EU.status).toBe('pass');
    expect(out.report.complianceMatrix[0]?.status).toBe('pass');
    const criteria = out.report.compliance.matrix.EU.regulations.flatMap((r) => r.violations.map((v) => v.wcagCriterion));
    expect(criteria).not.toContain('1.1.1');
    expect(criteria).not.toContain('1.4.3');
    expect(criteria).toContain('2.4.4');
  });
});

describe('MCP scan report resource applies the scan org active dismissals', () => {
  it('MCP scan report resource omits a dismissed finding', async () => {
    await dismiss(DISMISS_PARTIAL);
    const out = (await driveMcpReportResource(ctx)) as { report: ReportShape; scan: Record<string, unknown> };
    const text = JSON.stringify(out);

    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
    expect(out.report.summary.totalIssues).toBe(AFTER_PARTIAL.total);
    // The sibling still fails 1.4.3, so the jurisdiction keeps failing.
    expect(out.report.compliance.matrix.EU.status).toBe('fail');
  });
});

describe('MCP dashboard_scan_summary_for_fleet applies the scan org active dismissals', () => {
  it('MCP fleet criterion counts exclude dismissed occurrences', async () => {
    const before = (await driveMcpFleetCounts(ctx)) as Record<string, { data: ReadonlyArray<{ count: number }> }>;
    expect(before['1.4.3']?.data[0]?.count).toBe(4); // 3 promo + 1 sibling
    expect(before['1.1.1']?.data[0]?.count).toBe(1);

    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const after = (await driveMcpFleetCounts(ctx)) as Record<string, { data: ReadonlyArray<{ count: number }> }>;

    expect(after['1.4.3']?.data[0]?.count).toBe(1); // the sibling still counts
    expect(after['1.1.1']?.data).toEqual([]); // site row disappears per the tool's zero rule
  });

  it('MCP fleet criterion counts ignore dismissals recorded for another org or site', async () => {
    // createApiContext already seeded foreign dismissals only.
    const out = (await driveMcpFleetCounts(ctx)) as Record<string, { data: ReadonlyArray<{ count: number }> }>;
    expect(out['1.4.3']?.data[0]?.count).toBe(4);
    expect(FLEET_SINCE).toBeTruthy();
  });
});

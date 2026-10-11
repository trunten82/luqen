/**
 * Phase 88 Plan 04: one test per render call site (D-06).
 *
 * Each test seeds its own dismissal for the Fabrikam org + site, drives the REAL
 * route (Plan 01 drivers, real SQLite store) and asserts, at string level over the
 * WHOLE output, that the dismissed finding is gone while its same-code sibling and
 * the unrelated findings remain. Foreign dismissals (Northwind on the same URL,
 * Fabrikam on another site) are seeded by createSurfaceContext and must never apply.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import {
  createSurfaceContext,
  driveReportDetail,
  makeServer,
  registerViewHelpers,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import { reportRoutes } from '../../src/routes/reports.js';
import {
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_SITE,
  REASON_TOKEN,
  SEL_ALT,
  SEL_DISMISSED,
  SEL_SIBLING,
  assertDismissedAbsent,
  assertSiblingPresent,
  seedSurfaceDismissal,
  seedSurfaceScan,
  surfaceReport,
} from '../helpers/dismissal-surface-fixture.js';

let ctx: SurfaceContext;

beforeEach(async () => {
  registerViewHelpers();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dismiss(match: { readonly code: string; readonly selector: string }): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

interface DetailView {
  readonly scan: Record<string, unknown>;
  readonly reportData: {
    readonly summary: { readonly byLevel: { error: number; warning: number; notice: number } };
    readonly pages: ReadonlyArray<{ readonly issues: ReadonlyArray<{ readonly selector: string }> }>;
    readonly templateIssues: ReadonlyArray<{ readonly selector: string }> | null;
    readonly allIssueGroups: ReadonlyArray<{
      readonly criterion: string;
      readonly issues: ReadonlyArray<{ readonly selector: string }>;
    }>;
    readonly complianceMatrix: ReadonlyArray<{
      readonly jurisdictionId: string;
      readonly reviewStatus: string;
      readonly violations: ReadonlyArray<{ readonly wcagCriterion: string }>;
    }>;
    readonly regulationMatrix: ReadonlyArray<{
      readonly regulationId: string;
      readonly status: string;
      readonly violatedRequirements: ReadonlyArray<{ readonly wcagCriterion: string }>;
    }>;
  };
}

async function detail(scanId: string = ctx.scanId): Promise<DetailView> {
  return (await driveReportDetail(ctx, scanId)) as DetailView;
}

describe('report detail (/reports/:id) applies the scan org active dismissals', () => {
  it('report detail drops a dismissed finding from the Issues, Templates and Pages tabs', async () => {
    await dismiss(DISMISS_PARTIAL);
    const data = await detail();

    // The only template-lifted finding was the dismissed one: no template list remains.
    expect((data.reportData.templateIssues ?? []).map((i) => i.selector)).not.toContain(SEL_DISMISSED);
    for (const page of data.reportData.pages) {
      expect(page.issues.map((i) => i.selector)).not.toContain(SEL_DISMISSED);
    }
    const contrast = data.reportData.allIssueGroups.find((g) => g.criterion === '1.4.3');
    expect(contrast?.issues.map((i) => i.selector)).toContain(SEL_SIBLING);
    expect(data.reportData.summary.byLevel).toEqual({
      error: AFTER_PARTIAL.errors,
      warning: AFTER_PARTIAL.warnings,
      notice: AFTER_PARTIAL.notices,
    });

    const whole = JSON.stringify(data);
    assertDismissedAbsent(whole, 'partial');
    assertSiblingPresent(whole);
  });

  it('report detail view data carries no raw copy of the dismissed finding on the scan row', async () => {
    await dismiss(DISMISS_PARTIAL);
    const data = await detail();
    // The row is spread into the view data; its raw report blob must be the filtered report.
    expect(typeof data.scan['jsonReport']).toBe('string');
    expect(data.scan['jsonReport'] as string).not.toContain(SEL_DISMISSED.replace(/^#/, ''));
    expect(data.scan['jsonReport'] as string).toContain(SEL_SIBLING.replace(/^#/, ''));
    expect(JSON.stringify(data)).not.toContain(REASON_TOKEN);
  });

  it('report detail shows a fully dismissed criterion as not failing in the compliance and regulation matrices', async () => {
    const scanId = await seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      location: 'db',
      id: 'scan-fabrikam-nosibling-0001',
      report: surfaceReport(FABRIKAM_SITE, { withSibling: false }),
    });
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const data = await detail(scanId);

    const eu = data.reportData.complianceMatrix.find((j) => j.jurisdictionId === 'EU');
    expect(eu?.reviewStatus).toBe('pass');
    const criteria = (eu?.violations ?? []).map((v) => v.wcagCriterion);
    expect(criteria).not.toContain('1.1.1');
    expect(criteria).not.toContain('1.4.3');

    const reg = data.reportData.regulationMatrix.find((r) => r.regulationId === 'TEST-REG');
    expect(reg?.status).toBe('partial');
    expect((reg?.violatedRequirements ?? []).map((v) => v.wcagCriterion)).toEqual(['2.4.4']);
    assertDismissedAbsent(JSON.stringify(data), 'both');
  });

  it('report detail keeps a criterion failing while one same-code sibling remains', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const data = await detail();

    const eu = data.reportData.complianceMatrix.find((j) => j.jurisdictionId === 'EU');
    const criteria = (eu?.violations ?? []).map((v) => v.wcagCriterion);
    expect(criteria).toContain('1.4.3');
    expect(criteria).not.toContain('1.1.1');
    expect(eu?.reviewStatus).toBe('fail');
    const whole = JSON.stringify(data);
    assertDismissedAbsent(whole, 'both');
    assertSiblingPresent(whole);
    expect(whole).not.toContain(SEL_ALT.replace(/^#/, ''));
  });

  it("report detail of org B is filtered by org B's dismissals for a global admin viewer", async () => {
    await dismiss(DISMISS_PARTIAL); // Fabrikam's dismissal
    // Northwind already dismisses both matches on the same URL (foreign seed) and the
    // viewer is a global admin sitting in the Northwind org context.
    const server = await makeServer(ctx, async (s) => {
      s.addHook('preHandler', async (request) => {
        request.user = {
          id: 'user-northwind-admin',
          username: 'northwind-admin',
          role: 'admin',
          currentOrgId: ctx.orgs.northwindOrgId,
        };
      });
      await reportRoutes(s, ctx.storage, () => null);
    });
    try {
      const res = await server.inject({ method: 'GET', url: `/reports/${ctx.scanId}` });
      expect(res.statusCode).toBe(200);
      const body = (JSON.parse(res.body) as { data: DetailView }).data;
      // Fabrikam's report: Fabrikam's dismissal applies (selector gone) ...
      assertDismissedAbsent(JSON.stringify(body), 'partial');
      // ... and Northwind's dismissal of the 1.1.1 finding on the same URL does NOT.
      const whole = JSON.stringify(body);
      expect(whole).toContain(SEL_ALT.replace(/^#/, ''));
      assertSiblingPresent(whole);
    } finally {
      await server.close();
    }
  });
});

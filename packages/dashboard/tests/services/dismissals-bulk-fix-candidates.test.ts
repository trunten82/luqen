/**
 * Phase 88 Plan 09: bulk-fix candidates skip a site whose only findings for the criterion are
 * dismissed (FP-11, D-06). computeBulkFixCandidates is shared by REST bulk-fixes and the MCP
 * dashboard_queue_bulk_fix tool, so one service-level test covers both entry points.
 *
 * Real SQLite store; the Plan 03 fixture scan is annotated (wcagCriterion on each issue) so the
 * criterion match is able to react to a dismissal. Foreign dismissals seeded by createApiContext
 * (Northwind on the Fabrikam URL, Fabrikam on another site) must never apply to the Fabrikam scan.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { apiShapedReport, createApiContext } from '../golden/drivers/api-drivers.js';
import type { SurfaceContext } from '../golden/drivers/render-drivers.js';
import { computeBulkFixCandidates } from '../../src/services/bulk-fix-candidates.js';
import {
  CODE_LINK,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_SITE,
  SEL_LINK,
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

async function candidates(criterion: string, teamId: string | null = null) {
  return computeBulkFixCandidates(ctx.storage, {
    id: 'bulk-fix-dismissals',
    orgId: ctx.orgs.fabrikamOrgId,
    teamId,
    criterion,
  });
}

describe('bulk-fix candidates apply the scan org active dismissals', () => {
  it('bulk-fix candidates skip a site whose only issues for the criterion are dismissed', async () => {
    // 1.1.1 has a single finding on the site (DISMISS_WHOLE): dismissing it leaves nothing to fix.
    expect((await candidates('1.1.1')).map((c) => c.site_url)).toEqual([FABRIKAM_SITE]);
    await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match: DISMISS_WHOLE });
    expect(await candidates('1.1.1')).toEqual([]);
  });

  it('bulk-fix candidates keep a site with a surviving issue for the criterion', async () => {
    // 1.4.3 keeps failing through the sibling after DISMISS_PARTIAL.
    await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    expect((await candidates('1.4.3')).map((c) => c.site_url)).toEqual([FABRIKAM_SITE]);
  });

  it("bulk-fix candidates apply each org's own dismissals", async () => {
    // Team home org Fabrikam, Northwind linked. Both orgs have a latest scan of the SAME url that
    // carries the link finding (2.4.4). Only Fabrikam dismisses it (the foreign Northwind dismissals
    // seeded by the fixture cover the contrast and alt matches only). Fabrikam's scan is evaluated
    // first and skipped; Northwind's is evaluated against Northwind's own set and is the candidate.
    const team = await ctx.storage.teams.createTeam({ name: 'Fabrikam team', description: '', orgId: ctx.orgs.fabrikamOrgId });
    await ctx.storage.teamOrgLinks.link(team.id, ctx.orgs.northwindOrgId, 'fabrikam-seed');
    const northwindScanId = await seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.northwindOrgId,
      location: 'db',
      id: 'scan-northwind-bulk-fix',
      report: apiShapedReport(FABRIKAM_SITE),
      createdAt: '2026-10-02T10:00:00.000Z',
      completedAt: '2026-10-02T10:05:00.000Z',
    });

    const before = await candidates('2.4.4', team.id);
    expect(before.map((c) => c.site_url)).toEqual([FABRIKAM_SITE]); // de-duplicated by site url, Fabrikam first
    expect(before[0]?.site_id).toBe(ctx.scanId);

    await seedSurfaceDismissal(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      match: { code: CODE_LINK, selector: SEL_LINK },
    });
    const after = await candidates('2.4.4', team.id);
    expect(after.map((c) => c.site_id)).toEqual([northwindScanId]);
  });
});

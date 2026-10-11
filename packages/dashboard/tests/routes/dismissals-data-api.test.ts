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

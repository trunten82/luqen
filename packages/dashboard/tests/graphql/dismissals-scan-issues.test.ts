/**
 * Phase 88 Plan 08: GraphQL scanIssues applies the scan org active dismissals (D-06).
 *
 * Drives the REAL resolver (Plan 03 driver) over the real SQLite store with the FS
 * report read, and asserts at string level over the whole result that the dismissed
 * finding is gone while its same-code sibling and the unrelated findings remain.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { createApiContext, driveGraphqlScanIssues } from '../golden/drivers/api-drivers.js';
import type { SurfaceContext } from '../golden/drivers/render-drivers.js';
import {
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
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

describe('GraphQL scanIssues applies the scan org active dismissals', () => {
  it('GraphQL scanIssues omits a dismissed finding', async () => {
    await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    const out = (await driveGraphqlScanIssues(ctx)) as {
      all: { nodes: ReadonlyArray<{ selector: string }>; totalCount: number };
    };

    const selectors = out.all.nodes.map((n) => n.selector);
    expect(selectors).not.toContain(SEL_DISMISSED);
    expect(selectors).toContain(SEL_SIBLING);
    expect(out.all.totalCount).toBe(AFTER_PARTIAL.total);
    const text = JSON.stringify(out);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });
});

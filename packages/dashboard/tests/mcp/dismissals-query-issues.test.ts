/**
 * Phase 88 Plan 17 (W2, FP-11, SC1): dashboard_query_issues drops dismissed findings for
 * EVERY report shape it actually reads. Those shapes (`{ issues }` and `{ results: [{ issues }] }`)
 * are not the `pages` shape applyDismissals filters, so the tool filters its own extracted list.
 *
 * Driven through the REAL MCP route over the real SQLite store (Plan 03 drivers). Foreign
 * dismissals (Northwind on the same URL, Fabrikam on another site) are seeded by
 * createApiContext and must never apply.
 *
 * Pre-existing, NOT fixed here (SC5): on the dashboard's own `pages` shape the tool returns [].
 * Its pages-shape golden stays identical; the last test pins that wiring dismissals does not
 * change it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import {
  apiShapedReport,
  createApiContext,
  driveMcpQueryIssues,
  openMcp,
} from '../golden/drivers/api-drivers.js';
import type { SurfaceContext } from '../golden/drivers/render-drivers.js';
import {
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  openSurfaceStore,
  seedSurfaceDismissal,
  seedSurfaceOrgs,
  seedSurfaceScan,
  SEL_ALT,
  SEL_DISMISSED,
  SEL_SIBLING,
  assertDismissedAbsent,
  assertSiblingPresent,
  FIXED_SCAN_ID,
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

interface QueryOut {
  readonly data: ReadonlyArray<{ readonly code: string; readonly selector: string }>;
  readonly meta: { readonly total: number; readonly returned: number };
}

/** The flat `{ issues }` shape: every finding of the annotated report, flattened. */
function flatIssuesReport(): Record<string, unknown> {
  const { pages, ...rest } = apiShapedReport();
  const issues = (pages as ReadonlyArray<{ issues: ReadonlyArray<unknown> }>).flatMap((p) => p.issues);
  return { ...rest, issues };
}

async function queryScan(scanId: string): Promise<QueryOut> {
  const mcp = await openMcp(ctx);
  try {
    return (await mcp.callTool('dashboard_query_issues', { scanId })) as QueryOut;
  } finally {
    await mcp.close();
  }
}

describe('MCP dashboard_query_issues applies the scan org active dismissals', () => {
  it('MCP query_issues omits a dismissed finding from the results shape', async () => {
    await dismiss(DISMISS_PARTIAL);
    const out = (await driveMcpQueryIssues(ctx, 'results')) as QueryOut;

    const selectors = out.data.map((i) => i.selector);
    expect(selectors).not.toContain(SEL_DISMISSED);
    expect(selectors).toContain(SEL_SIBLING);
    // 8 raw occurrences, 3 dismissed (one per page); total counts only what survives.
    expect(out.meta).toEqual({ total: 5, returned: 5 });
    const text = JSON.stringify(out);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });

  it('MCP query_issues omits a dismissed finding from the flat issues shape', async () => {
    const scanId = await seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      location: 'db',
      id: 'scan-fabrikam-flat-0004',
      report: flatIssuesReport(),
      createdAt: '2026-07-01T10:00:00.000Z',
      completedAt: '2026-07-01T10:05:00.000Z',
    });
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);

    const out = await queryScan(scanId);

    const selectors = out.data.map((i) => i.selector);
    expect(selectors).not.toContain(SEL_DISMISSED);
    expect(selectors).not.toContain(SEL_ALT);
    expect(selectors).toContain(SEL_SIBLING);
    expect(out.meta).toEqual({ total: 4, returned: 4 });
    assertDismissedAbsent(JSON.stringify(out), 'both');
  });

  it('MCP query_issues applies the dismissal before the type filter and the limit', async () => {
    await dismiss(DISMISS_PARTIAL);
    await driveMcpQueryIssues(ctx, 'results'); // seeds the results-shape scan
    const mcp = await openMcp(ctx);
    try {
      const out = (await mcp.callTool('dashboard_query_issues', {
        scanId: 'scan-fabrikam-golden-results',
        type: 'error',
        limit: 1,
      })) as QueryOut;
      // 5 errors raw, 3 dismissed, so 2 errors remain; total is the pre-limit count after filtering.
      expect(out.meta).toEqual({ total: 2, returned: 1 });
    } finally {
      await mcp.close();
    }
  });

  it('MCP query_issues is unchanged when the site has no active dismissal', async () => {
    // ctx holds foreign dismissals only. The control store holds none at all.
    const withForeign = JSON.stringify(await driveMcpQueryIssues(ctx, 'results'));

    const store = await openSurfaceStore();
    try {
      const orgs = await seedSurfaceOrgs(store.storage);
      const scanId = await seedSurfaceScan(store.storage, {
        orgId: orgs.fabrikamOrgId,
        location: 'both',
        reportsDir: store.reportsDir,
        id: FIXED_SCAN_ID,
        report: apiShapedReport(),
      });
      const bare: SurfaceContext = {
        ...ctx,
        store,
        storage: store.storage,
        orgs,
        scanId,
        cleanup: () => Promise.resolve(),
      };
      const withNone = JSON.stringify(await driveMcpQueryIssues(bare, 'results'));
      expect(withForeign).toBe(withNone);
    } finally {
      await store.cleanup();
    }
  });

  it('MCP query_issues still returns an empty list on the dashboard pages shape (pre-existing, not fixed)', async () => {
    await dismiss(DISMISS_PARTIAL);
    const out = await driveMcpQueryIssues(ctx, 'pages');

    expect(out).toEqual({ data: [], meta: { total: 0, returned: 0 } });
  });
});

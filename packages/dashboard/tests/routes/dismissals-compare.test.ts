/**
 * Phase 88 Plan 09: compare (/reports/compare) applies each scan's own dismissals (D-06).
 *
 * Each test seeds its own dismissal, drives the REAL compare route over the real
 * SQLite store and FS report files, and asserts at string level over the WHOLE view
 * data that the dismissed finding is gone — in the diff lists AND in the scan rows'
 * raw report blobs — while its same-code sibling and the unrelated findings remain.
 * Foreign dismissals (Northwind on the same URL, Fabrikam on another site) are seeded
 * by createApiContext and must never apply.
 */
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { registerSession } from '../../src/auth/session.js';
import { compareRoutes } from '../../src/routes/compare.js';
import { countIssues } from '../../src/services/count-issues.js';
import { apiShapedReport, createApiContext } from '../golden/drivers/api-drivers.js';
import type { SurfaceContext } from '../golden/drivers/render-drivers.js';
import {
  CODE_LINK,
  DISMISS_PARTIAL,
  FABRIKAM_SITE,
  REASON_TOKEN,
  SEL_DISMISSED,
  SEL_LINK,
  SEL_SIBLING,
  assertDismissedAbsent,
  assertSiblingPresent,
  seedSurfaceDismissal,
  seedSurfaceScan,
} from '../helpers/dismissal-surface-fixture.js';

const DISMISS_LINK = { code: CODE_LINK, selector: SEL_LINK } as const;
const OLDER_ID = 'scan-fabrikam-compare-older';
const NEWER_ID = 'scan-fabrikam-compare-newer';
const OLDER_AT = '2026-09-01T10:00:00.000Z';
const NEWER_AT = '2026-10-01T10:00:00.000Z';

let ctx: SurfaceContext;

beforeEach(async () => {
  ctx = await createApiContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dismiss(): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
}

interface Pages {
  pages: Array<{ issues: Array<{ selector: string }>; issueCount: number }>;
  summary: { totalIssues: number; byLevel: { error: number; warning: number; notice: number } };
  [key: string]: unknown;
}

/** The annotated fixture report without any occurrence of `selector` (counts kept consistent). */
function withoutSelector(selector: string): Record<string, unknown> {
  const report = apiShapedReport(FABRIKAM_SITE) as unknown as Pages;
  const pages = report.pages.map((p) => {
    const issues = p.issues.filter((i) => i.selector !== selector);
    return { ...p, issues, issueCount: issues.length };
  });
  const counts = countIssues({ pages });
  // A scan that never saw the finding carries no annotated copy of it either.
  const compliance = report['compliance'] as { annotatedIssues: Array<{ originalIssue: { selector: string } }> };
  return {
    ...report,
    pages,
    compliance: {
      ...compliance,
      annotatedIssues: compliance.annotatedIssues.filter((a) => a.originalIssue.selector !== selector),
    },
    summary: {
      ...report.summary,
      totalIssues: counts.total,
      byLevel: { error: counts.errors, warning: counts.warnings, notice: counts.notices },
    },
  };
}

async function seed(
  id: string,
  orgId: string,
  createdAt: string,
  report: Record<string, unknown>,
): Promise<void> {
  await seedSurfaceScan(ctx.storage, {
    orgId,
    location: 'both',
    reportsDir: ctx.store.reportsDir,
    id,
    report,
    createdAt,
    completedAt: createdAt,
  });
}

async function makeCompareServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await registerSession(server, 'test-session-secret-at-least-32b');
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200)
      .header('content-type', 'application/json')
      .send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'user-fabrikam-admin',
      username: 'fabrikam-admin',
      role: 'admin',
      currentOrgId: ctx.orgs.fabrikamOrgId,
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(['reports.compare', 'reports.view']);
  });
  await compareRoutes(server, ctx.storage);
  await server.ready();
  return server;
}

interface CompareView {
  readonly scanA: { jsonReport?: string };
  readonly scanB: { jsonReport?: string };
  readonly diff: {
    readonly added: ReadonlyArray<{ selector: string }>;
    readonly removed: ReadonlyArray<{ selector: string }>;
    readonly unchanged: ReadonlyArray<{ selector: string }>;
  };
}

async function compare(a: string, b: string): Promise<{ text: string; view: CompareView }> {
  const server = await makeCompareServer();
  try {
    const response = await server.inject({ method: 'GET', url: `/reports/compare?a=${a}&b=${b}` });
    expect(response.statusCode).toBe(200);
    return { text: response.body, view: (JSON.parse(response.body) as { data: CompareView }).data };
  } finally {
    await server.close();
  }
}

const selectors = (list: ReadonlyArray<{ selector: string }>): string[] => list.map((i) => i.selector);

describe('compare applies the active dismissals of each scan', () => {
  it('compare ignores a finding dismissed on the site in both scans', async () => {
    await seed(OLDER_ID, ctx.orgs.fabrikamOrgId, OLDER_AT, apiShapedReport(FABRIKAM_SITE, { withSibling: false }));
    await seed(NEWER_ID, ctx.orgs.fabrikamOrgId, NEWER_AT, apiShapedReport(FABRIKAM_SITE));
    await dismiss();
    const { text, view } = await compare(OLDER_ID, NEWER_ID);

    for (const list of [view.diff.added, view.diff.removed, view.diff.unchanged]) {
      expect(selectors(list)).not.toContain(SEL_DISMISSED);
    }
    // The sibling exists only in the newer scan: it is the one new finding.
    expect(selectors(view.diff.added)).toContain(SEL_SIBLING);
    // Whole output, including both scan rows' raw report blobs.
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });

  it('compare does not report a dismissed finding as fixed', async () => {
    await seed(OLDER_ID, ctx.orgs.fabrikamOrgId, OLDER_AT, apiShapedReport(FABRIKAM_SITE));
    await seed(NEWER_ID, ctx.orgs.fabrikamOrgId, NEWER_AT, withoutSelector(SEL_DISMISSED));
    await dismiss();
    const { text, view } = await compare(OLDER_ID, NEWER_ID);

    expect(selectors(view.diff.removed)).not.toContain(SEL_DISMISSED);
    expect(selectors(view.diff.unchanged)).toContain(SEL_SIBLING);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });

  it('compare does not report a dismissed finding as new', async () => {
    await seed(OLDER_ID, ctx.orgs.fabrikamOrgId, OLDER_AT, withoutSelector(SEL_DISMISSED));
    await seed(NEWER_ID, ctx.orgs.fabrikamOrgId, NEWER_AT, apiShapedReport(FABRIKAM_SITE));
    await dismiss();
    const { text, view } = await compare(OLDER_ID, NEWER_ID);

    expect(selectors(view.diff.added)).not.toContain(SEL_DISMISSED);
    expect(selectors(view.diff.unchanged)).toContain(SEL_SIBLING);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });

  it("compare applies each scan's own org dismissals", async () => {
    // A Fabrikam scan (A) and a Northwind scan (B) of the SAME site URL, both carrying the link
    // finding. Only Fabrikam dismissed it (createApiContext's foreign Northwind dismissals cover
    // the contrast and alt matches, never the link match), so it must vanish from side A only and
    // stay visible as a finding that exists on side B alone.
    await seed(OLDER_ID, ctx.orgs.fabrikamOrgId, OLDER_AT, apiShapedReport(FABRIKAM_SITE));
    await seed(NEWER_ID, ctx.orgs.northwindOrgId, NEWER_AT, apiShapedReport(FABRIKAM_SITE));
    await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match: DISMISS_LINK });
    const { text, view } = await compare(OLDER_ID, NEWER_ID);

    expect(selectors(view.diff.added)).toContain(SEL_LINK);
    expect(selectors(view.diff.unchanged)).not.toContain(SEL_LINK);
    expect(selectors(view.diff.removed)).not.toContain(SEL_LINK);
    // Each scan row's raw blob follows its OWN org's judgement.
    expect(view.scanA.jsonReport ?? '').not.toContain(SEL_LINK.replace(/^#/, ''));
    expect(view.scanB.jsonReport ?? '').toContain(SEL_LINK.replace(/^#/, ''));
    expect(text).not.toContain(REASON_TOKEN);
  });
});

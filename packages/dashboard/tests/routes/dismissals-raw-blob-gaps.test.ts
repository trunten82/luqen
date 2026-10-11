/**
 * Phase 88 Plan 19: two raw-blob leaks found during execution and covered by no earlier plan.
 *
 *  - REST GET /api/v1/scans (the LIST) maps each row through toPublicScan, which keeps the raw
 *    `jsonReport`; a dismissed selector therefore came back in the list body (88-08 finding 1).
 *  - The repos fixes view's noReport branches spread the scan row, DB `jsonReport` included
 *    (88-09 finding 2).
 *
 * Every assertion is string-level over the WHOLE response. Foreign dismissals (Northwind on the
 * same URL, Fabrikam on another site) are seeded by createApiContext and must never apply.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { createApiContext, driveReposFixesView, makeApiServer, apiShapedReport } from '../golden/drivers/api-drivers.js';
import type { SurfaceContext } from '../golden/drivers/render-drivers.js';
import { dataApiRoutes } from '../../src/routes/api/data.js';
import {
  DISMISS_PARTIAL,
  FABRIKAM_SITE,
  SEL_DISMISSED,
  SEL_SIBLING,
  assertDismissedAbsent,
  assertSiblingPresent,
  seedSurfaceDismissal,
  seedSurfaceScan,
} from '../helpers/dismissal-surface-fixture.js';

/** A Fabrikam site that has no dismissal of its own and is not one of the foreign-dismissal sites. */
const CAREERS_SITE = 'https://fabrikam.example/careers/';

let ctx: SurfaceContext;

beforeEach(async () => {
  ctx = await createApiContext();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ctx.cleanup();
});

async function dismiss(): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
}

interface ListRow {
  readonly id: string;
  readonly siteUrl: string;
  readonly jsonReport?: string;
}

async function listScans(): Promise<{ status: number; text: string; rows: readonly ListRow[] }> {
  const server = await makeApiServer(ctx, (s) => dataApiRoutes(s, ctx.storage));
  try {
    const response = await server.inject({ method: 'GET', url: '/api/v1/scans' });
    const parsed = response.json() as { data: readonly ListRow[] };
    return { status: response.statusCode, text: response.body, rows: parsed.data };
  } finally {
    await server.close();
  }
}

/** A second completed Fabrikam scan of the SAME site (DB copy only). */
async function seedSameSiteScan(): Promise<string> {
  return seedSurfaceScan(ctx.storage, {
    orgId: ctx.orgs.fabrikamOrgId,
    location: 'db',
    id: 'scan-fabrikam-samesite-0002',
    report: apiShapedReport(),
    createdAt: '2026-10-02T10:00:00.000Z',
    completedAt: '2026-10-02T10:05:00.000Z',
  });
}

/** A completed Fabrikam scan of a site with no dismissal; its blob carries the dismissed selector text. */
async function seedUnaffectedSiteScan(): Promise<string> {
  return seedSurfaceScan(ctx.storage, {
    orgId: ctx.orgs.fabrikamOrgId,
    siteUrl: CAREERS_SITE,
    location: 'db',
    id: 'scan-fabrikam-careers-0003',
    report: apiShapedReport(CAREERS_SITE),
    createdAt: '2026-10-03T10:00:00.000Z',
    completedAt: '2026-10-03T10:05:00.000Z',
  });
}

describe('REST GET /api/v1/scans (list) applies the scan org active dismissals', () => {
  it('REST scan list carries no dismissed finding anywhere in the whole response', async () => {
    await dismiss();
    await seedSameSiteScan();
    const out = await listScans();

    expect(out.status).toBe(200);
    expect(out.rows).toHaveLength(2);
    // API shape unchanged: every row still carries its jsonReport string.
    for (const row of out.rows) expect(typeof row.jsonReport).toBe('string');
    assertDismissedAbsent(out.text, 'partial');
    assertSiblingPresent(out.text);
  });

  it('REST scan list leaves a row of a site with no dismissal exactly as stored', async () => {
    await dismiss();
    const careersId = await seedUnaffectedSiteScan();
    const out = await listScans();

    const careers = out.rows.find((r) => r.id === careersId);
    const stored = await ctx.storage.scans.getScan(careersId);
    expect(careers?.jsonReport).toBe(stored?.jsonReport);
    // The unaffected row legitimately still carries the selector; the dismissed site's row must not.
    expect(careers?.jsonReport).toContain(SEL_DISMISSED.replace(/^#/, ''));
    const main = out.rows.find((r) => r.id === ctx.scanId);
    expect(main?.jsonReport).not.toContain(SEL_DISMISSED.replace(/^#/, ''));
    expect(main?.jsonReport).toContain(SEL_SIBLING.replace(/^#/, ''));
  });

  it('REST scan list looks up dismissals once per org and site, not once per row', async () => {
    await dismiss();
    await seedSameSiteScan();
    await seedUnaffectedSiteScan();
    const repo = ctx.storage.issueDismissals;
    if (repo === undefined) throw new Error('fixture storage has no issueDismissals repository');
    const spy = vi.spyOn(repo, 'listActiveForSite');

    const out = await listScans();

    expect(out.rows).toHaveLength(3);
    // Three rows, two distinct sites (the main site twice).
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('REST scan list is byte-identical to the stored rows when only foreign dismissals exist', async () => {
    await seedSameSiteScan();
    const out = await listScans();

    // Independent expectation: the rows exactly as the repository stores them, minus the
    // fields toPublicScan has always stripped. No dismissal applies, so nothing else may differ.
    const ids = out.rows.map((r) => r.id);
    const expectedRows = [];
    for (const id of ids) {
      const stored = await ctx.storage.scans.getScan(id);
      if (stored === null) throw new Error(`missing ${id}`);
      const { jsonReportPath: _p, error: _e, createdBy: _c, ...rest } = stored as typeof stored & Record<string, unknown>;
      expectedRows.push(rest);
    }
    const raw = out.rows.map((r) => r.jsonReport).join('');
    expect(raw).toContain(SEL_DISMISSED.replace(/^#/, ''));
    expect(JSON.parse(out.text)).toEqual({ data: expectedRows, total: expectedRows.length });
    expect(out.text).toBe(JSON.stringify({ data: expectedRows, total: expectedRows.length }));
  });
});

describe('repos fixes view noReport branches never carry a dismissed occurrence', () => {
  async function dbOnlyScan(): Promise<string> {
    return seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      location: 'db',
      id: 'scan-fabrikam-dbonly-0004',
      report: apiShapedReport(),
      createdAt: '2026-10-04T10:00:00.000Z',
      completedAt: '2026-10-04T10:05:00.000Z',
    });
  }

  interface View {
    readonly status: number;
    readonly body: { readonly data: { readonly noReport: boolean; readonly scan: { readonly jsonReport?: string } } };
  }

  it('repos fixes view noReport carries no dismissed finding when only the DB copy of the report exists', async () => {
    const id = await dbOnlyScan();
    await dismiss();
    const out = (await driveReposFixesView(ctx, id)) as View;

    expect(out.status).toBe(200);
    expect(out.body.data.noReport).toBe(true);
    const text = JSON.stringify(out);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });

  it('repos fixes view noReport is unchanged when no dismissal applies', async () => {
    const id = await dbOnlyScan();
    const out = (await driveReposFixesView(ctx, id)) as View;
    const stored = await ctx.storage.scans.getScan(id);

    expect(out.body.data.noReport).toBe(true);
    expect(out.body.data.scan.jsonReport).toBe(stored?.jsonReport);
    expect(JSON.stringify(out)).toContain(SEL_DISMISSED.replace(/^#/, ''));
  });

  it('repos fixes view noReport carries no dismissed finding when the stored report file is unreadable', async () => {
    // The report FILE exists but is not JSON; the DB copy is still a valid report.
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const id = 'scan-fabrikam-badfile-0005';
    await seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      location: 'both',
      reportsDir: ctx.store.reportsDir,
      id,
      report: apiShapedReport(FABRIKAM_SITE),
      createdAt: '2026-10-05T10:00:00.000Z',
      completedAt: '2026-10-05T10:05:00.000Z',
    });
    writeFileSync(join(ctx.store.reportsDir, `report-${id}.json`), '{ not json', 'utf-8');
    await dismiss();
    const out = (await driveReposFixesView(ctx, id)) as View;

    expect(out.body.data.noReport).toBe(true);
    const text = JSON.stringify(out);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
  });
});

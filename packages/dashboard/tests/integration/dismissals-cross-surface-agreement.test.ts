/**
 * Phase 88 Plan 18 (SC3, FP-08): cross-surface agreement.
 *
 * ONE dismissal is marked through the REAL mark route (so Plan 11's recompute writes the stored count
 * columns). Every surface that reads those columns, or mixes them with report JSON, is then driven through
 * its REAL handler or service and must agree with the REPORT AS RENDERED for the same scan
 * (`driveReportDetail(...).reportData.summary.byLevel`, filtered at read time by the loader).
 *
 * Expected scores/bands are computed with the surface's OWN exported function from the rendered counts,
 * never by a formula written in this file (T-88-18-03).
 *
 * Public repo: Fabrikam / Northwind placeholders and `.example` hosts only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';

process.env['TZ'] ??= 'UTC';

import { registerSession } from '../../src/auth/session.js';
import { countIssues } from '../../src/services/count-issues.js';
import { deriveExposure } from '../../src/services/legal-exposure.js';
import { homeRoutes } from '../../src/routes/home.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { buildRouteServer } from '../helpers/issue-dismissal-route-harness.js';
import { driveReportDetail, type SurfaceContext } from '../golden/drivers/render-drivers.js';
import {
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  FABRIKAM_SITE,
  FABRIKAM_SITE_VARIANT,
  FIXED_COMPLETED_AT,
  FIXED_CREATED_AT,
  RAW_COUNTS,
  openSurfaceStore,
  seedSurfaceOrgs,
  seedSurfaceScan,
  surfaceReport,
  type ExpectedCounts,
  type SurfaceOrgs,
  type SurfaceStore,
} from '../helpers/dismissal-surface-fixture.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

/** Older Fabrikam scan of the same site, stored under the URL variant (same toSiteKey). */
const OLD_CREATED_AT = '2026-09-01T10:00:00.000Z';
const OLD_COMPLETED_AT = '2026-09-01T10:05:00.000Z';
const NORTHWIND_CREATED_AT = '2026-09-15T10:00:00.000Z';
/** A confirmed_violations sentinel on the OLD scan: nothing in Phase 88 may change it (D-04 Case A). */
const OLD_CONFIRMED_SENTINEL = 7;

interface Match {
  readonly code: string;
  readonly selector: string;
}

interface World {
  readonly store: SurfaceStore;
  readonly orgs: SurfaceOrgs;
  readonly ctx: SurfaceContext;
  /** Newer Fabrikam scan of FABRIKAM_SITE (the scan `rendered` is read from). */
  readonly newId: string;
  /** Older Fabrikam scan stored under FABRIKAM_SITE_VARIANT. */
  readonly oldId: string;
  /** Another org's scan of the SAME URL. */
  readonly northwindId: string;
  cleanup(): Promise<void>;
}

const open: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()!();
});

function track<T extends { cleanup(): Promise<void> }>(w: T): T {
  open.push(() => w.cleanup());
  return w;
}

interface WorldOptions {
  readonly withSibling?: boolean;
  readonly matches?: readonly Match[];
}

/** One shared setup (factory, per test): real SQLite, Fabrikam + Northwind, three completed scans, marks via the route. */
async function buildWorld(opts: WorldOptions = {}): Promise<World> {
  const withSibling = opts.withSibling ?? true;
  const matches = opts.matches ?? [DISMISS_PARTIAL];
  const store = await openSurfaceStore();
  const orgs = await seedSurfaceOrgs(store.storage);
  const base = { location: 'both' as const, reportsDir: store.reportsDir };
  const oldId = await seedSurfaceScan(store.storage, {
    ...base,
    orgId: orgs.fabrikamOrgId,
    siteUrl: FABRIKAM_SITE_VARIANT,
    report: surfaceReport(FABRIKAM_SITE_VARIANT, { withSibling }),
    createdAt: OLD_CREATED_AT,
    completedAt: OLD_COMPLETED_AT,
  });
  await store.storage.scans.updateScan(oldId, { confirmedViolations: OLD_CONFIRMED_SENTINEL });
  const newId = await seedSurfaceScan(store.storage, {
    ...base,
    orgId: orgs.fabrikamOrgId,
    siteUrl: FABRIKAM_SITE,
    report: surfaceReport(FABRIKAM_SITE, { withSibling }),
    createdAt: FIXED_CREATED_AT,
    completedAt: FIXED_COMPLETED_AT,
  });
  const northwindId = await seedSurfaceScan(store.storage, {
    ...base,
    orgId: orgs.northwindOrgId,
    siteUrl: FABRIKAM_SITE,
    report: surfaceReport(FABRIKAM_SITE, { withSibling }),
    createdAt: NORTHWIND_CREATED_AT,
    completedAt: NORTHWIND_CREATED_AT,
  });
  const ctx: SurfaceContext = {
    store,
    storage: store.storage,
    orgs,
    scanId: newId,
    literals: () => ({}),
    cleanup: () => store.cleanup(),
  };
  const world: World = { store, orgs, ctx, newId, oldId, northwindId, cleanup: () => store.cleanup() };
  for (const match of matches) await markThroughRoute(world, match);
  return track(world);
}

/** The REAL mark route as a global admin (the permission is dark, as Phase 87's tests inject it). */
async function markThroughRoute(world: World, match: Match): Promise<void> {
  const server = await buildRouteServer(world.store.storage, {
    user: { role: 'admin' },
    permissions: ['issues.dismiss', 'reports.view'],
  });
  try {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/scans/${world.newId}/dismissals`,
      payload: { ...match, reason: 'Hidden promo copy' },
    });
    if (res.statusCode !== 201) throw new Error(`mark route answered ${res.statusCode}: ${res.body}`);
    const body = res.json() as { recomputed_scans: number; failed_scans: number; recompute_complete: boolean };
    // Fabrikam's two scans only; Northwind's scan of the same URL is not part of the recompute.
    expect(body).toMatchObject({ recomputed_scans: 2, failed_scans: 0, recompute_complete: true });
  } finally {
    await server.close();
  }
}

// ── Reading the world ────────────────────────────────────────────────────────
interface RenderedView {
  readonly reportData: {
    readonly summary: { readonly totalIssues: number; readonly byLevel: { error: number; warning: number; notice: number } };
  };
  readonly exposure?: Record<string, unknown>;
}

/** The report as a user sees it: counts from the rendered report-detail view data. */
async function renderedCounts(world: World, scanId: string): Promise<ExpectedCounts> {
  const view = (await driveReportDetail(world.ctx, scanId)) as RenderedView;
  const { byLevel, totalIssues } = view.reportData.summary;
  return { errors: byLevel.error, warnings: byLevel.warning, notices: byLevel.notice, total: totalIssues };
}

/** Fastify with the production-shaped plumbing, a JSON view stub and an injected Fabrikam identity. */
async function serverFor(
  world: World,
  register: (server: FastifyInstance) => Promise<void>,
  identity: { readonly role: string; readonly permissions: readonly string[] } = { role: 'user', permissions: ['reports.view'] },
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'user-fabrikam',
      username: 'fabrikam-user',
      role: identity.role,
      currentOrgId: world.orgs.fabrikamOrgId,
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(identity.permissions);
  });
  await register(server);
  await server.ready();
  open.push(() => server.close());
  return server;
}

async function viewData<T>(server: FastifyInstance, url: string): Promise<T> {
  const res = await server.inject({ method: 'GET', url });
  if (res.statusCode !== 200) throw new Error(`GET ${url} answered ${res.statusCode}`);
  return (JSON.parse(res.body) as { data: T }).data;
}

async function columnsOf(world: World, scanId: string): Promise<ExpectedCounts> {
  const scan = await world.store.storage.scans.getScan(scanId);
  if (scan === null) throw new Error('scan vanished');
  return { errors: scan.errors ?? -1, warnings: scan.warnings ?? -1, notices: scan.notices ?? -1, total: scan.totalIssues ?? -1 };
}

/** A surface's counts, in the shape of the rendered report, for a plain equality assertion. */
function asCounts(row: { errors: unknown; warnings: unknown; notices: unknown; totalIssues: unknown }): ExpectedCounts {
  return {
    errors: Number(row.errors),
    warnings: Number(row.warnings),
    notices: Number(row.notices),
    total: Number(row.totalIssues),
  };
}

// ── Tracer: the real mark makes the first column-reading surfaces agree ──────
describe('cross-surface agreement after a real mark (SC3, FP-08)', () => {
  it('cross-surface: home agrees with the rendered report', async () => {
    const world = await buildWorld();
    const renderedNew = await renderedCounts(world, world.newId);
    const renderedOld = await renderedCounts(world, world.oldId);
    expect(renderedNew).toEqual(AFTER_PARTIAL);

    const server = await serverFor(world, (s) => homeRoutes(s, world.store.storage));
    const data = await viewData<{
      stats: { issuesFound: number };
      recentScans: Array<{ id: string; errors: number; warnings: number; notices: number; totalIssues: number }>;
    }>(server, '/home');

    // Per scan (the recent-scans rows are the stored columns) and in aggregate (issuesFound sums them).
    const rowNew = data.recentScans.find((s) => s.id === world.newId)!;
    const rowOld = data.recentScans.find((s) => s.id === world.oldId)!;
    expect(asCounts(rowNew)).toEqual(renderedNew);
    expect(asCounts(rowOld)).toEqual(renderedOld);
    expect(data.stats.issuesFound).toBe(renderedNew.total + renderedOld.total);
  });

  it('cross-surface: reports list agrees with the rendered report', async () => {
    const world = await buildWorld();
    const renderedNew = await renderedCounts(world, world.newId);
    const renderedOld = await renderedCounts(world, world.oldId);

    const server = await serverFor(world, (s) => reportRoutes(s, world.store.storage, () => null));
    const data = await viewData<{
      scans: Array<{ id: string; errors: number; warnings: number; notices: number; totalIssues: number }>;
    }>(server, '/reports');

    expect(asCounts(data.scans.find((s) => s.id === world.newId)!)).toEqual(renderedNew);
    expect(asCounts(data.scans.find((s) => s.id === world.oldId)!)).toEqual(renderedOld);
    expect(data.scans.map((s) => s.id)).not.toContain(world.northwindId);
  });

  it('cross-surface: legal exposure agrees with the rendered report', async () => {
    const world = await buildWorld();
    const rendered = await renderedCounts(world, world.newId);
    const scanRow = (await world.store.storage.scans.getScan(world.newId))!;

    // JSON half: the exposure on /reports/:id reads reportData.summary.byLevel (filtered at read time).
    const view = (await driveReportDetail(world.ctx, world.newId)) as RenderedView;
    // Column half: confirmed_violations is the stored column, untouched by the mark (D-04 Case A).
    const expected = deriveExposure({
      jurisdictions: scanRow.jurisdictions,
      regulations: scanRow.regulations ?? [],
      findings: {
        errors: rendered.errors,
        warnings: rendered.warnings,
        notices: rendered.notices,
        confirmedViolations: scanRow.confirmedViolations ?? 0,
      },
    });
    expect(view.exposure).toMatchObject(JSON.parse(JSON.stringify(expected)) as Record<string, unknown>);

    // The confirmed column is exactly what the scan was seeded with, and the older scan's sentinel
    // survives the mark: nothing in Phase 88 writes it (D-04 Case A). The count columns are NOT read here;
    // this surface takes its counts from the read-time-filtered JSON.
    expect(scanRow.confirmedViolations).toBe(0);
    expect((await world.store.storage.scans.getScan(world.oldId))!.confirmedViolations).toBe(OLD_CONFIRMED_SENTINEL);
  });

  it('raw counts remain recoverable from the stored report after a mark', async () => {
    const world = await buildWorld();
    const stored = await world.store.storage.scans.getReport(world.newId);
    expect(stored).not.toBeNull();
    const raw = countIssues(stored as never);
    expect({ errors: raw.errors, warnings: raw.warnings, notices: raw.notices, total: raw.total }).toEqual(RAW_COUNTS);
  });
});

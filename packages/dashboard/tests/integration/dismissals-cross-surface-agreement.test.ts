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
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import { countIssues } from '../../src/services/count-issues.js';
import { buildDigest, type SiteDelta } from '../../src/services/digest-service.js';
import { deriveExposure } from '../../src/services/legal-exposure.js';
import { resolvers, type GraphQLContext } from '../../src/graphql/resolvers.js';
import { badgeRoutes } from '../../src/routes/badge.js';
import { dataApiRoutes } from '../../src/routes/api/data.js';
import { exportRoutes } from '../../src/routes/api/export.js';
import { fleetRoutes } from '../../src/routes/fleet.js';
import { homeRoutes } from '../../src/routes/home.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { computeOrgScore, computeSiteScore, trendRoutes } from '../../src/routes/trends.js';
import { buildRouteServer } from '../helpers/issue-dismissal-route-harness.js';
import { openMcp } from '../golden/drivers/api-drivers.js';
import { driveReportDetail, type SurfaceContext } from '../golden/drivers/render-drivers.js';
import {
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
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
const SUMMARYLESS_CREATED_AT = '2026-09-20T10:00:00.000Z';
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
  /** A third Fabrikam scan whose stored report has no summary key (only when requested). */
  readonly summarylessId: string | null;
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
  /** Add a third Fabrikam scan of FABRIKAM_SITE whose stored report carries no `summary`. */
  readonly summaryless?: boolean;
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
  let summarylessId: string | null = null;
  if (opts.summaryless === true) {
    const { summary: _dropped, ...withoutSummary } = surfaceReport(FABRIKAM_SITE, { withSibling });
    summarylessId = await seedSurfaceScan(store.storage, {
      ...base,
      orgId: orgs.fabrikamOrgId,
      siteUrl: FABRIKAM_SITE,
      report: withoutSummary,
      createdAt: SUMMARYLESS_CREATED_AT,
      completedAt: SUMMARYLESS_CREATED_AT,
    });
  }
  const ctx: SurfaceContext = {
    store,
    storage: store.storage,
    orgs,
    scanId: newId,
    literals: () => ({}),
    cleanup: () => store.cleanup(),
  };
  const world: World = { store, orgs, ctx, newId, oldId, northwindId, summarylessId, cleanup: () => store.cleanup() };
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
    // The recompute's own response (counts, failures) is Plan 11's route test. It is deliberately NOT asserted
    // here: this file proves the EFFECT on every surface, and a setup that asserted the recompute would turn
    // every test red when the recompute is skipped, hiding which surfaces actually read the columns.
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
describe('cross-surface agreement after a real mark (SC3, FP-08)', { timeout: 30_000 }, () => {
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

// ── The remaining nine surfaces ──────────────────────────────────────────────
interface ScanCounts {
  readonly id: string;
  readonly siteUrl: string;
  readonly createdAt: string;
  readonly rendered: ExpectedCounts;
}

/** (id, url, createdAt, rendered counts) for the world's two Fabrikam scans: new then old. */
async function fabrikamScans(world: World): Promise<readonly [ScanCounts, ScanCounts]> {
  const out: ScanCounts[] = [];
  for (const id of [world.newId, world.oldId]) {
    const row = (await world.store.storage.scans.getScan(id))!;
    out.push({ id, siteUrl: row.siteUrl, createdAt: row.createdAt, rendered: await renderedCounts(world, id) });
  }
  return [out[0]!, out[1]!];
}

describe('cross-surface agreement after a real mark: remaining surfaces', { timeout: 30_000 }, () => {
  it('cross-surface: trends score agrees with the rendered report', async () => {
    const world = await buildWorld();
    const [fresh, older] = await fabrikamScans(world);
    const rowNew = (await world.store.storage.scans.getScan(fresh.id))!;
    const rowOld = (await world.store.storage.scans.getScan(older.id))!;

    const server = await serverFor(world, (s) => trendRoutes(s, world.store.storage));
    const data = await viewData<{
      orgScore: number;
      siteScores: Array<{ siteUrl: string; score: number }>;
      summaryTable: Array<{ siteUrl: string; latestErrors: number; latestWarnings: number; latestNotices: number; latestTotal: number }>;
    }>(server, '/reports/trends');

    // Scores come from the surface's own exported functions, fed the RENDERED counts.
    for (const scan of [fresh, older]) {
      const row = scan === fresh ? rowNew : rowOld;
      const entry = data.siteScores.find((s) => s.siteUrl === scan.siteUrl)!;
      expect(entry.score).toBe(Math.round(computeSiteScore(scan.rendered.errors, row.pagesScanned ?? 0)));
      const summary = data.summaryTable.find((s) => s.siteUrl === scan.siteUrl)!;
      expect({ errors: summary.latestErrors, warnings: summary.latestWarnings, notices: summary.latestNotices, total: summary.latestTotal })
        .toEqual(scan.rendered);
    }
    expect(data.orgScore).toBe(
      computeOrgScore([
        { ...rowNew, errors: fresh.rendered.errors },
        { ...rowOld, errors: older.rendered.errors },
      ]),
    );
  });

  it('cross-surface: badge agrees with the rendered report', async () => {
    // A scan whose ONLY errors are dismissed: the label moves from PARTIAL (raw) to VERIFIED (rendered).
    // With DISMISS_PARTIAL alone the sibling keeps errors > 0 and the label cannot tell raw from filtered.
    const world = await buildWorld({ withSibling: false, matches: [DISMISS_PARTIAL, DISMISS_WHOLE] });
    const rendered = await renderedCounts(world, world.newId);
    expect(rendered.errors).toBe(0);
    const stored = countIssues((await world.store.storage.scans.getReport(world.newId)) as never);
    expect(stored.errors).toBeGreaterThan(0); // the raw basis would say PARTIAL

    const server = await serverFor(world, (s) => badgeRoutes(s, world.store.storage));
    const headers = { host: new URL(FABRIKAM_SITE).host };
    const staticJson = await server.inject({ method: 'GET', url: `/api/v1/badge/${world.newId}.json`, headers });
    expect(staticJson.statusCode).toBe(200);
    expect((staticJson.json() as { status: string }).status).toBe('VERIFIED');

    const staticSvg = await server.inject({ method: 'GET', url: `/api/v1/badge/${world.newId}.svg`, headers });
    expect(staticSvg.body).toContain('VERIFIED');
    expect(staticSvg.body).not.toContain('PARTIAL');

    const badge = await world.store.storage.siteBadges.enable(world.orgs.fabrikamOrgId, FABRIKAM_SITE, 'fabrikam-admin');
    const live = await server.inject({ method: 'GET', url: `/api/v1/badge/live/${badge.id}.json` });
    expect(live.statusCode).toBe(200);
    expect((live.json() as { status: string }).status).toBe('VERIFIED');
  });

  it('cross-surface: fleet agrees with the rendered report', async () => {
    const world = await buildWorld();
    const rendered = await renderedCounts(world, world.newId);
    const scanRow = (await world.store.storage.scans.getScan(world.newId))!;
    await world.store.storage.wpSites.register({
      orgId: world.orgs.fabrikamOrgId,
      oauthClientId: 'client-fabrikam',
      url: FABRIKAM_SITE,
    });

    const server = await serverFor(world, (s) => fleetRoutes(s, world.store.storage));
    const data = await viewData<{
      sites: Array<{ url: string; latestScan: { errors: number; warnings: number; notices: number; totalIssues: number }; exposure: Record<string, unknown> }>;
    }>(server, '/fleet');
    const site = data.sites.find((s) => s.url === FABRIKAM_SITE)!;

    expect(asCounts(site.latestScan)).toEqual(rendered);
    const expected = deriveExposure({
      jurisdictions: scanRow.jurisdictions,
      regulations: scanRow.regulations ?? [],
      findings: { errors: rendered.errors, warnings: rendered.warnings, notices: rendered.notices, confirmedViolations: scanRow.confirmedViolations ?? 0 },
    });
    expect(site.exposure).toMatchObject(JSON.parse(JSON.stringify(expected)) as Record<string, unknown>);
  });

  it('cross-surface: digest agrees with the rendered report', async () => {
    const world = await buildWorld();
    const [fresh, older] = await fabrikamScans(world);
    const digest = await buildDigest(
      world.store.storage,
      { orgId: world.orgs.fabrikamOrgId, siteUrl: null },
      { start: '2026-09-25T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' },
    );

    const check = async (scan: ScanCounts, hasNewScan: boolean): Promise<void> => {
      const delta: SiteDelta = digest.sites.find((s) => s.siteUrl === scan.siteUrl)!;
      const row = (await world.store.storage.scans.getScan(scan.id))!;
      expect(delta.hasNewScan).toBe(hasNewScan);
      expect({ errors: delta.errors, warnings: delta.warnings, notices: delta.notices }).toEqual({
        errors: scan.rendered.errors,
        warnings: scan.rendered.warnings,
        notices: scan.rendered.notices,
      });
      const expected = deriveExposure({
        jurisdictions: row.jurisdictions,
        regulations: row.regulations ?? [],
        findings: {
          errors: scan.rendered.errors,
          warnings: scan.rendered.warnings,
          notices: scan.rendered.notices,
          confirmedViolations: row.confirmedViolations ?? 0,
        },
      });
      expect(delta.currentExposure).toMatchObject(JSON.parse(JSON.stringify(expected)) as Record<string, unknown>);
    };
    await check(fresh, true); // the scan inside the digest period
    await check(older, false); // the older scan, reported as the site's most recent
    // No baseline for FABRIKAM_SITE: the delta is the rendered count itself.
    expect(digest.sites.find((s) => s.siteUrl === fresh.siteUrl)!.errorsDelta).toBe(fresh.rendered.errors);
  });

  it('cross-surface: raw-SQL API agrees with the rendered report', async () => {
    const world = await buildWorld();
    const [fresh, older] = await fabrikamScans(world);
    const server = await serverFor(world, (s) => dataApiRoutes(s, world.store.storage));

    const trends = await server.inject({ method: 'GET', url: '/api/v1/trends?siteUrl=fabrikam.example' });
    expect(trends.statusCode).toBe(200);
    const trendRows = (trends.json() as { data: Array<{ date: string; errors: number; warnings: number; notices: number; totalIssues: number }> }).data;
    expect(trendRows).toHaveLength(2); // Northwind's scan of the same URL is another org
    for (const scan of [fresh, older]) {
      expect(asCounts(trendRows.find((r) => r.date === scan.createdAt)!)).toEqual(scan.rendered);
    }

    const summary = await server.inject({ method: 'GET', url: '/api/v1/compliance-summary' });
    expect(summary.statusCode).toBe(200);
    const summaries = (summary.json() as { data: Array<{ scanId: string; errors: number; warnings: number; notices: number; totalIssues: number }> }).data;
    for (const scan of [fresh, older]) {
      expect(asCounts(summaries.find((r) => r.scanId === scan.id)!)).toEqual(scan.rendered);
    }
  });

  it('cross-surface: GraphQL agrees with the rendered report', async () => {
    const world = await buildWorld();
    const [fresh, older] = await fabrikamScans(world);
    const gql = {
      storage: world.store.storage,
      user: { id: 'user-fabrikam', username: 'fabrikam-user', role: 'user' },
      permissions: new Set<string>(['trends.view']),
      orgId: world.orgs.fabrikamOrgId,
    } as unknown as GraphQLContext;

    for (const scan of [fresh, older]) {
      const rows = (await resolvers.Query.trends({}, { siteUrl: scan.siteUrl }, gql)) as Array<{
        scanId: string; errors: number; warnings: number; notices: number; totalIssues: number;
      }>;
      expect(asCounts(rows.find((r) => r.scanId === scan.id)!)).toEqual(scan.rendered);
    }
    const summaries = (await resolvers.Query.complianceSummary({}, {}, gql)) as Array<{
      latestScanId: string; errors: number; warnings: number; notices: number; totalIssues: number;
    }>;
    for (const scan of [fresh, older]) {
      expect(asCounts(summaries.find((r) => r.latestScanId === scan.id)!)).toEqual(scan.rendered);
    }
  });

  it('cross-surface: MCP list agrees with the rendered report', async () => {
    const world = await buildWorld();
    const [fresh, older] = await fabrikamScans(world);
    const mcp = await openMcp(world.ctx);
    try {
      const listed = (await mcp.callTool('dashboard_list_reports', {})) as {
        data: Array<{ id: string; errors: number; warnings: number; notices: number; totalIssues: number }>;
      };
      for (const scan of [fresh, older]) {
        expect(asCounts(listed.data.find((r) => r.id === scan.id)!)).toEqual(scan.rendered);
      }
      expect(listed.data.map((r) => r.id)).not.toContain(world.northwindId);
    } finally {
      await mcp.close();
    }
  });

  it('cross-surface: scans.xlsx agrees with the rendered report', async () => {
    const world = await buildWorld();
    const [fresh, older] = await fabrikamScans(world);
    const server = await serverFor(world, (s) => exportRoutes(s, world.store.storage), { role: 'user', permissions: ALL_PERMISSION_IDS });
    const res = await server.inject({ method: 'GET', url: '/api/v1/export/scans.xlsx' });
    expect(res.statusCode).toBe(200);
    const sheet = await readSheet(res.rawPayload);

    const col = (name: string) => sheet.headers.indexOf(name);
    for (const scan of [fresh, older]) {
      const row = sheet.rows.find((r) => r[col('Scan ID')] === scan.id)!;
      expect({
        errors: Number(row[col('Errors')]),
        warnings: Number(row[col('Warnings')]),
        notices: Number(row[col('Notices')]),
        total: Number(row[col('Total Issues')]),
      }).toEqual(scan.rendered);
    }
    // confirmed_violations is untouched by the mark (D-04 Case A): 0 as seeded, and the sentinel.
    expect(sheet.rows.find((r) => r[col('Scan ID')] === fresh.id)![col('Confirmed Violations')]).toBe('0');
    expect(sheet.rows.find((r) => r[col('Scan ID')] === older.id)![col('Confirmed Violations')]).toBe(String(OLD_CONFIRMED_SENTINEL));
  });

  it('cross-surface: trends.xlsx agrees with the rendered report', async () => {
    const world = await buildWorld();
    const [fresh, older] = await fabrikamScans(world);
    const server = await serverFor(world, (s) => exportRoutes(s, world.store.storage), { role: 'user', permissions: ALL_PERMISSION_IDS });
    const res = await server.inject({ method: 'GET', url: '/api/v1/export/trends.xlsx' });
    expect(res.statusCode).toBe(200);
    const sheet = await readSheet(res.rawPayload);

    const col = (name: string) => sheet.headers.indexOf(name);
    expect(sheet.rows).toHaveLength(2); // Fabrikam's two scans; Northwind's is another org
    for (const scan of [fresh, older]) {
      const row = sheet.rows.find((r) => r[col('Site URL')] === scan.siteUrl && r[col('Date')] === scan.createdAt)!;
      expect({
        errors: Number(row[col('Errors')]),
        warnings: Number(row[col('Warnings')]),
        notices: Number(row[col('Notices')]),
        total: Number(row[col('Total Issues')]),
      }).toEqual(scan.rendered);
    }
  });
});

async function readSheet(payload: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(payload);
  const ws = wb.worksheets[0];
  if (ws === undefined) return { headers: [], rows: [] };
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell) => headers.push(String(cell.value ?? '')));
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    rows.push(headers.map((_, i) => String(row.getCell(i + 1).value ?? '')));
  });
  return { headers, rows };
}

// ── Isolation and the summary-less stored report ─────────────────────────────
describe('cross-surface agreement: tenants and stored shapes', { timeout: 30_000 }, () => {
  it('the Northwind scan of the same URL keeps its raw columns', async () => {
    const world = await buildWorld();
    // Stored columns: not recomputed by a Fabrikam mark.
    expect(await columnsOf(world, world.northwindId)).toEqual(RAW_COUNTS);
    // Rendered report: Northwind has no dismissals of its own, so it still shows the raw counts...
    expect(await renderedCounts(world, world.northwindId)).toEqual(RAW_COUNTS);
    // ...and the reports list (a global admin sees every org) shows the raw row beside Fabrikam's filtered one.
    const server = await serverFor(world, (s) => reportRoutes(s, world.store.storage, () => null), {
      role: 'admin',
      permissions: ['reports.view'],
    });
    const data = await viewData<{ scans: Array<{ id: string; errors: number; warnings: number; notices: number; totalIssues: number }> }>(server, '/reports');
    expect(asCounts(data.scans.find((s) => s.id === world.northwindId)!)).toEqual(RAW_COUNTS);
  });

  it('a summary-less stored report renders the filtered counts from the recomputed columns', async () => {
    const world = await buildWorld({ summaryless: true });
    const stored = (await world.store.storage.scans.getReport(world.summarylessId!)) as Record<string, unknown>;
    expect(stored['summary']).toBeUndefined(); // the shape under test
    // normalizeReportData has no summary to trust, so it falls back to the scan row's columns (D-07 gap 1).
    expect(await renderedCounts(world, world.summarylessId!)).toEqual(AFTER_PARTIAL);
  });
});

/**
 * Plan 88-11: mark and revoke recompute the site's stored count columns in the same request,
 * report how many scans were recomputed (D-13/D-14), and log how long it took (I1).
 * Plain Fastify + real SQLite; the dismissal routes only (cross-surface agreement is Plan 18).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { writeFileSync } from 'node:fs';
import { buildRouteServer } from '../helpers/issue-dismissal-route-harness.js';
import {
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  FABRIKAM_SITE,
  FABRIKAM_SITE_VARIANT,
  RAW_COUNTS,
  openSurfaceStore,
  seedSurfaceDismissal,
  seedSurfaceOrgs,
  seedSurfaceScan,
  type ExpectedCounts,
  type SurfaceOrgs,
  type SurfaceStore,
} from '../helpers/dismissal-surface-fixture.js';

let store: SurfaceStore;
let orgs: SurfaceOrgs;
let server: FastifyInstance | undefined;
let logLines: string[];

beforeEach(async () => {
  store = await openSurfaceStore();
  orgs = await seedSurfaceOrgs(store.storage);
  logLines = [];
});
afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
  await store.cleanup();
});

async function admin(): Promise<FastifyInstance> {
  server = await buildRouteServer(
    store.storage,
    { user: { role: 'admin' }, permissions: ['issues.dismiss', 'reports.view'] },
    { logStream: { write: (chunk: string) => void logLines.push(chunk) } },
  );
  return server;
}

async function columnsOf(id: string): Promise<ExpectedCounts> {
  const scan = await store.storage.scans.getScan(id);
  if (scan === null) throw new Error('scan vanished');
  return { errors: scan.errors ?? -1, warnings: scan.warnings ?? -1, notices: scan.notices ?? -1, total: scan.totalIssues ?? -1 };
}

const payload = { ...DISMISS_PARTIAL, reason: 'Hidden promo copy' };
const markUrl = (id: string) => `/api/v1/scans/${id}/dismissals`;
const parsedLog = () => logLines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('mark recomputes the site (FP-09)', () => {
  it("mark recomputes the site's scans and reports how many", async () => {
    const a = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_SITE, location: 'db' });
    const b = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_SITE_VARIANT, location: 'db' });
    const srv = await admin();

    const res = await srv.inject({ method: 'POST', url: markUrl(a), payload });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ code: DISMISS_PARTIAL.code, status: 'active', recomputed_scans: 2, failed_scans: 0, recompute_complete: true });
    expect(await columnsOf(a)).toEqual(AFTER_PARTIAL);
    expect(await columnsOf(b)).toEqual(AFTER_PARTIAL);
  });

  it('a 409 re-mark does not recompute', async () => {
    const a = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    await seedSurfaceDismissal(store.storage, { orgId: orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    await store.storage.scans.updateScan(a, { errors: 41, warnings: 41, notices: 41, totalIssues: 123 });
    const srv = await admin();

    const res = await srv.inject({ method: 'POST', url: markUrl(a), payload });

    expect(res.statusCode).toBe(409);
    expect(await columnsOf(a)).toEqual({ errors: 41, warnings: 41, notices: 41, total: 123 });
  });

  it('mark still commits the dismissal when a scan cannot be recomputed', async () => {
    const good = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'db' });
    const bad = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'fs', reportsDir: store.reportsDir });
    writeFileSync((await store.storage.scans.getScan(bad))?.jsonReportPath as string, '{"pages": [BROKEN', 'utf-8');
    const srv = await admin();

    const res = await srv.inject({ method: 'POST', url: markUrl(good), payload });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ recomputed_scans: 1, failed_scans: 1, recompute_complete: false });
    const active = await store.storage.issueDismissals!.listActiveForSite(orgs.fabrikamOrgId, 'https://fabrikam.example/shop');
    expect(active).toHaveLength(1);
    expect(await columnsOf(good)).toEqual(AFTER_PARTIAL);
    expect(await columnsOf(bad)).toEqual(RAW_COUNTS);
  });

  it('the mark route logs an unreadable report by scan id and error name only', async () => {
    const bad = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, location: 'fs', reportsDir: store.reportsDir });
    writeFileSync((await store.storage.scans.getScan(bad))?.jsonReportPath as string, '{"pages": UNIQUE-TOKEN-91c4', 'utf-8');
    const srv = await admin();

    const res = await srv.inject({ method: 'POST', url: markUrl(bad), payload });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('Report data not available');
    const warn = parsedLog().filter((l) => l['level'] === 40);
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ scanId: bad, errorName: 'SyntaxError' });
    expect(logLines.join('')).not.toContain('UNIQUE-TOKEN');
  });

  it('recompute logs total duration and scan count', async () => {
    const a = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_SITE, location: 'db' });
    await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_SITE_VARIANT, location: 'db' });
    const srv = await admin();

    const res = await srv.inject({ method: 'POST', url: markUrl(a), payload });
    expect(res.statusCode).toBe(201);

    const summaries = parsedLog().filter((l) => l['scanCount'] !== undefined);
    expect(summaries).toHaveLength(1);
    const line = summaries[0];
    expect(line).toMatchObject({ scanCount: 2, recomputedScans: 2, failedScans: 0 });
    expect(typeof line['durationMs']).toBe('number');
    expect(Number.isFinite(line['durationMs'] as number)).toBe(true);
    expect(line['durationMs'] as number).toBeGreaterThanOrEqual(0);
    const text = JSON.stringify(line);
    for (const secret of [a, orgs.fabrikamOrgId, 'fabrikam.example']) expect(text).not.toContain(secret);
  });
});

describe('revoke recomputes the site (D-01, SC3 raw recoverable)', () => {
  it('revoke recomputes and restores raw counts', async () => {
    const a = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_SITE, location: 'db' });
    const b = await seedSurfaceScan(store.storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_SITE_VARIANT, location: 'db' });
    const srv = await admin();
    const marked = await srv.inject({ method: 'POST', url: markUrl(a), payload });
    expect(await columnsOf(a)).toEqual(AFTER_PARTIAL);

    const res = await srv.inject({ method: 'POST', url: `/api/v1/dismissals/${marked.json().id}/revoke`, payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'revoked', recomputed_scans: 2, failed_scans: 0, recompute_complete: true });
    expect(await columnsOf(a)).toEqual(RAW_COUNTS);
    expect(await columnsOf(b)).toEqual(RAW_COUNTS);
  });
});

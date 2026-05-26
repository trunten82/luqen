/**
 * Phase 62.3 — Bulk fix dispatch route tests.
 *
 * Mirrors coordinated-prs.test.ts. Real SqliteStorageAdapter; preHandler
 * injects request.user + permissions; JSON-only.
 *
 * Seeding shortcut: instead of routing through the compliance-service scan
 * pipeline, we seed a row directly via createScan() then updateScan() with a
 * minimal { pages: [{ issues: [{ wcagCriterion, code }] }] } jsonReport blob
 * and status='completed'. This is the smallest shape that
 * computeCandidates() reads via storage.scans.getReport(), and avoids
 * pulling the scan repo's full violation pipeline into route tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { bulkFixRoutes } from '../../src/routes/api/bulk-fixes.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let server: FastifyInstance | undefined;

async function buildServer(opts: {
  perms: string[];
  orgId: string;
  userId?: string;
  username?: string;
}): Promise<FastifyInstance> {
  const s = Fastify();
  s.addHook('preHandler', async (request) => {
    request.user = {
      id: opts.userId ?? 'u-tester',
      role: opts.perms.includes('admin.system') ? 'admin' : 'user',
      username: opts.username ?? 'tester',
      currentOrgId: opts.orgId,
    } as never;
    (request as unknown as { permissions: Set<string> }).permissions = new Set(opts.perms);
  });
  await bulkFixRoutes(s, storage);
  return s;
}

async function seedOrg(slug: string): Promise<string> {
  const o = await storage.organizations.createOrg({ name: slug, slug });
  return o.id;
}

async function seedTeam(name: string, orgId: string): Promise<string> {
  const t = await storage.teams.createTeam({ name, description: '', orgId });
  return t.id;
}

async function seedScanWithIssue(
  orgId: string,
  siteUrl: string,
  opts: { criterion?: string; code?: string },
): Promise<string> {
  const id = `scan_${randomUUID().replace(/-/g, '')}`;
  await storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    orgId,
  });
  const issue: Record<string, string> = { type: 'error', message: 'x', selector: '', context: '' };
  if (opts.criterion !== undefined) issue.wcagCriterion = opts.criterion;
  if (opts.code !== undefined) issue.code = opts.code;
  const report = JSON.stringify({ pages: [{ url: siteUrl, issues: [issue] }] });
  await storage.scans.updateScan(id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    jsonReport: report,
  });
  return id;
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-bfx-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ─── POST /api/v1/bulk-fixes ──────────────────────────────────────────────
describe('POST /api/v1/bulk-fixes', () => {
  it('admin.org of team home org succeeds (201) and writes audit', async () => {
    const orgId = await seedOrg('org_a');
    const teamId = await seedTeam('alpha', orgId);
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/bulk-fixes',
      payload: { team_id: teamId, criterion: '1.1.1', summary: 'alt-text' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.org_id).toBe(orgId);
    expect(body.team_id).toBe(teamId);
    expect(body.criterion).toBe('1.1.1');
    expect(body.status).toBe('draft');
    const audit = await storage.audit.query({ action: 'bulk_fix.created' });
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0].resourceId).toBe(body.id);
  });

  it('admin.org of a different org returns 403', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const teamId = await seedTeam('alpha', orgA);
    server = await buildServer({ perms: ['admin.org'], orgId: orgB });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/bulk-fixes',
      payload: { team_id: teamId, criterion: '1.1.1' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('nonexistent team returns 404', async () => {
    const orgId = await seedOrg('org_a');
    server = await buildServer({ perms: ['admin.system'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/bulk-fixes',
      payload: { team_id: 'nope', criterion: '1.1.1' },
    });
    expect(r.statusCode).toBe(404);
  });
});

// ─── GET /api/v1/bulk-fixes/:id/candidates ────────────────────────────────
describe('GET /api/v1/bulk-fixes/:id/candidates', () => {
  it('returns sites whose latest scan matches the criterion', async () => {
    const orgId = await seedOrg('org_a');
    const teamId = await seedTeam('alpha', orgId);
    const matchScanId = await seedScanWithIssue(orgId, 'https://hit.example.com', {
      criterion: '1.1.1',
    });
    await seedScanWithIssue(orgId, 'https://miss.example.com', {
      criterion: '2.4.4',
    });
    const bf = await storage.bulkFixes.create({
      orgId,
      teamId,
      createdBy: 'seed',
      criterion: '1.1.1',
    });
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'GET',
      url: `/api/v1/bulk-fixes/${bf.id}/candidates`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.candidates.length).toBe(1);
    expect(body.candidates[0].site_url).toBe('https://hit.example.com');
    expect(body.candidates[0].site_id).toBe(matchScanId);
    expect(body.candidates[0].suggested_patch_summary).toContain('1.1.1');
  });

  it('matches by code.startsWith fallback when wcagCriterion is absent', async () => {
    const orgId = await seedOrg('org_a');
    await seedScanWithIssue(orgId, 'https://by-code.example.com', {
      code: '1.1.1.G94.ImgEmpty',
    });
    const bf = await storage.bulkFixes.create({
      orgId,
      createdBy: 'seed',
      criterion: '1.1.1',
    });
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'GET',
      url: `/api/v1/bulk-fixes/${bf.id}/candidates`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().candidates.length).toBe(1);
  });

  it('respects ?skip= and emits bulk_fix.candidate_skipped audit', async () => {
    const orgId = await seedOrg('org_a');
    const skipScanId = await seedScanWithIssue(orgId, 'https://skip.example.com', {
      criterion: '1.1.1',
    });
    await seedScanWithIssue(orgId, 'https://keep.example.com', {
      criterion: '1.1.1',
    });
    const bf = await storage.bulkFixes.create({
      orgId,
      createdBy: 'seed',
      criterion: '1.1.1',
    });
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'GET',
      url: `/api/v1/bulk-fixes/${bf.id}/candidates?skip=${skipScanId}`,
    });
    expect(r.statusCode).toBe(200);
    const urls = r.json().candidates.map((c: { site_url: string }) => c.site_url);
    expect(urls).toContain('https://keep.example.com');
    expect(urls).not.toContain('https://skip.example.com');
    const audit = await storage.audit.query({ action: 'bulk_fix.candidate_skipped' });
    expect(audit.entries.length).toBe(1);
  });

  it('admin.org of a different org returns 403', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const bf = await storage.bulkFixes.create({
      orgId: orgA,
      createdBy: 'seed',
      criterion: '1.1.1',
    });
    server = await buildServer({ perms: ['admin.org'], orgId: orgB });
    const r = await server.inject({
      method: 'GET',
      url: `/api/v1/bulk-fixes/${bf.id}/candidates`,
    });
    expect(r.statusCode).toBe(403);
  });

  it('nonexistent id returns 404', async () => {
    const orgId = await seedOrg('org_a');
    server = await buildServer({ perms: ['admin.system'], orgId });
    const r = await server.inject({
      method: 'GET',
      url: '/api/v1/bulk-fixes/nope/candidates',
    });
    expect(r.statusCode).toBe(404);
  });
});

// ─── POST /api/v1/bulk-fixes/:id/dispatch ─────────────────────────────────
describe('POST /api/v1/bulk-fixes/:id/dispatch', () => {
  it('dispatches valid candidates, links coordinated_pr_id, emits audit', async () => {
    const orgId = await seedOrg('org_a');
    const teamId = await seedTeam('alpha', orgId);
    const matchId = await seedScanWithIssue(orgId, 'https://hit.example.com', {
      criterion: '1.1.1',
    });
    const bf = await storage.bulkFixes.create({
      orgId,
      teamId,
      createdBy: 'seed',
      criterion: '1.1.1',
      summary: 'fix alt text',
    });
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/bulk-fixes/${bf.id}/dispatch`,
      payload: { site_ids: [matchId] },
    });
    expect(r.statusCode).toBe(200);
    const cprId = r.json().coordinated_pr_id;
    expect(typeof cprId).toBe('string');
    const refreshed = await storage.bulkFixes.getById(bf.id);
    expect(refreshed?.status).toBe('dispatched');
    expect(refreshed?.coordinatedPrId).toBe(cprId);
    const cpr = await storage.coordinatedPrs.getCoordinatedPr(cprId);
    expect(cpr?.pr.teamId).toBe(teamId);
    expect(cpr?.legs.length).toBe(1);
    expect(cpr?.legs[0].siteId).toBe(matchId);
    const audit = await storage.audit.query({ action: 'bulk_fix.dispatched' });
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0].resourceId).toBe(bf.id);
  });

  it('rejects site_id outside the candidate set (400)', async () => {
    const orgId = await seedOrg('org_a');
    await seedScanWithIssue(orgId, 'https://hit.example.com', {
      criterion: '1.1.1',
    });
    const bf = await storage.bulkFixes.create({
      orgId,
      createdBy: 'seed',
      criterion: '1.1.1',
    });
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/bulk-fixes/${bf.id}/dispatch`,
      payload: { site_ids: ['definitely-not-a-candidate'] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('nonexistent id returns 404', async () => {
    const orgId = await seedOrg('org_a');
    server = await buildServer({ perms: ['admin.system'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/bulk-fixes/nope/dispatch',
      payload: { site_ids: ['x'] },
    });
    expect(r.statusCode).toBe(404);
  });
});

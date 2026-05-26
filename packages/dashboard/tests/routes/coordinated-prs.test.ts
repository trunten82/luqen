/**
 * Phase 62.2 — Coordinated multi-repo PRs route tests.
 *
 * Mirrors team-org-links.test.ts. Minimal Fastify with preHandler injecting
 * request.user + request.permissions; real SqliteStorageAdapter; JSON-only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { coordinatedPrRoutes } from '../../src/routes/api/coordinated-prs.js';

// Stub fetch globally so aggregator delivery never reaches network.
const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
vi.stubGlobal('fetch', fetchSpy);
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
  await coordinatedPrRoutes(s, storage);
  return s;
}

async function seedOrg(slug: string): Promise<string> {
  const o = await storage.organizations.createOrg({ name: slug, slug });
  return o.id;
}

async function seedTeam(name: string, orgId: string): Promise<string> {
  const t = await storage.teams.createTeam({
    name,
    description: '',
    orgId,
  });
  return t.id;
}

function setOrgApprovalGate(orgId: string, requires: boolean): void {
  const db = (storage as unknown as { getRawDatabase: () => import('better-sqlite3').Database }).getRawDatabase();
  db.prepare(
    'UPDATE organizations SET coordinated_pr_requires_site_approval = ? WHERE id = ?',
  ).run(requires ? 1 : 0, orgId);
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-cpr-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  fetchSpy.mockClear();
});

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ─── POST /api/v1/coordinated-prs ─────────────────────────────────────────
describe('POST /api/v1/coordinated-prs', () => {
  it('admin.org of team home org succeeds (201) and writes audit', async () => {
    const orgId = await seedOrg('org_a');
    const teamId = await seedTeam('alpha', orgId);
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/coordinated-prs',
      payload: {
        team_id: teamId,
        summary: 'alt-text fix',
        sites: [{ site_id: 'site-1' }, { site_id: 'site-2' }],
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.pr.org_id).toBe(orgId);
    expect(body.pr.team_id).toBe(teamId);
    expect(body.pr.status).toBe('opening');
    expect(body.legs.length).toBe(2);
    const audit = await storage.audit.query({ action: 'coordinated_pr.created' });
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0].resourceId).toBe(body.pr.id);
  });

  it('seeds legs with approval_status=pending when org gate is ON (default)', async () => {
    const orgId = await seedOrg('org_a');
    const teamId = await seedTeam('alpha', orgId);
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/coordinated-prs',
      payload: { team_id: teamId, sites: [{ site_id: 'site-1' }] },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().legs[0].approval_status).toBe('pending');
    expect(r.json().legs[0].leg_status).toBe('queued');
  });

  it('seeds legs with approval_status=approved when org gate is OFF', async () => {
    const orgId = await seedOrg('org_a');
    setOrgApprovalGate(orgId, false);
    const teamId = await seedTeam('alpha', orgId);
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/coordinated-prs',
      payload: { team_id: teamId, sites: [{ site_id: 'site-1' }] },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().legs[0].approval_status).toBe('approved');
  });

  it('admin.org of a different org returns 403', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const teamId = await seedTeam('alpha', orgA);
    server = await buildServer({ perms: ['admin.org'], orgId: orgB });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/coordinated-prs',
      payload: { team_id: teamId, sites: [{ site_id: 'site-1' }] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('nonexistent team returns 404', async () => {
    const orgId = await seedOrg('org_a');
    server = await buildServer({ perms: ['admin.system'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/coordinated-prs',
      payload: { team_id: 'nope', sites: [{ site_id: 'site-1' }] },
    });
    expect(r.statusCode).toBe(404);
  });
});

// ─── GET /api/v1/coordinated-prs/:id ──────────────────────────────────────
describe('GET /api/v1/coordinated-prs/:id', () => {
  it('admin.org of the PR org returns 200', async () => {
    const orgId = await seedOrg('org_a');
    const teamId = await seedTeam('alpha', orgId);
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      teamId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }],
    });
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'GET',
      url: `/api/v1/coordinated-prs/${created.pr.id}`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().pr.id).toBe(created.pr.id);
  });

  it('admin.org of a different org returns 403', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }],
    });
    server = await buildServer({ perms: ['admin.org'], orgId: orgB });
    const r = await server.inject({
      method: 'GET',
      url: `/api/v1/coordinated-prs/${created.pr.id}`,
    });
    expect(r.statusCode).toBe(403);
  });

  it('nonexistent id returns 404', async () => {
    const orgId = await seedOrg('org_a');
    server = await buildServer({ perms: ['admin.system'], orgId });
    const r = await server.inject({
      method: 'GET',
      url: '/api/v1/coordinated-prs/nope',
    });
    expect(r.statusCode).toBe(404);
  });
});

// ─── POST /api/v1/coordinated-prs/:id/rollback ────────────────────────────
describe('POST /api/v1/coordinated-prs/:id/rollback', () => {
  it('flips PR status to rolled_back and emits audit', async () => {
    const orgId = await seedOrg('org_a');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }, { siteId: 's2' }],
    });
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/rollback`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().pr.status).toBe('rolled_back');
    for (const leg of r.json().legs) {
      expect(leg.leg_status).toBe('rolled_back');
    }
    const audit = await storage.audit.query({ action: 'coordinated_pr.rolled_back' });
    expect(audit.entries.length).toBe(1);
  });

  it('non-org-admin returns 403', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }],
    });
    server = await buildServer({ perms: ['admin.org'], orgId: orgB });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/rollback`,
    });
    expect(r.statusCode).toBe(403);
  });
});

// ─── POST /api/v1/coordinated-prs/:id/legs/:legId ─────────────────────────
describe('POST /api/v1/coordinated-prs/:id/legs/:legId', () => {
  it('updates leg fields and recomputes status', async () => {
    const orgId = await seedOrg('org_a');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }],
    });
    const legId = created.legs[0].id;
    server = await buildServer({ perms: ['admin.org'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/${legId}`,
      payload: {
        leg_status: 'opened',
        host_pr_url: 'https://example.com/pr/1',
        approval_status: 'approved',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().pr.status).toBe('complete');
    expect(r.json().legs[0].leg_status).toBe('opened');
    expect(r.json().legs[0].host_pr_url).toBe('https://example.com/pr/1');
  });

  it('emits coordinated_pr.leg.opened audit on transition to opened', async () => {
    const orgId = await seedOrg('org_a');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }],
    });
    const legId = created.legs[0].id;
    server = await buildServer({ perms: ['admin.org'], orgId });
    await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/${legId}`,
      payload: { leg_status: 'opened' },
    });
    const audit = await storage.audit.query({ action: 'coordinated_pr.leg.opened' });
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0].resourceId).toBe(created.pr.id);
  });

  it('non-org-admin returns 403', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }],
    });
    server = await buildServer({ perms: ['admin.org'], orgId: orgB });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/${created.legs[0].id}`,
      payload: { leg_status: 'opened' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('nonexistent leg returns 404', async () => {
    const orgId = await seedOrg('org_a');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }],
    });
    server = await buildServer({ perms: ['admin.system'], orgId });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/missing`,
      payload: { leg_status: 'opened' },
    });
    expect(r.statusCode).toBe(404);
  });
});

// ─── Aggregator dispatch (Phase 63.1) ─────────────────────────────────────
describe('aggregator dispatch on each audited event', () => {
  it('fans coordinated_pr.created, leg.opened, and rolled_back to active subs', async () => {
    const orgId = await seedOrg('org_a');
    await storage.orgAggregatorWebhooks.create({
      orgId,
      url: 'https://example.com/hook',
    });
    server = await buildServer({ perms: ['admin.org'], orgId });

    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/coordinated-prs',
      payload: { sites: [{ site_id: 'scan-1' }] },
    });
    expect(create.statusCode).toBe(201);

    const prId = create.json().pr.id;
    const legId = create.json().legs[0].id;
    await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${prId}/legs/${legId}`,
      payload: { leg_status: 'opened' },
    });

    await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${prId}/rollback`,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const events = fetchSpy.mock.calls.map(
      (c) => (c[1] as { headers: Record<string, string> }).headers['Luqen-Event'],
    );
    expect(events).toContain('coordinated_pr.created');
    expect(events).toContain('coordinated_pr.leg.opened');
    expect(events).toContain('coordinated_pr.rolled_back');
  });
});

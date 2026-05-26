/**
 * Phase 63.1 — Per-site pending-legs lookup + delegate endpoint tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { coordinatedPrRoutes } from '../../src/routes/api/coordinated-prs.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

// Silence aggregator delivery in route tests — fanout calls fetch but we
// don't want network traffic. Stub fetch to a no-op fulfilled promise.
const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
vi.stubGlobal('fetch', fetchSpy);

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
    (request as unknown as { permissions: Set<string> }).permissions = new Set(
      opts.perms,
    );
  });
  await coordinatedPrRoutes(s, storage);
  return s;
}

async function seedOrg(slug: string): Promise<string> {
  const o = await storage.organizations.createOrg({ name: slug, slug });
  return o.id;
}

async function seedScan(siteUrl: string, orgId: string): Promise<string> {
  const id = `scan_${randomUUID().replace(/-/g, '')}`;
  await storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG21AA',
    jurisdictions: [],
    createdBy: 'tester',
    createdAt: new Date().toISOString(),
    orgId,
  });
  return id;
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-cpr-legs-${randomUUID()}.db`);
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

describe('GET /api/v1/coordinated-prs/legs', () => {
  it('returns pending legs scoped to caller org for admin.org', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const scanA = await seedScan('https://a.example.com', orgA);
    const scanB = await seedScan('https://a.example.com', orgB);

    await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: scanA }],
    });
    await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgB,
      createdBy: 'seed',
      legs: [{ siteId: scanB }],
    });

    server = await buildServer({ perms: ['admin.org'], orgId: orgA });
    const r = await server.inject({
      method: 'GET',
      url: '/api/v1/coordinated-prs/legs?site_url=https://a.example.com&approval_status=pending',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.legs.length).toBe(1);
    expect(body.legs[0].org_id).toBe(orgA);
    expect(body.legs[0].site_url).toBe('https://a.example.com');
  });

  it('admin.system sees pending legs across all orgs', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const scanA = await seedScan('https://a.example.com', orgA);
    const scanB = await seedScan('https://a.example.com', orgB);
    await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: scanA }],
    });
    await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgB,
      createdBy: 'seed',
      legs: [{ siteId: scanB }],
    });

    server = await buildServer({ perms: ['admin.system'], orgId: orgA });
    const r = await server.inject({
      method: 'GET',
      url: '/api/v1/coordinated-prs/legs?site_url=https://a.example.com',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().legs.length).toBe(2);
  });

  it('filters by site_url — no match returns empty', async () => {
    const orgA = await seedOrg('org_a');
    const scanA = await seedScan('https://a.example.com', orgA);
    await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: scanA }],
    });
    server = await buildServer({ perms: ['admin.system'], orgId: orgA });
    const r = await server.inject({
      method: 'GET',
      url: '/api/v1/coordinated-prs/legs?site_url=https://other.example.com',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().legs.length).toBe(0);
  });

  it('omits approved legs (approval_status=pending only)', async () => {
    const orgA = await seedOrg('org_a');
    const scanA = await seedScan('https://a.example.com', orgA);
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: scanA }],
    });
    await storage.coordinatedPrs.updateLeg(created.legs[0].id, {
      approvalStatus: 'approved',
    });
    server = await buildServer({ perms: ['admin.system'], orgId: orgA });
    const r = await server.inject({
      method: 'GET',
      url: '/api/v1/coordinated-prs/legs?site_url=https://a.example.com',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().legs.length).toBe(0);
  });

  it('non-admin caller returns 403', async () => {
    const orgA = await seedOrg('org_a');
    server = await buildServer({ perms: [], orgId: orgA });
    const r = await server.inject({
      method: 'GET',
      url: '/api/v1/coordinated-prs/legs?site_url=https://a.example.com',
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('POST /api/v1/coordinated-prs/:id/legs/:legId/delegate', () => {
  it('admin.org delegates to another user; audit + leg row updated', async () => {
    const orgA = await seedOrg('org_a');
    const target = await storage.users.createUser('alice', 'pw', 'user');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 'scan-1' }],
    });
    const legId = created.legs[0].id;
    server = await buildServer({ perms: ['admin.org'], orgId: orgA });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/${legId}/delegate`,
      payload: { user_id: target.id },
    });
    expect(r.statusCode).toBe(200);
    const audit = await storage.audit.query({
      action: 'coordinated_pr.leg.delegated',
    });
    expect(audit.entries.length).toBe(1);
    const parsedDetails =
      typeof audit.entries[0].details === 'string'
        ? JSON.parse(audit.entries[0].details)
        : audit.entries[0].details;
    expect(parsedDetails).toMatchObject({
      to_user_id: target.id,
      from_user_id: null,
    });
    const leg = await storage.coordinatedPrs.getLegById(legId);
    expect(leg?.leg.delegatedTo).toBe(target.id);
  });

  it('admin.org of a different org returns 403', async () => {
    const orgA = await seedOrg('org_a');
    const orgB = await seedOrg('org_b');
    const target = await storage.users.createUser('alice', 'pw', 'user');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 'scan-1' }],
    });
    server = await buildServer({ perms: ['admin.org'], orgId: orgB });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/${created.legs[0].id}/delegate`,
      payload: { user_id: target.id },
    });
    expect(r.statusCode).toBe(403);
  });

  it('missing target user returns 404', async () => {
    const orgA = await seedOrg('org_a');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 'scan-1' }],
    });
    server = await buildServer({ perms: ['admin.system'], orgId: orgA });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/${created.legs[0].id}/delegate`,
      payload: { user_id: 'does-not-exist' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('nonexistent leg returns 404', async () => {
    const orgA = await seedOrg('org_a');
    const target = await storage.users.createUser('alice', 'pw', 'user');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 'scan-1' }],
    });
    server = await buildServer({ perms: ['admin.system'], orgId: orgA });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/does-not-exist/delegate`,
      payload: { user_id: target.id },
    });
    expect(r.statusCode).toBe(404);
  });

  it('current assignee (delegated_to) can re-delegate even without admin', async () => {
    const orgA = await seedOrg('org_a');
    const assignee = await storage.users.createUser('alice', 'pw', 'user');
    const next = await storage.users.createUser('bob', 'pw', 'user');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 'scan-1' }],
    });
    const legId = created.legs[0].id;
    // pre-seed delegated_to
    await storage.coordinatedPrs.delegateLeg(legId, assignee.id, 'seed');

    server = await buildServer({
      perms: [],
      orgId: orgA,
      userId: assignee.id,
      username: 'alice',
    });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/${legId}/delegate`,
      payload: { user_id: next.id },
    });
    expect(r.statusCode).toBe(200);
    const leg = await storage.coordinatedPrs.getLegById(legId);
    expect(leg?.leg.delegatedTo).toBe(next.id);
  });

  it('non-admin, non-assignee returns 403', async () => {
    const orgA = await seedOrg('org_a');
    const stranger = await storage.users.createUser('mallory', 'pw', 'user');
    const target = await storage.users.createUser('alice', 'pw', 'user');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      createdBy: 'seed',
      legs: [{ siteId: 'scan-1' }],
    });
    server = await buildServer({
      perms: [],
      orgId: orgA,
      userId: stranger.id,
      username: 'mallory',
    });
    const r = await server.inject({
      method: 'POST',
      url: `/api/v1/coordinated-prs/${created.pr.id}/legs/${created.legs[0].id}/delegate`,
      payload: { user_id: target.id },
    });
    expect(r.statusCode).toBe(403);
  });
});

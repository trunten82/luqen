/**
 * Phase 62.4 — Cross-site MCP fleet tools — integration tests.
 *
 * Mirrors the admin-tools.test.ts shape (HTTP route + Bearer middleware)
 * but uses a real SqliteStorageAdapter so the chained calls into
 *   storage.bulkFixes.create + computeBulkFixCandidates +
 *   storage.coordinatedPrs.createCoordinatedPr +
 *   storage.bulkFixes.markDispatched + storage.audit.log
 * exercise the same code paths the HTTP routes do.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  FLEET_TOOL_NAMES,
  DASHBOARD_FLEET_TOOL_METADATA,
} from '../../src/mcp/tools/fleet.js';
import type {
  McpTokenPayload,
  McpTokenVerifier,
} from '../../src/mcp/middleware.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type { ServiceConnectionsRepository } from '../../src/db/service-connections-repository.js';

// ---------------------------------------------------------------------------
// Boilerplate stubs
// ---------------------------------------------------------------------------

function makeFakeVerifier(payload: McpTokenPayload): McpTokenVerifier {
  return async (token: string): Promise<McpTokenPayload> => {
    if (token === 'valid-jwt') return payload;
    throw new Error('Invalid token');
  };
}

function makeStubScanService(): ScanService {
  return {
    initiateScan: async () => ({ ok: true, scanId: 'stub-scan' }),
    getScanForOrg: async () => ({ ok: false, error: 'Scan not found' }),
  } as unknown as ScanService;
}

function makeStubServiceConnections(): ServiceConnectionsRepository {
  return {
    list: async () => [],
    get: async () => null,
    upsert: (async (input) => ({
      serviceId: input.serviceId,
      url: input.url,
      clientId: input.clientId,
      clientSecret: input.clientSecret ?? '',
      hasSecret: input.clientSecret != null && input.clientSecret !== '',
      updatedAt: '1970-01-01T00:00:00.000Z',
      updatedBy: input.updatedBy,
      source: 'db' as const,
    })) as unknown as ServiceConnectionsRepository['upsert'],
    clearSecret: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Storage seeding helpers (mirrors bulk-fixes.test.ts)
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let dbPath: string;
let app: FastifyInstance | undefined;

async function seedOrg(slug: string): Promise<string> {
  const o = await storage.organizations.createOrg({ name: slug, slug });
  return o.id;
}

async function seedUser(
  username: string,
  role: 'admin' | 'developer' | 'editor' | 'user' | 'viewer' | 'executive',
): Promise<string> {
  const u = await storage.users.createUser(username, 'password123', role);
  return (u as unknown as { id: string }).id;
}

async function seedTeam(name: string, orgId: string): Promise<string> {
  const t = await storage.teams.createTeam({ name, description: '', orgId });
  return t.id;
}

async function seedWpSite(orgId: string, url: string): Promise<string> {
  const site = await storage.wpSites.register({
    orgId,
    oauthClientId: `client-${orgId}`,
    url,
    wpVersion: '6.5',
    pluginVersion: '3.4.0',
  });
  return site.id;
}

async function seedScanWithIssue(
  orgId: string,
  siteUrl: string,
  opts: { criterion?: string; code?: string; completedAt?: string },
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
  const issue: Record<string, string> = {
    type: 'error',
    message: 'x',
    selector: '',
    context: '',
  };
  if (opts.criterion !== undefined) issue.wcagCriterion = opts.criterion;
  if (opts.code !== undefined) issue.code = opts.code;
  const report = JSON.stringify({
    pages: [{ url: siteUrl, issues: [issue] }],
  });
  await storage.scans.updateScan(id, {
    status: 'completed',
    completedAt: opts.completedAt ?? new Date().toISOString(),
    jsonReport: report,
  });
  return id;
}

async function buildApp(opts: {
  userId: string;
  username: string;
  role: string;
  orgId: string;
}): Promise<FastifyInstance> {
  const a = Fastify({ logger: false });
  await registerMcpRoutes(a, {
    verifyToken: makeFakeVerifier({
      sub: opts.userId,
      scopes: ['read', 'write', 'admin'],
      orgId: opts.orgId,
      role: opts.role,
    }),
    storage,
    scanService: makeStubScanService(),
    serviceConnections: makeStubServiceConnections(),
    resourceMetadataUrl: 'http://localhost/.well-known/oauth-protected-resource',
  });
  await a.ready();
  return a;
}

function rpc(method: string, params: unknown = {}, id = 1): unknown {
  return { jsonrpc: '2.0', id, method, params };
}

function parseSseOrJson(body: string): Record<string, unknown> {
  const t = body.trim();
  if (t.startsWith('{')) return JSON.parse(t) as Record<string, unknown>;
  const line = t
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (line === undefined) throw new Error(`No SSE data line in body: ${body}`);
  return JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>;
}

async function callTool(
  a: FastifyInstance,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await a.inject({
    method: 'POST',
    url: '/api/v1/mcp',
    headers: {
      authorization: 'Bearer valid-jwt',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    payload: rpc('tools/call', { name, arguments: args }),
  });
  return parseSseOrJson(resp.body);
}

function extractText(parsed: Record<string, unknown>): Record<string, unknown> {
  const r = parsed['result'] as { content?: Array<{ text?: string }> } | undefined;
  return JSON.parse(r?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

function isError(parsed: Record<string, unknown>): boolean {
  const r = parsed['result'] as { isError?: boolean } | undefined;
  return r?.isError === true;
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-fleet-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Metadata invariants
// ---------------------------------------------------------------------------

describe('Phase 62.4 fleet tools — metadata invariants', () => {
  it('FLEET_TOOL_NAMES has 4 entries matching DASHBOARD_FLEET_TOOL_METADATA', () => {
    expect(FLEET_TOOL_NAMES.length).toBe(4);
    expect(DASHBOARD_FLEET_TOOL_METADATA.length).toBe(4);
    const metaNames = DASHBOARD_FLEET_TOOL_METADATA.map((m) => m.name);
    expect(metaNames).toEqual([...FLEET_TOOL_NAMES]);
  });

  it('dashboard_queue_bulk_fix is the only destructive tool with confirmationTemplate', () => {
    const q = DASHBOARD_FLEET_TOOL_METADATA.find(
      (m) => m.name === 'dashboard_queue_bulk_fix',
    );
    expect(q?.destructive).toBe(true);
    expect(typeof q?.confirmationTemplate).toBe('function');
    expect(q?.confirmationTemplate?.({ criterion: '1.4.3' })).toMatch(/1\.4\.3/);
    const others = DASHBOARD_FLEET_TOOL_METADATA.filter(
      (m) => m.name !== 'dashboard_queue_bulk_fix',
    );
    for (const o of others) {
      expect(o.destructive ?? false).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// dashboard_list_fleet — org scoping
// ---------------------------------------------------------------------------

describe('dashboard_list_fleet', () => {
  it('lists only sites in caller org (org-scoping)', async () => {
    const orgA = await seedOrg('alpha');
    const orgB = await seedOrg('beta');
    await seedWpSite(orgA, 'https://a1.example.com');
    await seedWpSite(orgA, 'https://a2.example.com');
    await seedWpSite(orgB, 'https://b1.example.com');
    const uid = await seedUser('alice', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');

    app = await buildApp({
      userId: uid,
      username: 'alice',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_list_fleet', {});
    const body = extractText(resp);
    const data = body['data'] as Array<{ url: string }>;
    const urls = data.map((d) => d.url).sort();
    expect(urls).toEqual(['https://a1.example.com', 'https://a2.example.com']);
  });

  it('group_id filters to team scope (single org case)', async () => {
    const orgA = await seedOrg('alpha2');
    const teamId = await seedTeam('eu', orgA);
    await seedWpSite(orgA, 'https://eu.example.com');
    const uid = await seedUser('bob', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');

    app = await buildApp({
      userId: uid,
      username: 'bob',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_list_fleet', {
      group_id: teamId,
    });
    const body = extractText(resp);
    const data = body['data'] as Array<{ url: string }>;
    // Team home org includes this site, so it should be present.
    expect(data.length).toBe(1);
    expect(data[0]?.url).toBe('https://eu.example.com');
  });

  it('group_id rejects unknown team', async () => {
    const orgA = await seedOrg('alpha3');
    const uid = await seedUser('carol', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');
    app = await buildApp({
      userId: uid,
      username: 'carol',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_list_fleet', {
      group_id: 'team-nope',
    });
    expect(isError(resp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dashboard_scan_summary_for_fleet — criterion + since filter
// ---------------------------------------------------------------------------

describe('dashboard_scan_summary_for_fleet', () => {
  it('returns rows for sites with matching criterion at-or-after since', async () => {
    const orgA = await seedOrg('alpha4');
    const uid = await seedUser('dave', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');
    await seedScanWithIssue(orgA, 'https://hit.example.com', {
      criterion: '1.4.3',
      completedAt: '2026-05-20T00:00:00.000Z',
    });
    await seedScanWithIssue(orgA, 'https://miss.example.com', {
      criterion: '2.1.1',
      completedAt: '2026-05-20T00:00:00.000Z',
    });

    app = await buildApp({
      userId: uid,
      username: 'dave',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_scan_summary_for_fleet', {
      criterion: '1.4.3',
      since: '2026-05-01T00:00:00.000Z',
    });
    const body = extractText(resp);
    const data = body['data'] as Array<{ site_url: string; count: number }>;
    expect(data.length).toBe(1);
    expect(data[0]?.site_url).toBe('https://hit.example.com');
    expect(data[0]?.count).toBeGreaterThanOrEqual(1);
  });

  it('filters out scans completed before since', async () => {
    const orgA = await seedOrg('alpha5');
    const uid = await seedUser('erin', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');
    await seedScanWithIssue(orgA, 'https://old.example.com', {
      criterion: '1.4.3',
      completedAt: '2026-01-01T00:00:00.000Z',
    });
    app = await buildApp({
      userId: uid,
      username: 'erin',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_scan_summary_for_fleet', {
      criterion: '1.4.3',
      since: '2026-05-01T00:00:00.000Z',
    });
    const body = extractText(resp);
    expect((body['data'] as unknown[]).length).toBe(0);
  });

  it('matches issue.code.startsWith(criterion) as a fallback', async () => {
    const orgA = await seedOrg('alpha6');
    const uid = await seedUser('frank', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');
    await seedScanWithIssue(orgA, 'https://code.example.com', {
      code: '1.4.3.G18.Fail',
      completedAt: '2026-05-20T00:00:00.000Z',
    });
    app = await buildApp({
      userId: uid,
      username: 'frank',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_scan_summary_for_fleet', {
      criterion: '1.4.3',
      since: '2026-05-01T00:00:00.000Z',
    });
    const body = extractText(resp);
    const data = body['data'] as Array<{ site_url: string }>;
    expect(data.length).toBe(1);
    expect(data[0]?.site_url).toBe('https://code.example.com');
  });
});

// ---------------------------------------------------------------------------
// dashboard_queue_bulk_fix — creates bulk_fix + coordinated_pr + audits
// ---------------------------------------------------------------------------

describe('dashboard_queue_bulk_fix', () => {
  it('creates bulk_fix + coordinated_pr, marks dispatched, emits both audit events', async () => {
    const orgA = await seedOrg('alpha7');
    const uid = await seedUser('grace', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');
    await seedScanWithIssue(orgA, 'https://q.example.com', {
      criterion: '1.4.3',
      completedAt: '2026-05-20T00:00:00.000Z',
    });

    app = await buildApp({
      userId: uid,
      username: 'grace',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_queue_bulk_fix', {
      criterion: '1.4.3',
      summary: 'fleet alt-text',
    });
    const body = extractText(resp);
    expect(body['bulk_fix_id']).toBeTruthy();
    expect(body['coordinated_pr_id']).toBeTruthy();
    expect(body['site_count']).toBe(1);

    const bf = await storage.bulkFixes.getById(body['bulk_fix_id'] as string);
    expect(bf?.status).toBe('dispatched');
    expect(bf?.coordinatedPrId).toBe(body['coordinated_pr_id']);

    const created = await storage.audit.query({ action: 'bulk_fix.created' });
    expect(created.entries.length).toBe(1);
    expect(created.entries[0]?.resourceId).toBe(body['bulk_fix_id']);

    const dispatched = await storage.audit.query({
      action: 'bulk_fix.dispatched',
    });
    expect(dispatched.entries.length).toBe(1);
    expect(dispatched.entries[0]?.resourceId).toBe(body['bulk_fix_id']);

    const cpr = await storage.coordinatedPrs.getCoordinatedPr(
      body['coordinated_pr_id'] as string,
    );
    expect(cpr?.legs.length).toBe(1);
  });

  it('rejects callers without admin.org (no permission, no audit)', async () => {
    const orgA = await seedOrg('alpha8');
    const uid = await seedUser('hank', 'viewer');
    await storage.organizations.addMember(orgA, uid, 'viewer');
    await seedScanWithIssue(orgA, 'https://r.example.com', {
      criterion: '1.4.3',
      completedAt: '2026-05-20T00:00:00.000Z',
    });

    app = await buildApp({
      userId: uid,
      username: 'hank',
      role: 'viewer',
      orgId: orgA,
    });
    // viewer perms won't include admin.org so RBAC filter hides the tool;
    // we still try to call it directly to confirm a clean error path.
    const resp = await callTool(app, 'dashboard_queue_bulk_fix', {
      criterion: '1.4.3',
    });
    // Either RBAC layer or the handler will refuse; both are acceptable —
    // the post-condition is that no bulk_fix.created audit was emitted.
    const created = await storage.audit.query({ action: 'bulk_fix.created' });
    expect(created.entries.length).toBe(0);
    expect(resp).toBeDefined();
  });

  it('errors when no candidate sites match the criterion', async () => {
    const orgA = await seedOrg('alpha9');
    const uid = await seedUser('ivy', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');
    // No scans seeded -> no candidates
    app = await buildApp({
      userId: uid,
      username: 'ivy',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_queue_bulk_fix', {
      criterion: '1.4.3',
    });
    expect(isError(resp)).toBe(true);
    // bulk_fix.created still fires (the row is persisted before dispatch),
    // but bulk_fix.dispatched must NOT fire on the empty-candidate path.
    const dispatched = await storage.audit.query({
      action: 'bulk_fix.dispatched',
    });
    expect(dispatched.entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dashboard_coordinated_pr_status — returns { pr, legs }
// ---------------------------------------------------------------------------

describe('dashboard_coordinated_pr_status', () => {
  it('returns pr + legs for an in-org coordinated_pr', async () => {
    const orgA = await seedOrg('alpha10');
    const uid = await seedUser('jane', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');

    const cpr = await storage.coordinatedPrs.createCoordinatedPr({
      orgId: orgA,
      teamId: null,
      createdBy: 'tester',
      summary: 'pr status check',
      legs: [{ siteId: 'site-a' }, { siteId: 'site-b' }],
    });

    app = await buildApp({
      userId: uid,
      username: 'jane',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_coordinated_pr_status', {
      id: cpr.pr.id,
    });
    const body = extractText(resp);
    const pr = body['pr'] as { id: string; orgId: string };
    const legs = body['legs'] as Array<{ siteId: string }>;
    expect(pr.id).toBe(cpr.pr.id);
    expect(pr.orgId).toBe(orgA);
    expect(legs.length).toBe(2);
    const siteIds = legs.map((l) => l.siteId).sort();
    expect(siteIds).toEqual(['site-a', 'site-b']);
  });

  it('returns error for unknown coordinated_pr id', async () => {
    const orgA = await seedOrg('alpha11');
    const uid = await seedUser('kate', 'admin');
    await storage.organizations.addMember(orgA, uid, 'admin');
    app = await buildApp({
      userId: uid,
      username: 'kate',
      role: 'admin',
      orgId: orgA,
    });
    const resp = await callTool(app, 'dashboard_coordinated_pr_status', {
      id: 'cpr-does-not-exist',
    });
    expect(isError(resp)).toBe(true);
  });
});

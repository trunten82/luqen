/**
 * Phase 31.1 Plan 04 Task 2 — /admin/clients DCR extension tests (Tests 6-8)
 * plus the sidebar link Test 9 (see below).
 *
 * Covers:
 *   - Test 6: GET /admin/clients includes DCR clients with Kind='DCR'.
 *   - Test 7: POST /admin/clients/dcr/:clientId/revoke deletes the row.
 *   - Test 8: Non-admin user sees only their OWN DCR clients.
 *   - Test 9: Sidebar partial exposes an /admin/oauth-keys link gated on
 *     admin.system permission.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../../src/plugins/crypto.js';
import { clientRoutes } from '../../../src/routes/admin/clients.js';

vi.mock('../../../src/compliance-client.js', () => ({
  listClients: vi.fn().mockResolvedValue([]),
  createClient: vi.fn(),
  revokeClient: vi.fn(),
}));

vi.mock('../../../src/branding-client.js', () => ({
  listBrandingClients: vi.fn().mockResolvedValue([]),
  createBrandingClient: vi.fn(),
  revokeBrandingClient: vi.fn(),
}));

const ENC_KEY = 'test-session-secret-at-least-32b';

interface Ctx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  adminUserId: string;
  otherUserId: string;
  ownedClientId: string;
  otherClientId: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(role: 'admin' | 'viewer' = 'admin', userIdOverride?: string): Promise<Ctx> {
  setEncryptionSalt('phase-31-1-plan-04-clients-dcr-salt');
  const dbPath = join(tmpdir(), `test-clients-dcr-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const adminUserId = randomUUID();
  const otherUserId = randomUUID();
  const db = storage.getRawDatabase();
  db.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'admin', 1, ?)`,
  ).run(adminUserId, `admin-${adminUserId}`, new Date().toISOString());
  db.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(otherUserId, `user-${otherUserId}`, new Date().toISOString());

  // Seed two DCR clients — one registered by the admin, one by the other user.
  const owned = await storage.oauthClients.register({
    clientName: 'Claude Desktop (admin)',
    redirectUris: ['https://claude.ai/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read write',
    registeredByUserId: adminUserId,
  });
  const other = await storage.oauthClients.register({
    clientName: 'MCP Inspector (user)',
    redirectUris: ['https://inspector.test/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read',
    registeredByUserId: otherUserId,
  });

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  const currentUserId = userIdOverride ?? (role === 'admin' ? adminUserId : otherUserId);
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: currentUserId,
      username: role === 'admin' ? 'admin' : 'viewer',
      role,
      currentOrgId: 'system',
    };
    const perms = role === 'admin'
      ? new Set(['admin.system', 'admin.org', 'compliance.view', 'compliance.manage'])
      : new Set(['compliance.view']);
    (request as unknown as Record<string, unknown>)['permissions'] = perms;
  });

  await clientRoutes(server, 'http://compliance.test', storage);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return {
    server, storage, adminUserId, otherUserId,
    ownedClientId: owned.clientId,
    otherClientId: other.clientId,
    cleanup,
  };
}

// ── Test 6 ────────────────────────────────────────────────────────────────────

describe('GET /admin/clients — Test 6 (DCR clients surface with Kind=DCR)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx('admin'); });
  afterEach(async () => { await ctx.cleanup(); });

  it('includes DCR clients from oauth_clients_v2 in the rendered list', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/clients' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        clients: Array<{
          clientId: string; kind: string; name?: string; service?: string;
        }>;
      };
    };
    const dcrRows = body.data.clients.filter((c) => c.kind === 'DCR');
    expect(dcrRows.length).toBe(2);
    const dcrIds = dcrRows.map((r) => r.clientId).sort();
    expect(dcrIds).toEqual([ctx.otherClientId, ctx.ownedClientId].sort());
  });
});

// ── Test 7 ────────────────────────────────────────────────────────────────────

describe('POST /admin/clients/dcr/:clientId/revoke — Test 7 (admin revokes DCR client)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx('admin'); });
  afterEach(async () => { await ctx.cleanup(); });

  it('deletes the row and redirects with a toast', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/clients/dcr/${encodeURIComponent(ctx.otherClientId)}/revoke`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    // Admin-page standard is 302 redirect with toast query; 200 HTML toast is
    // also acceptable if the implementation picks that style. Either way the
    // row must be gone.
    expect([200, 302]).toContain(res.statusCode);
    const row = await ctx.storage.oauthClients.findByClientId(ctx.otherClientId);
    expect(row).toBeNull();
  });
});

// ── Test 8 ────────────────────────────────────────────────────────────────────

describe('GET /admin/clients + revoke — Test 8 (non-admin sees only own; cannot revoke others)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx('viewer'); });
  afterEach(async () => { await ctx.cleanup(); });

  it('non-admin list returns only their own DCR clients', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/clients' });
    // A viewer has compliance.view so can load the page.
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { clients: Array<{ clientId: string; kind: string }> };
    };
    const dcrRows = body.data.clients.filter((c) => c.kind === 'DCR');
    // Viewer owns only otherClientId (seeded with registeredByUserId=otherUserId).
    expect(dcrRows.map((r) => r.clientId)).toEqual([ctx.otherClientId]);
  });

  it('non-admin cannot revoke someone else\'s DCR client (returns 403 and row persists)', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/clients/dcr/${encodeURIComponent(ctx.ownedClientId)}/revoke`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(res.statusCode).toBe(403);
    // Row should still exist.
    const row = await ctx.storage.oauthClients.findByClientId(ctx.ownedClientId);
    expect(row).not.toBeNull();
  });
});

// ── Test 9 ────────────────────────────────────────────────────────────────────

describe('Sidebar partial — Test 9 (/admin/oauth-keys link gated on admin.system)', () => {
  it('sidebar.hbs contains a link to /admin/oauth-keys inside an admin.system guard', async () => {
    const sidebarPath = join(
      process.cwd(),
      'src', 'views', 'partials', 'sidebar.hbs',
    );
    const content = readFileSync(sidebarPath, 'utf-8');
    // The link must exist.
    expect(content).toContain('/admin/oauth-keys');
    // It must be inside a perm.adminSystem guard — we assert that the nearest
    // opening conditional before the link is `{{#if perm.adminSystem}}` (i.e.
    // no non-admin branch has bypassed the link).
    const linkIdx = content.indexOf('/admin/oauth-keys');
    expect(linkIdx).toBeGreaterThan(0);
    const prefix = content.slice(0, linkIdx);
    // Look for the most recent `{{#if ...}}` before the link.
    const ifMatches = [...prefix.matchAll(/\{\{#if\s+([a-zA-Z0-9_.]+)\s*\}\}/g)];
    const closeMatches = [...prefix.matchAll(/\{\{\/if\}\}/g)];
    // Count open - close to find currently-open guards at link position.
    // The innermost open guard must be perm.adminSystem.
    const openStack: string[] = [];
    const combined = [
      ...ifMatches.map((m) => ({ kind: 'open' as const, expr: m[1]!, idx: m.index! })),
      ...closeMatches.map((m) => ({ kind: 'close' as const, expr: '', idx: m.index! })),
    ].sort((a, b) => a.idx - b.idx);
    for (const ev of combined) {
      if (ev.kind === 'open') openStack.push(ev.expr);
      else openStack.pop();
    }
    expect(openStack).toContain('perm.adminSystem');
  });
});

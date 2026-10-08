/**
 * ORG-KEY-CONTAINMENT-1 (2026-10-08): an org-scoped API key whose role is
 * 'admin' authenticated as role 'admin' + currentOrgId. Every org-isolation
 * check is `role !== 'admin' && scan.orgId !== orgId`, so such a key bypassed
 * it; Bearer auth applies to every route, so GET /reports listed EVERY org's
 * scans; and resolveEffectivePermissions granted it ALL permissions incl.
 * admin.system. These tests pin the containment: the key is flagged at
 * authentication, confined to /api/*, capped at the org Owner permission set,
 * and never treated as a global admin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import Fastify from 'fastify';
import { dataApiRoutes } from '../../src/routes/api/data.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { createAuthGuard } from '../../src/auth/middleware.js';
import { enforceApiKeyRole } from '../../src/auth/api-key-guard.js';
import { storeApiKey } from '../../src/auth/api-key.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { loadRegistry } from '../../src/plugins/registry.js';
import {
  resolveEffectivePermissions,
  ORG_OWNER_PERMISSIONS,
  ALL_PERMISSION_IDS,
  bypassesOrgScope,
} from '../../src/permissions.js';

const SECRET = 'test-session-secret-at-least-32b';

function mockReply() {
  const r: { _code?: number; _body?: unknown; code(n: number): { send(b: unknown): void } } = {
    code(n: number) { r._code = n; return { send(b: unknown) { r._body = b; } }; },
  };
  return r;
}

function apiKeyRequest(user: Record<string, unknown>, url: string): FastifyRequest {
  return { user: { id: 'api-key', username: 'api-key', role: 'admin', ...user }, url, method: 'GET' } as unknown as FastifyRequest;
}

describe('org-scoped admin API key containment', () => {
  let storage: SqliteStorageAdapter;
  let authService: AuthService;
  let dbPath: string;
  let pluginsDir: string;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `test-orgkey-${randomUUID()}.db`);
    pluginsDir = join(tmpdir(), `test-orgkey-plugins-${randomUUID()}`);
    mkdirSync(pluginsDir, { recursive: true });
    storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();
    const rawDb = storage.getRawDatabase();
    const pm = new PluginManager({ db: rawDb, pluginsDir, encryptionKey: SECRET, registryEntries: loadRegistry() });
    authService = new AuthService(rawDb, pm, storage);
  });

  afterEach(async () => {
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
  });

  function storeKey(key: string, role: 'admin' | 'read-only', orgId: string): void {
    const rawDb = storage.getRawDatabase();
    const id = storeApiKey(rawDb, key, 'k', role);
    rawDb.prepare('UPDATE api_keys SET org_id = ? WHERE id = ?').run(orgId, id);
  }

  it('[EVIDENCE] flags an org-scoped key at authentication, and the auth guard carries the flag', async () => {
    storeKey('org-admin-key-0000000000000000000000', 'admin', 'org-a');
    const req = { headers: { authorization: 'Bearer org-admin-key-0000000000000000000000' }, url: '/api/v1/scans', method: 'GET' } as unknown as FastifyRequest;
    await createAuthGuard(authService)(req, mockReply() as unknown as FastifyReply);
    expect(req.user).toMatchObject({ id: 'api-key', role: 'admin', currentOrgId: 'org-a', orgScopedApiKey: true });
  });

  it('[SYMMETRY] a system-scope key is NOT flagged', async () => {
    storeKey('system-key-00000000000000000000000000', 'admin', 'system');
    const req = { headers: { authorization: 'Bearer system-key-00000000000000000000000000' }, url: '/api/v1/scans', method: 'GET' } as unknown as FastifyRequest;
    await createAuthGuard(authService)(req, mockReply() as unknown as FastifyReply);
    expect(req.user?.orgScopedApiKey).toBeUndefined();
  });

  it('[EVIDENCE] confines an org-scoped key to /api/* (no HTML /reports listing, no /admin, no /graphql)', async () => {
    for (const url of ['/reports', '/reports?q=x', '/admin/users', '/graphql', '/scan/new']) {
      const reply = mockReply();
      await enforceApiKeyRole(apiKeyRequest({ currentOrgId: 'org-a', orgScopedApiKey: true }, url), reply as unknown as FastifyReply);
      expect(reply._code, url).toBe(403);
    }
  });

  it('[SYMMETRY] still lets an org-scoped key use its org API, and leaves system keys on HTML routes alone', async () => {
    const orgReply = mockReply();
    await enforceApiKeyRole(apiKeyRequest({ currentOrgId: 'org-a', orgScopedApiKey: true }, '/api/v1/scans'), orgReply as unknown as FastifyReply);
    expect(orgReply._code).toBeUndefined();
    const sysReply = mockReply();
    await enforceApiKeyRole(apiKeyRequest({}, '/reports'), sysReply as unknown as FastifyReply);
    expect(sysReply._code).toBeUndefined();
  });

  it('[EVIDENCE] caps an org-scoped admin key at the org Owner permission set (no admin.system)', async () => {
    const perms = await resolveEffectivePermissions(storage.roles, 'api-key', 'admin', 'org-a', { orgScopedApiKey: true });
    expect([...perms].sort()).toEqual([...ORG_OWNER_PERMISSIONS].sort());
    expect(perms.has('admin.system')).toBe(false);
  });

  it('[SYMMETRY] a global admin (no org-scoped flag) still resolves every permission', async () => {
    const perms = await resolveEffectivePermissions(storage.roles, 'u1', 'admin', 'org-a');
    expect(perms.size).toBe(ALL_PERMISSION_IDS.length);
  });

  it('[EVIDENCE] an org-scoped admin key cannot DELETE another org\'s scan', async () => {
    const id = randomUUID();
    await storage.scans.createScan({ id, siteUrl: 'https://example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'x', createdAt: new Date().toISOString(), orgId: 'other-org' });
    const server = Fastify({ logger: false });
    server.addHook('preHandler', async (request) => {
      request.user = { id: 'api-key', username: 'api-key', role: 'admin', currentOrgId: 'org-b', orgScopedApiKey: true };
      // The permissions the key really resolves to (org Owner cap), so the request reaches the org-isolation check.
      (request as unknown as Record<string, unknown>)['permissions'] = new Set(ORG_OWNER_PERMISSIONS);
    });
    await dataApiRoutes(server, storage);
    await server.ready();
    try {
      const res = await server.inject({ method: 'DELETE', url: `/api/v1/scans/${id}` });
      // Before the fix this returned 200 and DELETED the other org's scan (break-tested).
      expect(res.statusCode).toBe(403);
      expect(await storage.scans.getScan(id)).not.toBeNull();
    } finally {
      await server.close();
    }
  });

  it('[EVIDENCE] an org-scoped admin key cannot share, revoke, publish or badge ANOTHER org\'s report (/api/v1/reports/*)', async () => {
    const id = randomUUID();
    await storage.scans.createScan({ id, siteUrl: 'https://other.example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'x', createdAt: new Date().toISOString(), orgId: 'other-org' });
    await storage.scans.updateScan(id, { status: 'completed', completedAt: new Date().toISOString() });
    const share = await storage.reportShares.createShare({ scanId: id, orgId: 'other-org', createdBy: 'x' });

    const server = Fastify({ logger: false });
    server.decorateReply('view', function (this: FastifyReply) { return this.code(200).send('{}'); });
    server.addHook('preHandler', async (request) => {
      request.user = { id: 'api-key', username: 'api-key', role: 'admin', currentOrgId: 'org-b', orgScopedApiKey: true };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set(ORG_OWNER_PERMISSIONS);
    });
    await reportRoutes(server, storage);
    await server.ready();
    try {
      const calls: Array<[string, Record<string, unknown>]> = [
        [`/api/v1/reports/${id}/shares`, {}],
        [`/api/v1/reports/${id}/shares/${share.id}/revoke`, {}],
        [`/api/v1/reports/${id}/public-share`, { enabled: true }],
        [`/api/v1/reports/${id}/site-badge`, { enabled: true }],
      ];
      for (const [url, payload] of calls) {
        const res = await server.inject({ method: 'POST', url, payload });
        expect([403, 404], `${url} -> ${res.statusCode}`).toContain(res.statusCode);
      }
      expect((await storage.reportShares.listForScan(id)).length).toBe(1);
      expect((await storage.reportShares.getShare(share.id))?.revokedAt ?? null).toBeNull();
    } finally {
      await server.close();
    }
  });

  it('[EVIDENCE] bypassesOrgScope: only a global admin bypasses org isolation, never an org-scoped admin key', () => {
    expect(bypassesOrgScope({ role: 'admin' })).toBe(true);
    expect(bypassesOrgScope({ role: 'admin', currentOrgId: 'org-a' })).toBe(true); // global admin who switched org
    expect(bypassesOrgScope({ role: 'admin', currentOrgId: 'org-a', orgScopedApiKey: true })).toBe(false);
    expect(bypassesOrgScope({ role: 'user', currentOrgId: 'org-a' })).toBe(false);
    expect(bypassesOrgScope(undefined)).toBe(false);
  });
});

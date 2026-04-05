/**
 * Integration tests for the /admin/service-connections route plugin
 * (Phase 06 plan 03 task 3).
 *
 * Covers:
 *   1. GET returns all three rows, never leaks clientSecret, includes hasSecret + source
 *   2. GET as non-admin → 403
 *   3. POST /:id persists url/clientId/secret, encrypts at rest, audits, reloads registry
 *   4. POST /:id with empty clientSecret preserves the stored ciphertext (blank-to-keep)
 *   5. POST /:id as non-admin → 403
 *   6. POST /:id/test with mocked fetch success returns { ok: true, latencyMs }
 *   7. POST /:id/test with blank secret and no stored secret → 400 { error: 'no_secret' }
 *   8. POST /:id with invalid :id → 400
 *   9. POST /:id reload failure returns 500 but DB row remains updated
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { SqliteServiceConnectionsRepository } from '../../src/db/sqlite/service-connections-sqlite.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { registerServiceConnectionsRoutes } from '../../src/routes/admin/service-connections.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

const SESSION_SECRET = 'test-session-secret-long-enough-for-key-derivation-xx';
setEncryptionSalt('test-salt-admin-service-connections-route');

const TEST_CONFIG = {
  complianceUrl: 'http://compliance.test',
  complianceClientId: 'cfg-compliance-id',
  complianceClientSecret: 'cfg-compliance-secret',
  brandingUrl: 'http://branding.test',
  brandingClientId: 'cfg-branding-id',
  brandingClientSecret: '',
  llmUrl: 'http://llm.test',
  llmClientId: 'cfg-llm-id',
  llmClientSecret: 'cfg-llm-secret',
};

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  repo: SqliteServiceConnectionsRepository;
  reloadSpy: ReturnType<typeof vi.fn>;
  cleanup: () => Promise<void>;
}

async function createTestServer(
  role: 'admin' | 'viewer' = 'admin',
  options: { reloadImpl?: (serviceId: string) => Promise<void> } = {},
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-admin-svc-conn-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const repo = new SqliteServiceConnectionsRepository(
    storage.getRawDatabase(),
    SESSION_SECRET,
  );

  const reloadSpy = vi.fn(
    options.reloadImpl ?? (async (_id: string) => undefined),
  );

  const fakeRegistry = {
    reload: reloadSpy,
    getComplianceTokenManager: () => null,
    getBrandingTokenManager: () => null,
    getLLMClient: () => null,
    destroyAll: async () => undefined,
  };

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.decorate('serviceClientRegistry', fakeRegistry as any);
  server.decorate('serviceConnectionsRepo', repo);

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testadmin', role };
    const perms =
      role === 'admin'
        ? new Set<string>(ALL_PERMISSION_IDS)
        : new Set<string>(); // viewer has none of the admin perms
    (request as unknown as Record<string, unknown>)['permissions'] = perms;
  });

  await registerServiceConnectionsRoutes(server, storage, TEST_CONFIG);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return { server, storage, repo, reloadSpy, cleanup };
}

// ---------------------------------------------------------------------------
// GET /admin/service-connections
// ---------------------------------------------------------------------------

describe('GET /admin/service-connections', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 200 with three connections, no clientSecret field, hasSecret + source present', async () => {
    ctx = await createTestServer('admin');

    const res = await ctx.server.inject({ method: 'GET', url: '/admin/service-connections' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { connections: Array<Record<string, unknown>> };
    expect(body.connections).toHaveLength(3);

    const serviceIds = body.connections.map((c) => c.serviceId).sort();
    expect(serviceIds).toEqual(['branding', 'compliance', 'llm']);

    // No row contains a clientSecret field — the wire shape strips it.
    for (const row of body.connections) {
      expect(Object.keys(row)).not.toContain('clientSecret');
      expect(row).toHaveProperty('hasSecret');
      expect(row).toHaveProperty('source');
    }

    // Raw JSON string must not contain any of the config secrets.
    const raw = res.payload;
    expect(raw).not.toContain('cfg-compliance-secret');
    expect(raw).not.toContain('cfg-llm-secret');
  });

  it('synthesizes source="config" for services missing from DB', async () => {
    ctx = await createTestServer('admin');
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/service-connections' });
    const body = res.json() as { connections: Array<{ serviceId: string; source: string; hasSecret: boolean }> };
    // All three start missing from DB — all should be source='config'.
    for (const row of body.connections) {
      expect(row.source).toBe('config');
    }
    // Compliance has a cfg secret → hasSecret true; branding cfg secret is '' → false.
    const compliance = body.connections.find((c) => c.serviceId === 'compliance')!;
    const branding = body.connections.find((c) => c.serviceId === 'branding')!;
    expect(compliance.hasSecret).toBe(true);
    expect(branding.hasSecret).toBe(false);
  });

  it('returns source="db" for rows that have been upserted', async () => {
    ctx = await createTestServer('admin');
    await ctx.repo.upsert({
      serviceId: 'compliance',
      url: 'http://db.compliance.test',
      clientId: 'db-cli',
      clientSecret: 'db-secret',
      updatedBy: 'test-user-id',
    });

    const res = await ctx.server.inject({ method: 'GET', url: '/admin/service-connections' });
    const body = res.json() as { connections: Array<{ serviceId: string; source: string; url: string }> };
    const compliance = body.connections.find((c) => c.serviceId === 'compliance')!;
    expect(compliance.source).toBe('db');
    expect(compliance.url).toBe('http://db.compliance.test');
  });

  it('returns 403 for non-admin users', async () => {
    ctx = await createTestServer('viewer');
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/service-connections' });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/service-connections/:id
// ---------------------------------------------------------------------------

describe('POST /admin/service-connections/:id', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('upserts, encrypts the secret at rest, writes audit, calls registry.reload', async () => {
    ctx = await createTestServer('admin');

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: { url: 'http://new.compliance.test', clientId: 'new-cli', clientSecret: 'new-plain-secret' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; connection: { hasSecret: boolean } };
    expect(body.ok).toBe(true);
    expect(body.connection.hasSecret).toBe(true);
    // Response must NOT carry clientSecret
    expect(JSON.stringify(body)).not.toContain('new-plain-secret');

    // Encrypted at rest — raw DB row must not contain the plaintext.
    const raw = ctx.storage
      .getRawDatabase()
      .prepare('SELECT client_secret_encrypted FROM service_connections WHERE service_id = ?')
      .get('compliance') as { client_secret_encrypted: string };
    expect(raw.client_secret_encrypted).not.toBe('');
    expect(raw.client_secret_encrypted).not.toContain('new-plain-secret');

    // Audit log row exists
    const audit = await ctx.storage.audit.query({ action: 'service_connection.update' });
    expect(audit.entries.length).toBeGreaterThanOrEqual(1);
    const entry = audit.entries[0]!;
    expect(entry.resourceId).toBe('compliance');
    expect(entry.actor).toBe('testadmin');
    // Details must not contain the plaintext secret
    expect(JSON.stringify(entry.details ?? {})).not.toContain('new-plain-secret');

    // Registry reload spy called
    expect(ctx.reloadSpy).toHaveBeenCalledWith('compliance');
  });

  it('blank clientSecret preserves the existing stored ciphertext', async () => {
    ctx = await createTestServer('admin');

    // First set a secret
    await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: { url: 'http://step1.test', clientId: 'cli-1', clientSecret: 'original-secret' },
    });
    const before = ctx.storage
      .getRawDatabase()
      .prepare('SELECT client_secret_encrypted FROM service_connections WHERE service_id = ?')
      .get('compliance') as { client_secret_encrypted: string };

    // Now post again with empty clientSecret
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: { url: 'http://step2.test', clientId: 'cli-2', clientSecret: '' },
    });
    expect(res.statusCode).toBe(200);

    const after = ctx.storage
      .getRawDatabase()
      .prepare('SELECT client_secret_encrypted, url, client_id FROM service_connections WHERE service_id = ?')
      .get('compliance') as { client_secret_encrypted: string; url: string; client_id: string };

    expect(after.client_secret_encrypted).toBe(before.client_secret_encrypted); // unchanged
    expect(after.url).toBe('http://step2.test'); // url updated
    expect(after.client_id).toBe('cli-2'); // clientId updated

    const refreshed = await ctx.repo.get('compliance');
    expect(refreshed?.clientSecret).toBe('original-secret'); // decrypts to original
  });

  it('returns 403 for non-admin users', async () => {
    ctx = await createTestServer('viewer');
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: { url: 'http://x.test', clientId: 'x', clientSecret: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for invalid service id', async () => {
    ctx = await createTestServer('admin');
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/not-a-service',
      payload: { url: 'http://x.test', clientId: 'x', clientSecret: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'invalid_service_id' });
  });

  it('returns 500 when registry.reload throws, but DB row remains updated', async () => {
    ctx = await createTestServer('admin', {
      reloadImpl: async () => {
        throw new Error('boom: cannot connect');
      },
    });

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: { url: 'http://failing.test', clientId: 'fail-cli', clientSecret: 'fail-secret' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('reload_failed');

    // DB row should still be updated — the registry failure does not roll back
    const stored = await ctx.repo.get('compliance');
    expect(stored).not.toBeNull();
    expect(stored?.url).toBe('http://failing.test');
    expect(stored?.clientId).toBe('fail-cli');
    expect(stored?.clientSecret).toBe('fail-secret');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/service-connections/:id/test
// ---------------------------------------------------------------------------

describe('POST /admin/service-connections/:id/test', () => {
  let ctx: TestContext;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await ctx.cleanup();
  });

  it('returns { ok: true, latencyMs } when OAuth + /health both succeed', async () => {
    ctx = await createTestServer('admin');

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance/test',
      payload: { url: 'http://probe.test', clientId: 'probe', clientSecret: 'probe-secret' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; latencyMs?: number };
    expect(body.ok).toBe(true);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('returns 400 { error: no_secret } when clientSecret blank and no stored secret', async () => {
    ctx = await createTestServer('admin');

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance/test',
      payload: { url: 'http://probe.test', clientId: 'probe', clientSecret: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'no_secret' });
  });

  it('falls back to stored secret when clientSecret blank and a secret is stored', async () => {
    ctx = await createTestServer('admin');
    await ctx.repo.upsert({
      serviceId: 'compliance',
      url: 'http://stored.test',
      clientId: 'stored-cli',
      clientSecret: 'stored-plain-secret',
      updatedBy: null,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/oauth/token')) {
        const body = (init?.body as string | undefined) ?? '';
        // The stored plaintext secret should be the value POSTed to /oauth/token.
        // Luqen services only accept JSON (no @fastify/formbody), so the body
        // is serialized as `{"client_secret":"stored-plain-secret",...}`.
        expect(body).toContain('"client_secret":"stored-plain-secret"');
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response('ok', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance/test',
      payload: { url: 'http://probe.test', clientId: 'probe', clientSecret: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalled();
  });
});

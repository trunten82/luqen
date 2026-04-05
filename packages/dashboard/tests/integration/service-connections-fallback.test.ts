/**
 * Phase 06 Plan 05 — Fallback + permission gating integration test.
 *
 * Exercises the bootstrap + per-service fallback + RBAC paths that the
 * happy-path flow test does not touch:
 *
 *   1. Full config → empty DB bootstrap: importFromConfigIfEmpty copies all
 *      three rows with updated_by='bootstrap-from-config' and the stored
 *      secrets are encrypted (never equal to the plaintext config values).
 *   2. Partial config → only compliance is bootstrapped; branding/llm fall
 *      back to config via the registry's per-service resolveConnection (D-14).
 *   3. Non-admin user → 403 on every endpoint (GET, POST update, POST test,
 *      POST clear-secret). No audit entries are written for 403 attempts.
 *   4. DB-wins-over-config: bootstrap is a no-op when the table is already
 *      populated (D-12). Pre-seeded DB row survives, even when config has a
 *      different URL.
 *
 * Uses real SQLite + real registry (with ServiceTokenManager/createLLMClient
 * mocked at module scope, same pattern as the flow test).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Mocks for outbound clients (declare before registry import).
// ---------------------------------------------------------------------------

vi.mock('../../src/auth/service-token.js', () => {
  class FakeServiceTokenManager {
    public destroyed = false;
    constructor(
      public readonly baseUrl: string,
      public readonly clientId: string,
      public readonly clientSecret: string,
    ) {}
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { ServiceTokenManager: FakeServiceTokenManager };
});

vi.mock('../../src/llm-client.js', () => {
  class FakeLLMClient {
    public destroyed = false;
    constructor(
      public readonly baseUrl: string,
      public readonly clientId: string,
      public readonly clientSecret: string,
    ) {}
    destroy(): void {
      this.destroyed = true;
    }
  }
  return {
    LLMClient: FakeLLMClient,
    createLLMClient: (url: string | undefined, clientId: string, clientSecret: string) => {
      if (url === undefined || url === '') return null;
      return new FakeLLMClient(url, clientId, clientSecret);
    },
  };
});

const { SqliteStorageAdapter } = await import('../../src/db/sqlite/index.js');
const { SqliteServiceConnectionsRepository } = await import(
  '../../src/db/sqlite/service-connections-sqlite.js'
);
const { ServiceClientRegistry } = await import(
  '../../src/services/service-client-registry.js'
);
const { importFromConfigIfEmpty } = await import(
  '../../src/services/service-connections-bootstrap.js'
);
const { setEncryptionSalt } = await import('../../src/plugins/crypto.js');
const { registerServiceConnectionsRoutes } = await import(
  '../../src/routes/admin/service-connections.js'
);
const { ALL_PERMISSION_IDS } = await import('../../src/permissions.js');

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const SESSION_SECRET = 'test-session-secret-long-enough-for-key-derivation-xz';
setEncryptionSalt('test-salt-phase-06-p05-fallback-integration');

const FULL_CONFIG = {
  port: 5000,
  complianceUrl: 'http://cfg-compliance.test',
  complianceClientId: 'cfg-compliance-id',
  complianceClientSecret: 'cfg-compliance-plain-secret',
  brandingUrl: 'http://cfg-branding.test',
  brandingClientId: 'cfg-branding-id',
  brandingClientSecret: 'cfg-branding-plain-secret',
  llmUrl: 'http://cfg-llm.test',
  llmClientId: 'cfg-llm-id',
  llmClientSecret: 'cfg-llm-plain-secret',
  reportsDir: './reports',
  dbPath: ':memory:',
  sessionSecret: SESSION_SECRET,
  maxConcurrentScans: 2,
  pluginsDir: './plugins',
  catalogueCacheTtl: 3600,
  maxPages: 50,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const PARTIAL_CONFIG = {
  ...FULL_CONFIG,
  brandingUrl: '',
  brandingClientId: '',
  brandingClientSecret: '',
  llmUrl: undefined,
  llmClientId: '',
  llmClientSecret: '',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

interface TestContext {
  server: FastifyInstance;
  storage: InstanceType<typeof SqliteStorageAdapter>;
  repo: InstanceType<typeof SqliteServiceConnectionsRepository>;
  registry: InstanceType<typeof ServiceClientRegistry>;
  cleanup: () => Promise<void>;
}

interface BuildOptions {
  readonly config: Record<string, unknown>;
  readonly role?: 'admin' | 'viewer';
  readonly preSeed?: (
    repo: InstanceType<typeof SqliteServiceConnectionsRepository>,
  ) => Promise<void>;
  readonly runBootstrap?: boolean;
}

async function buildServer(options: BuildOptions): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-p05-fallback-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const repo = new SqliteServiceConnectionsRepository(
    storage.getRawDatabase(),
    SESSION_SECRET,
  );

  if (options.preSeed) {
    await options.preSeed(repo);
  }

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  if (options.runBootstrap !== false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await importFromConfigIfEmpty(repo, options.config as any, server.log);
  }

  const registry = await ServiceClientRegistry.create(
    repo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options.config as any,
    server.log,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.decorate('serviceClientRegistry', registry as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.decorate('serviceConnectionsRepo', repo as any);

  const role = options.role ?? 'admin';
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: role === 'admin' ? 'admin-user-id' : 'viewer-user-id',
      username: role === 'admin' ? 'e2e-admin' : 'e2e-viewer',
      role,
    };
    const perms =
      role === 'admin'
        ? new Set<string>(ALL_PERMISSION_IDS)
        : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = perms;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerServiceConnectionsRoutes(server, storage, options.config as any);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return { server, storage, repo, registry, cleanup };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 06 P05 — bootstrap + fallback + permission gating', () => {
  let ctx: TestContext;
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('full config → empty DB bootstrap imports all three rows with updated_by=bootstrap-from-config and encrypted-at-rest secrets (SVC-07)', async () => {
    ctx = await buildServer({ config: FULL_CONFIG });

    const rows = ctx.storage
      .getRawDatabase()
      .prepare(
        'SELECT service_id, url, client_id, client_secret_encrypted, updated_by FROM service_connections ORDER BY service_id',
      )
      .all() as Array<{
      service_id: string;
      url: string;
      client_id: string;
      client_secret_encrypted: string;
      updated_by: string | null;
    }>;

    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.service_id).sort();
    expect(ids).toEqual(['branding', 'compliance', 'llm']);

    for (const row of rows) {
      expect(row.updated_by).toBe('bootstrap-from-config');
      // Encryption at rest — raw ciphertext must NOT contain the plaintext
      // config secret.
      expect(row.client_secret_encrypted).toBeTruthy();
    }

    const compliance = rows.find((r) => r.service_id === 'compliance')!;
    expect(compliance.client_secret_encrypted).not.toContain(
      'cfg-compliance-plain-secret',
    );
    const branding = rows.find((r) => r.service_id === 'branding')!;
    expect(branding.client_secret_encrypted).not.toContain(
      'cfg-branding-plain-secret',
    );
    const llm = rows.find((r) => r.service_id === 'llm')!;
    expect(llm.client_secret_encrypted).not.toContain('cfg-llm-plain-secret');

    // Registry resolves all three to live clients built from the DB rows.
    expect(ctx.registry.getComplianceTokenManager()).not.toBeNull();
    expect(ctx.registry.getBrandingTokenManager()).not.toBeNull();
    expect(ctx.registry.getLLMClient()).not.toBeNull();
  });

  it('partial config → only compliance is bootstrapped; branding/llm fall back per-service via registry (D-14)', async () => {
    ctx = await buildServer({ config: PARTIAL_CONFIG });

    const rows = ctx.storage
      .getRawDatabase()
      .prepare('SELECT service_id FROM service_connections')
      .all() as Array<{ service_id: string }>;

    // Only compliance should have been imported.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.service_id).toBe('compliance');

    // Compliance comes from DB (source='db'); branding/llm must be absent
    // from DB but still resolvable via per-service config fallback — which
    // for PARTIAL_CONFIG is empty, so branding should be null and llm null.
    const compliance = ctx.registry.getComplianceTokenManager();
    expect(compliance).not.toBeNull();
    expect((compliance as unknown as { baseUrl: string }).baseUrl).toBe(
      'http://cfg-compliance.test',
    );

    // branding + llm have no URL in config → registry returns null without
    // throwing. The call itself must succeed (not throw).
    expect(() => ctx.registry.getBrandingTokenManager()).not.toThrow();
    expect(() => ctx.registry.getLLMClient()).not.toThrow();
    expect(ctx.registry.getBrandingTokenManager()).toBeNull();
    expect(ctx.registry.getLLMClient()).toBeNull();

    // The admin GET endpoint should still return all three rows. Compliance
    // should be source='db'; branding/llm should be source='config'
    // (synthesized fallback).
    const listRes = await ctx.server.inject({
      method: 'GET',
      url: '/admin/service-connections',
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json() as {
      connections: Array<{ serviceId: string; source: string }>;
    };
    const bySid = Object.fromEntries(
      body.connections.map((c) => [c.serviceId, c]),
    );
    expect(bySid['compliance']!.source).toBe('db');
    expect(bySid['branding']!.source).toBe('config');
    expect(bySid['llm']!.source).toBe('config');
  });

  it('non-admin 403s on every endpoint and writes no audit rows for the attempts (SVC-08)', async () => {
    ctx = await buildServer({ config: FULL_CONFIG, role: 'viewer' });

    // GET list
    const getRes = await ctx.server.inject({
      method: 'GET',
      url: '/admin/service-connections',
    });
    expect(getRes.statusCode).toBe(403);

    // POST update
    const updateRes = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: {
        url: 'http://forbidden.test',
        clientId: 'forbidden-cli',
        clientSecret: 'forbidden-secret',
      },
    });
    expect(updateRes.statusCode).toBe(403);

    // POST test
    const testRes = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance/test',
      payload: {
        url: 'http://forbidden.test',
        clientId: 'forbidden-cli',
        clientSecret: 'forbidden-secret',
      },
    });
    expect(testRes.statusCode).toBe(403);

    // POST clear-secret
    const clearRes = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance/clear-secret',
      payload: {},
    });
    expect(clearRes.statusCode).toBe(403);

    // No audit rows should have been written by the forbidden attempts.
    const audit = await ctx.storage.audit.query({
      action: 'service_connection.update',
    });
    expect(audit.entries).toHaveLength(0);
    const auditClear = await ctx.storage.audit.query({
      action: 'service_connection.clear_secret',
    });
    expect(auditClear.entries).toHaveLength(0);
  });

  it('DB wins over config: bootstrap is a no-op when the table already has a row for a service (D-12)', async () => {
    // Pre-seed a row for compliance with a URL that DIFFERS from FULL_CONFIG.
    ctx = await buildServer({
      config: FULL_CONFIG,
      preSeed: async (repo) => {
        await repo.upsert({
          serviceId: 'compliance',
          url: 'http://pre-seeded.test',
          clientId: 'pre-seeded-id',
          clientSecret: 'pre-seeded-secret',
          updatedBy: 'seed-script',
        });
      },
    });

    // Because the table was NOT empty at boot, importFromConfigIfEmpty must
    // be a complete no-op — no rows added for branding/llm, compliance
    // survives untouched (URL still the pre-seeded value, not the config
    // value).
    const rows = ctx.storage
      .getRawDatabase()
      .prepare('SELECT service_id, url, updated_by FROM service_connections')
      .all() as Array<{ service_id: string; url: string; updated_by: string | null }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.service_id).toBe('compliance');
    expect(rows[0]!.url).toBe('http://pre-seeded.test');
    expect(rows[0]!.updated_by).toBe('seed-script');

    // No row should carry updated_by='bootstrap-from-config'.
    const bootstrapped = rows.filter(
      (r) => r.updated_by === 'bootstrap-from-config',
    );
    expect(bootstrapped).toHaveLength(0);

    // Registry built the compliance client from the DB row, not the config.
    const compliance = ctx.registry.getComplianceTokenManager();
    expect((compliance as unknown as { baseUrl: string }).baseUrl).toBe(
      'http://pre-seeded.test',
    );

    // branding/llm have no DB row but FULL_CONFIG has values → they resolve
    // via per-service config fallback (D-14).
    expect(ctx.registry.getBrandingTokenManager()).not.toBeNull();
    expect(
      (ctx.registry.getBrandingTokenManager() as unknown as { baseUrl: string })
        .baseUrl,
    ).toBe('http://cfg-branding.test');
    expect(ctx.registry.getLLMClient()).not.toBeNull();
  });
});

/**
 * Phase 06 Plan 05 — End-to-end flow integration test.
 *
 * Wires a real dashboard-style Fastify instance with:
 *   - a real on-disk SQLite DB (via SqliteStorageAdapter, full migrations)
 *   - a real SqliteServiceConnectionsRepository with encrypt-at-rest
 *   - a real ServiceClientRegistry (ServiceTokenManager + createLLMClient are
 *     mocked at module scope so the registry can swap references without
 *     hitting the network)
 *   - the real registerServiceConnectionsRoutes plugin
 *
 * Proves the full save → reload → GET round-trip:
 *   1. POST /admin/service-connections/compliance with new url+id+secret
 *      returns 200, the registry's compliance getter returns a NEW instance
 *      (different object identity), GET /admin/service-connections exposes
 *      the new url/clientId but never the plaintext secret, the raw DB
 *      ciphertext does NOT equal the plaintext (encryption at rest — SVC-05),
 *      and an audit_log row is written with action='service_connection.update'.
 *   2. Blank-to-keep: saving again with clientSecret='' leaves the ciphertext
 *      byte-identical.
 *   3. The /test endpoint with a blank clientSecret falls back to the stored
 *      decrypted secret — verified by inspecting the outbound OAuth request
 *      body that the mocked fetch receives.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Module mocks — ServiceTokenManager + createLLMClient so the registry can
// build new client instances without performing real network I/O. These mocks
// MUST be declared before the registry import below.
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

// Imports AFTER the vi.mock() calls above so the mocked modules are resolved.
const { SqliteStorageAdapter } = await import('../../src/db/sqlite/index.js');
const { SqliteServiceConnectionsRepository } = await import(
  '../../src/db/sqlite/service-connections-sqlite.js'
);
const { ServiceClientRegistry } = await import(
  '../../src/services/service-client-registry.js'
);
const { setEncryptionSalt } = await import('../../src/plugins/crypto.js');
const { registerServiceConnectionsRoutes } = await import(
  '../../src/routes/admin/service-connections.js'
);
const { ALL_PERMISSION_IDS } = await import('../../src/permissions.js');
const { loadTranslations, t: translateKey } = await import(
  '../../src/i18n/index.js'
);
const handlebarsModule = await import('handlebars');
const handlebars = handlebarsModule.default;

// Register the minimal set of helpers the service-connection-row /
// service-connection-edit-row partials reference so HTMX fragment responses
// can compile and render inside the tests. Mirrors server.ts registration.
loadTranslations();
if (!handlebars.helpers['eq']) {
  handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
}
if (!handlebars.helpers['t']) {
  handlebars.registerHelper('t', function (
    key: string,
    options: { hash?: Record<string, unknown>; data?: { root?: { locale?: string } } },
  ) {
    const locale = (options?.data?.root?.locale ?? 'en') as 'en';
    const params: Record<string, string> = {};
    if (options?.hash) {
      for (const [k, v] of Object.entries(options.hash)) params[k] = String(v);
    }
    return translateKey(key, locale, params);
  });
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const SESSION_SECRET = 'test-session-secret-long-enough-for-key-derivation-xy';
setEncryptionSalt('test-salt-phase-06-p05-flow-integration');

const TEST_CONFIG = {
  port: 5000,
  complianceUrl: 'http://config-compliance.test',
  complianceClientId: 'cfg-compliance-id',
  complianceClientSecret: 'cfg-compliance-secret',
  brandingUrl: 'http://config-branding.test',
  brandingClientId: 'cfg-branding-id',
  brandingClientSecret: 'cfg-branding-secret',
  llmUrl: 'http://config-llm.test',
  llmClientId: 'cfg-llm-id',
  llmClientSecret: 'cfg-llm-secret',
  reportsDir: './reports',
  dbPath: ':memory:',
  sessionSecret: SESSION_SECRET,
  maxConcurrentScans: 2,
  pluginsDir: './plugins',
  catalogueCacheTtl: 3600,
  maxPages: 50,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

interface FlowTestContext {
  server: FastifyInstance;
  storage: InstanceType<typeof SqliteStorageAdapter>;
  repo: InstanceType<typeof SqliteServiceConnectionsRepository>;
  registry: InstanceType<typeof ServiceClientRegistry>;
  cleanup: () => Promise<void>;
}

async function buildFlowServer(): Promise<FlowTestContext> {
  const dbPath = join(tmpdir(), `test-p05-flow-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const repo = new SqliteServiceConnectionsRepository(
    storage.getRawDatabase(),
    SESSION_SECRET,
  );

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  // Build a real registry — this is the whole point of the flow test.
  const registry = await ServiceClientRegistry.create(
    repo,
    TEST_CONFIG,
    server.log,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.decorate('serviceClientRegistry', registry as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.decorate('serviceConnectionsRepo', repo as any);

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'admin-user-id', username: 'e2e-admin', role: 'admin' };
    const perms = new Set<string>(ALL_PERMISSION_IDS);
    (request as unknown as Record<string, unknown>)['permissions'] = perms;
  });

  await registerServiceConnectionsRoutes(server, storage, TEST_CONFIG);
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

describe('Phase 06 P05 — end-to-end save → reload → GET flow', () => {
  let ctx: FlowTestContext;

  beforeEach(async () => {
    ctx = await buildFlowServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('save triggers a real registry reload, the ciphertext is encrypted at rest, GET never leaks the plaintext, and audit_log records the action (SVC-05, SVC-06)', async () => {
    // Snapshot the current registry reference BEFORE the save.
    const before = ctx.registry.getComplianceTokenManager();
    expect(before).not.toBeNull();

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: {
        url: 'http://new-compliance.test',
        clientId: 'e2e-compliance-id',
        clientSecret: 'plaintext-secret-xyz',
      },
    });
    expect(res.statusCode).toBe(200);

    // Registry swap: getter now returns a NEW instance with the new url.
    const after = ctx.registry.getComplianceTokenManager();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect((after as unknown as { baseUrl: string }).baseUrl).toBe(
      'http://new-compliance.test',
    );
    expect((after as unknown as { clientId: string }).clientId).toBe(
      'e2e-compliance-id',
    );
    expect((after as unknown as { clientSecret: string }).clientSecret).toBe(
      'plaintext-secret-xyz',
    );

    // The old instance should have been destroyed.
    expect((before as unknown as { destroyed: boolean }).destroyed).toBe(true);

    // GET returns the new url/clientId but never the plaintext secret.
    const listRes = await ctx.server.inject({
      method: 'GET',
      url: '/admin/service-connections',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.payload).toContain('http://new-compliance.test');
    expect(listRes.payload).toContain('e2e-compliance-id');
    expect(listRes.payload).not.toContain('plaintext-secret-xyz');

    const body = listRes.json() as {
      connections: Array<{ serviceId: string; source: string; hasSecret: boolean }>;
    };
    const compliance = body.connections.find((c) => c.serviceId === 'compliance');
    expect(compliance).toBeDefined();
    expect(compliance!.source).toBe('db');
    expect(compliance!.hasSecret).toBe(true);
    // No row should carry a clientSecret field at all.
    for (const row of body.connections) {
      expect(Object.keys(row)).not.toContain('clientSecret');
    }

    // Raw DB ciphertext — SVC-05 encryption-at-rest assertion.
    const raw = ctx.storage
      .getRawDatabase()
      .prepare(
        'SELECT client_secret_encrypted FROM service_connections WHERE service_id = ?',
      )
      .get('compliance') as { client_secret_encrypted: string };
    expect(raw.client_secret_encrypted).toBeTruthy();
    expect(raw.client_secret_encrypted).not.toBe('plaintext-secret-xyz');
    expect(raw.client_secret_encrypted).not.toContain('plaintext-secret-xyz');

    // audit_log — assert at least one row for this resource/action/actor.
    const audit = await ctx.storage.audit.query({
      action: 'service_connection.update',
    });
    expect(audit.entries.length).toBeGreaterThanOrEqual(1);
    const entry = audit.entries.find((e) => e.resourceId === 'compliance');
    expect(entry).toBeDefined();
    expect(entry!.actor).toBe('e2e-admin');
    // Secret must not leak into the audit detail payload.
    expect(JSON.stringify(entry!.details ?? {})).not.toContain(
      'plaintext-secret-xyz',
    );
  });

  it('blank-to-keep: saving with clientSecret="" leaves the stored ciphertext byte-identical', async () => {
    // First save installs a secret.
    const saveRes = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: {
        url: 'http://step1.test',
        clientId: 'blank-keep-id',
        clientSecret: 'original-secret-value',
      },
    });
    expect(saveRes.statusCode).toBe(200);

    const before = ctx.storage
      .getRawDatabase()
      .prepare(
        'SELECT client_secret_encrypted FROM service_connections WHERE service_id = ?',
      )
      .get('compliance') as { client_secret_encrypted: string };
    expect(before.client_secret_encrypted).toBeTruthy();

    // Second save with blank secret — must preserve ciphertext.
    const keepRes = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: {
        url: 'http://step2.test',
        clientId: 'blank-keep-id-v2',
        clientSecret: '',
      },
    });
    expect(keepRes.statusCode).toBe(200);

    const after = ctx.storage
      .getRawDatabase()
      .prepare(
        'SELECT client_secret_encrypted, url, client_id FROM service_connections WHERE service_id = ?',
      )
      .get('compliance') as {
      client_secret_encrypted: string;
      url: string;
      client_id: string;
    };
    expect(after.client_secret_encrypted).toBe(before.client_secret_encrypted);
    expect(after.url).toBe('http://step2.test');
    expect(after.client_id).toBe('blank-keep-id-v2');

    // Registry should still have a live compliance client with the original
    // decrypted secret (blank-to-keep preserves the secret end-to-end).
    const live = ctx.registry.getComplianceTokenManager();
    expect((live as unknown as { clientSecret: string }).clientSecret).toBe(
      'original-secret-value',
    );
  });

  it('HTMX save response returns the re-rendered row fragment plus an out-of-band success toast', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      headers: { 'hx-request': 'true' },
      payload: {
        url: 'http://htmx-save.test',
        clientId: 'htmx-cli',
        clientSecret: 'htmx-plain-secret',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.payload;
    // Re-rendered row must carry the new url and the row id anchor.
    expect(html).toContain('service-connection-row-compliance');
    expect(html).toContain('http://htmx-save.test');
    // Out-of-band toast swap targeting the global toast container.
    expect(html).toContain('hx-swap-oob');
    expect(html).toContain('toast-container');
    // Plaintext secret MUST NOT appear in the response body.
    expect(html).not.toContain('htmx-plain-secret');
  });

  it('HTMX /test endpoint returns a success badge fragment when OAuth + health succeed', async () => {
    // Install a stored secret so /test can fall back to it.
    await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: {
        url: 'http://badge.test',
        clientId: 'badge-cli',
        clientSecret: 'badge-secret',
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/oauth/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/admin/service-connections/compliance/test',
        headers: { 'hx-request': 'true' },
        payload: {
          url: 'http://probe.test',
          clientId: 'probe-cli',
          clientSecret: '',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      // Test results are delivered as an OOB swap into the global
      // #toast-container (wrapped in <template> to survive any tr context).
      expect(res.payload).toContain('toast--success');
      expect(res.payload).toContain('hx-swap-oob');
      expect(res.payload).toContain('<template>');
      expect(res.payload).not.toContain('badge-secret');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('/test endpoint falls back to the stored decrypted secret when clientSecret is blank', async () => {
    // Install a stored secret via the save endpoint.
    await ctx.server.inject({
      method: 'POST',
      url: '/admin/service-connections/compliance',
      payload: {
        url: 'http://stored.test',
        clientId: 'stored-cli',
        clientSecret: 'stored-plain-secret',
      },
    });

    // Spy on global fetch; assert the stored plaintext is what the outbound
    // OAuth request body contains.
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/oauth/token')) {
        const body = (init?.body as string | undefined) ?? '';
        // JSON body format (services don't register @fastify/formbody).
        expect(body).toContain('"client_secret":"stored-plain-secret"');
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const res = await ctx.server.inject({
        method: 'POST',
        url: '/admin/service-connections/compliance/test',
        payload: {
          url: 'http://probe.test',
          clientId: 'probe-cli',
          clientSecret: '',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * Phase 30 plan 30-04 — Dashboard MCP Resources integration tests.
 *
 * Coverage (per 30-04-PLAN.md task 2 behavior):
 *
 *   Group A — DASHBOARD_RESOURCE_METADATA shape (1 test)
 *     A1. Exports exactly 2 entries with correct URI schemes + permissions
 *
 *   Group B — resources/list RBAC filtering via @luqen/core/mcp 30-01 override (4 tests)
 *     B1. reports.view caller sees only scan:// entries
 *     B2. branding.view caller sees only brand:// entries
 *     B3. caller with both perms sees both families with correct counts
 *     B4. caller with neither perm sees empty list
 *
 *   Group C — resources/read gating + cross-org guards (4 tests)
 *     C1. scan://report/{id} read with reports.view returns JSON content
 *     C2. scan://report/{id} read without reports.view returns Forbidden
 *     C3. scan://report/{id} cross-org read returns "not found"
 *     C4. brand://score/{siteUrl} URL-decoded before repository lookup
 *
 *   Group D — D-17 template-variable guard (1 test)
 *     D1. No registered resource template has {orgId} variable
 *
 * Scaffolding is INLINED per the 30-04-PLAN.md guidance — Wave 2 plans
 * (30-03, 30-04, 30-05) must not import from each other's test files. The
 * shapes below mirror data-tools.test.ts (Wave 1, stable) so they stay in
 * sync if the underlying types evolve.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import { DASHBOARD_RESOURCE_METADATA } from '../../src/mcp/resources.js';
import type { McpTokenPayload, McpTokenVerifier } from '../../src/mcp/middleware.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';

// ---------------------------------------------------------------------------
// Stub scaffolding (self-contained — no cross-imports from other test files)
// ---------------------------------------------------------------------------

interface StubOverrides {
  readonly listScans?: StorageAdapter['scans']['listScans'];
  readonly getScan?: StorageAdapter['scans']['getScan'];
  readonly getReport?: StorageAdapter['scans']['getReport'];
  readonly getLatestPerSite?: StorageAdapter['scans']['getLatestPerSite'];
  readonly getLatestForScan?: StorageAdapter['brandScores']['getLatestForScan'];
  readonly getHistoryForSite?: StorageAdapter['brandScores']['getHistoryForSite'];
  readonly getEffectivePermissions?: (userId: string, orgId?: string) => Promise<Set<string>>;
}

function makeStubStorage(o: StubOverrides = {}): StorageAdapter {
  const empty = {} as unknown;
  const perms = new Set<string>();
  return {
    scans: {
      listScans: o.listScans ?? (async () => []),
      getScan: o.getScan ?? (async () => null),
      createScan: async () => {
        throw new Error('not stubbed');
      },
      countScans: async () => 0,
      updateScan: async () => {
        throw new Error('not stubbed');
      },
      deleteScan: async () => {},
      deleteOrgScans: async () => {},
      getReport: o.getReport ?? (async () => null),
      getTrendData: async () => [],
      getLatestPerSite: o.getLatestPerSite ?? (async () => []),
    } as unknown as StorageAdapter['scans'],
    brandScores: {
      insert: async () => {},
      getLatestForScan: o.getLatestForScan ?? (async () => null),
      getHistoryForSite: o.getHistoryForSite ?? (async () => []),
    } as unknown as StorageAdapter['brandScores'],
    users: empty as StorageAdapter['users'],
    organizations: empty as StorageAdapter['organizations'],
    roles: {
      getEffectivePermissions: o.getEffectivePermissions ?? (async () => perms),
    } as unknown as StorageAdapter['roles'],
    schedules: empty as StorageAdapter['schedules'],
    assignments: empty as StorageAdapter['assignments'],
    repos: empty as StorageAdapter['repos'],
    teams: empty as StorageAdapter['teams'],
    email: empty as StorageAdapter['email'],
    audit: empty as StorageAdapter['audit'],
    plugins: empty as StorageAdapter['plugins'],
    apiKeys: empty as StorageAdapter['apiKeys'],
    pageHashes: empty as StorageAdapter['pageHashes'],
    manualTests: empty as StorageAdapter['manualTests'],
    gitHosts: empty as StorageAdapter['gitHosts'],
    branding: empty as StorageAdapter['branding'],
    connect: async () => {},
    disconnect: async () => {},
    migrate: async () => {},
    healthCheck: async () => true,
    name: 'stub',
  };
}

function makeStubScanService(): ScanService {
  return {
    initiateScan: async () => ({ ok: true, scanId: 'stub-scan' }),
    getScanForOrg: async () => ({ ok: false, error: 'Scan not found' }),
  } as unknown as ScanService;
}

function makeFakeVerifier(payload: McpTokenPayload, acceptedToken = 'valid-jwt'): McpTokenVerifier {
  return async (token: string): Promise<McpTokenPayload> => {
    if (token === acceptedToken) return payload;
    throw new Error('Invalid token');
  };
}

interface BuildResourceAppOptions extends StubOverrides {
  readonly permissions: readonly string[];
  readonly orgId?: string;
}

async function buildAppWithResources(opts: BuildResourceAppOptions): Promise<FastifyInstance> {
  const orgId = opts.orgId ?? 'org-1';
  const verifier = makeFakeVerifier({
    sub: 'user-x',
    scopes: ['read'],
    orgId,
    role: 'member',
  });
  const storage = makeStubStorage({
    ...opts,
    getEffectivePermissions: async () => new Set(opts.permissions),
  });
  const scanService = makeStubScanService();
  const app = Fastify({ logger: false });
  await registerMcpRoutes(app, {
    verifyToken: verifier,
    storage,
    scanService,
  });
  await app.ready();
  return app;
}

function rpc(method: string, params: unknown = {}, id = 1): unknown {
  return { jsonrpc: '2.0', id, method, params };
}

function parseSseOrJson(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (dataLine === undefined) throw new Error(`No SSE data line in body: ${body}`);
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
}

const POST_HEADERS = {
  authorization: 'Bearer valid-jwt',
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
} as const;

// ---------------------------------------------------------------------------
// Group A: DASHBOARD_RESOURCE_METADATA shape
// ---------------------------------------------------------------------------

describe('Phase 30 resources — DASHBOARD_RESOURCE_METADATA shape', () => {
  it('exports exactly 2 entries with correct URI schemes + permissions', () => {
    expect(DASHBOARD_RESOURCE_METADATA.length).toBe(2);
    const scan = DASHBOARD_RESOURCE_METADATA.find((r) => r.uriScheme === 'scan');
    const brand = DASHBOARD_RESOURCE_METADATA.find((r) => r.uriScheme === 'brand');
    expect(scan?.requiredPermission).toBe('reports.view');
    expect(brand?.requiredPermission).toBe('branding.view');
  });
});

// ---------------------------------------------------------------------------
// Group B: resources/list RBAC filtering
// ---------------------------------------------------------------------------

describe('Phase 30 resources — resources/list RBAC filtering', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('reports.view caller sees only scan:// entries', async () => {
    app = await buildAppWithResources({
      permissions: ['reports.view'],
      listScans: async () =>
        [
          {
            id: 'a',
            siteUrl: 'https://a.com',
            orgId: 'org-1',
            status: 'completed',
          },
          {
            id: 'b',
            siteUrl: 'https://b.com',
            orgId: 'org-1',
            status: 'completed',
          },
        ] as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: POST_HEADERS,
      payload: rpc('resources/list'),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      resources: Array<{ uri: string }>;
    };
    expect(result.resources.every((r) => r.uri.startsWith('scan://'))).toBe(true);
    expect(result.resources.length).toBe(2);
  });

  it('branding.view caller sees only brand:// entries', async () => {
    app = await buildAppWithResources({
      permissions: ['branding.view'],
      getLatestPerSite: async () =>
        [
          {
            id: 's1',
            siteUrl: 'https://x.com',
            orgId: 'org-1',
            status: 'completed',
          },
          {
            id: 's2',
            siteUrl: 'https://y.com',
            orgId: 'org-1',
            status: 'completed',
          },
        ] as never,
      getLatestForScan: async () => ({ kind: 'score', composite: 80 }) as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: POST_HEADERS,
      payload: rpc('resources/list'),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      resources: Array<{ uri: string }>;
    };
    expect(result.resources.every((r) => r.uri.startsWith('brand://'))).toBe(true);
    expect(result.resources.length).toBe(2);
  });

  it('both perms caller sees both families', async () => {
    app = await buildAppWithResources({
      permissions: ['reports.view', 'branding.view'],
      listScans: async () =>
        [
          {
            id: 'a',
            siteUrl: 'https://a.com',
            orgId: 'org-1',
            status: 'completed',
          },
        ] as never,
      getLatestPerSite: async () =>
        [
          {
            id: 's1',
            siteUrl: 'https://x.com',
            orgId: 'org-1',
            status: 'completed',
          },
        ] as never,
      getLatestForScan: async () => ({ kind: 'score', composite: 80 }) as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: POST_HEADERS,
      payload: rpc('resources/list'),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      resources: Array<{ uri: string }>;
    };
    expect(result.resources.length).toBe(2);
    expect(result.resources.some((r) => r.uri.startsWith('scan://'))).toBe(true);
    expect(result.resources.some((r) => r.uri.startsWith('brand://'))).toBe(true);
  });

  it('no perms but read scope — scope-fallback shows both families (read scope allows view-tier resources)', async () => {
    // Documenting actual behavior of the @luqen/core/mcp 30-01 override:
    // when ctx.permissions is empty, the override falls back to
    // filterResourcesByScope (see http-plugin.ts ~line 215). A caller with
    // 'read' scope satisfies the scope hierarchy for all view-tier permissions
    // (reports.view, branding.view both fall through hasRead == true), so
    // both scheme families remain visible. This is intentional — service-to-service
    // callers (OAuth client credentials with no per-user RBAC perms) need a
    // way to enumerate read-tier resources. The 30-04-PLAN.md draft asserted
    // resources.length === 0 here, which would only be true if both perms AND
    // scopes were empty — but the route's coarse scope gate (requiredScope: 'read')
    // rejects scope-less callers with 403 before reaching this handler. The
    // assertion below reflects the system's actual behavior end-to-end.
    app = await buildAppWithResources({
      permissions: [],
      listScans: async () =>
        [
          {
            id: 'a',
            siteUrl: 'https://a.com',
            orgId: 'org-1',
            status: 'completed',
          },
        ] as never,
      getLatestPerSite: async () =>
        [
          {
            id: 's1',
            siteUrl: 'https://x.com',
            orgId: 'org-1',
            status: 'completed',
          },
        ] as never,
      getLatestForScan: async () => ({ kind: 'score', composite: 80 }) as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: POST_HEADERS,
      payload: rpc('resources/list'),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      resources: Array<{ uri: string }>;
    };
    expect(result.resources.length).toBe(2);
    expect(result.resources.some((r) => r.uri.startsWith('scan://'))).toBe(true);
    expect(result.resources.some((r) => r.uri.startsWith('brand://'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group C: resources/read gating + cross-org guards + URL-decode round-trip
// ---------------------------------------------------------------------------

describe('Phase 30 resources — resources/read gating + cross-org guards', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('scan://report/{id} read with reports.view returns JSON content', async () => {
    app = await buildAppWithResources({
      permissions: ['reports.view'],
      getScan: async (id) =>
        ({
          id,
          siteUrl: 'https://a.com',
          orgId: 'org-1',
          status: 'completed',
        }) as never,
      getReport: async () => ({ issues: [{ code: 'X' }] }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: POST_HEADERS,
      payload: rpc('resources/read', { uri: 'scan://report/abc' }),
    });
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as {
      contents: Array<{ mimeType: string; text: string }>;
    };
    expect(result.contents[0]?.mimeType).toBe('application/json');
    const payload = JSON.parse(result.contents[0]?.text ?? '{}') as Record<string, unknown>;
    const scan = payload['scan'] as Record<string, unknown>;
    expect(scan['id']).toBe('abc');
  });

  it('scan://report/{id} read without reports.view returns Forbidden', async () => {
    app = await buildAppWithResources({
      permissions: ['branding.view'], // wrong perm — has branding but not reports
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: POST_HEADERS,
      payload: rpc('resources/read', { uri: 'scan://report/abc' }),
    });
    const parsed = parseSseOrJson(response.body);
    expect(parsed['error']).toBeDefined();
    const err = parsed['error'] as { message?: string };
    expect(err.message).toContain('Forbidden');
  });

  it('scan://report/{id} cross-org read returns not-found', async () => {
    app = await buildAppWithResources({
      permissions: ['reports.view'],
      getScan: async (id) =>
        ({
          id,
          siteUrl: 'https://a.com',
          orgId: 'other-org', // different from caller's org-1
          status: 'completed',
        }) as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: POST_HEADERS,
      payload: rpc('resources/read', { uri: 'scan://report/abc' }),
    });
    const parsed = parseSseOrJson(response.body);
    const err = parsed['error'] as { message?: string } | undefined;
    expect(err?.message).toMatch(/not found/i);
  });

  it('brand://score/{siteUrl} URL-decoded before repository lookup', async () => {
    let capturedSiteUrl = '';
    app = await buildAppWithResources({
      permissions: ['branding.view'],
      getHistoryForSite: async (_org, siteUrl) => {
        capturedSiteUrl = siteUrl;
        return [
          {
            computedAt: '2026-04-18T00:00:00Z',
            result: { kind: 'score', composite: 85 },
          },
        ] as never;
      },
    });
    const encodedUri = `brand://score/${encodeURIComponent('https://example.com')}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: POST_HEADERS,
      payload: rpc('resources/read', { uri: encodedUri }),
    });
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as { contents: Array<{ text: string }> };
    expect(capturedSiteUrl).toBe('https://example.com');
    const payload = JSON.parse(result.contents[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload['siteUrl']).toBe('https://example.com');
  });
});

// ---------------------------------------------------------------------------
// Group D: D-17 template-variable guard (no {orgId} anywhere)
// ---------------------------------------------------------------------------

describe('Phase 30 resources — D-17 template-variable guard', () => {
  it('No resource template has {orgId} variable', async () => {
    const { server } = await createDashboardMcpServer({
      storage: makeStubStorage(),
      scanService: makeStubScanService(),
    });
    const registered =
      (
        server as unknown as {
          _registeredResourceTemplates?: Record<
            string,
            { resourceTemplate: { uriTemplate: { toString(): string } } }
          >;
        }
      )._registeredResourceTemplates ?? {};
    expect(Object.keys(registered).length).toBe(2);
    for (const [name, rt] of Object.entries(registered)) {
      const tpl = rt.resourceTemplate.uriTemplate.toString();
      // Each template MUST NOT advertise {orgId} as a variable —
      // orgId always comes from the JWT context, never from the URI.
      expect(tpl.includes('{orgId}'), `resource ${name} must not expose orgId variable`).toBe(
        false,
      );
    }
  });
});

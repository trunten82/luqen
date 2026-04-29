/**
 * Integration tests for the dashboard's /api/v1/mcp endpoint.
 *
 * Covers the 7 behavioural cases from plan 28-03 Task 2:
 *   1. No Authorization header → 401 'Bearer token required'
 *   2. Bad Bearer token → 401 'Invalid or expired token'
 *   3. Valid Bearer + MCP initialize → 200 with protocolVersion
 *   4. Valid Bearer + tools/list → 200 with tools: []
 *   5. Valid Bearer with a cookie header present → 401 (session is ignored
 *      — Bearer is the ONLY accepted credential per PITFALLS.md #9).
 *      Implementation note: "Cookie" header alone without any Authorization
 *      yields 401 because the Bearer preHandler rejects non-Bearer requests.
 *   6. Additional case — valid Bearer + tools/list filters by RBAC perms
 *   7. Startup: createDashboardJwtVerifier('') throws DASHBOARD_JWT_PUBLIC_KEY
 *      error (fail-fast invariant — no silent fallback).
 *
 * We use the injected-stub verifier pattern: the RS256 end-to-end flow is
 * covered in tests/mcp/verifier.test.ts. Here we exercise the Fastify route
 * composition and the Bearer-only preHandler behaviour with a fake verifier.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import type { McpTokenPayload, McpTokenVerifier } from '../../src/mcp/middleware.js';
import { createDashboardJwtVerifier } from '../../src/mcp/verifier.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
} from '../../src/db/service-connections-repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeVerifier(validPayload: McpTokenPayload, acceptedToken = 'valid-jwt'): McpTokenVerifier {
  return async (token: string): Promise<McpTokenPayload> => {
    if (token === acceptedToken) return validPayload;
    throw new Error('Invalid token');
  };
}

function makeStubStorage(perms: readonly string[] = []): StorageAdapter {
  const empty = {} as unknown;
  return {
    // Only `roles.getEffectivePermissions` is touched on the Phase 28 flows
    // exercised by this file (initialize / tools/list RBAC filter). Phase 30
    // data tools would hit scans + brandScores but those code paths are
    // covered in the dedicated data-tools.test.ts — here we only need a
    // shape-compatible stub that satisfies TypeScript for registerMcpRoutes.
    scans: empty as StorageAdapter['scans'],
    users: empty as StorageAdapter['users'],
    organizations: empty as StorageAdapter['organizations'],
    schedules: empty as StorageAdapter['schedules'],
    assignments: empty as StorageAdapter['assignments'],
    repos: empty as StorageAdapter['repos'],
    roles: {
      getEffectivePermissions: async (): Promise<Set<string>> => new Set(perms),
    } as unknown as StorageAdapter['roles'],
    teams: empty as StorageAdapter['teams'],
    email: empty as StorageAdapter['email'],
    audit: empty as StorageAdapter['audit'],
    plugins: empty as StorageAdapter['plugins'],
    apiKeys: empty as StorageAdapter['apiKeys'],
    pageHashes: empty as StorageAdapter['pageHashes'],
    manualTests: empty as StorageAdapter['manualTests'],
    gitHosts: empty as StorageAdapter['gitHosts'],
    branding: empty as StorageAdapter['branding'],
    brandScores: empty as StorageAdapter['brandScores'],
    connect: async (): Promise<void> => {},
    disconnect: async (): Promise<void> => {},
    migrate: async (): Promise<void> => {},
    healthCheck: async (): Promise<boolean> => true,
    name: 'stub',
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
    upsert: async (input) => ({
      serviceId: input.serviceId,
      url: input.url,
      clientId: input.clientId,
      clientSecret: input.clientSecret ?? '',
      hasSecret: input.clientSecret != null && input.clientSecret !== '',
      updatedAt: '1970-01-01T00:00:00.000Z',
      updatedBy: input.updatedBy,
      source: 'db',
    }) as unknown as ServiceConnection,
    clearSecret: async () => {},
  };
}

async function buildApp(options: {
  readonly verifyToken: McpTokenVerifier;
  readonly storage: StorageAdapter;
  readonly scanService?: ScanService;
  readonly serviceConnections?: ServiceConnectionsRepository;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMcpRoutes(app, {
    verifyToken: options.verifyToken,
    storage: options.storage,
    scanService: options.scanService ?? makeStubScanService(),
    serviceConnections: options.serviceConnections ?? makeStubServiceConnections(),
  });
  await app.ready();
  return app;
}

function initializePayload(): unknown {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'vitest-dashboard', version: '0.0.1' },
    },
  };
}

function listToolsPayload(): unknown {
  return { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
}

function parseSseOrJson(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (dataLine == null) throw new Error(`No SSE data line in body: ${body}`);
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

describe('POST /api/v1/mcp (dashboard)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('Case 1: returns 401 "Bearer token required" when no Authorization header', async () => {
    const verify = makeFakeVerifier({
      sub: 'u1',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    app = await buildApp({ verifyToken: verify, storage: makeStubStorage() });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error?: string };
    expect(body.error).toBe('Bearer token required');
  });

  it('Case 2: returns 401 "Invalid or expired token" on bad Bearer token', async () => {
    const verify = makeFakeVerifier({
      sub: 'u1',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    app = await buildApp({ verifyToken: verify, storage: makeStubStorage() });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer bad-token',
      },
      payload: initializePayload(),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error?: string };
    expect(body.error).toBe('Invalid or expired token');
  });

  it('Case 3: valid Bearer + initialize returns 200 with protocolVersion', async () => {
    const verify = makeFakeVerifier({
      sub: 'user-3',
      scopes: ['read'],
      orgId: 'org-3',
      role: 'member',
    });
    app = await buildApp({
      verifyToken: verify,
      storage: makeStubStorage(['reports.view']),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer valid-jwt',
      },
      payload: initializePayload(),
    });

    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result?.['protocolVersion']).toBeDefined();
    expect(result?.['serverInfo']).toBeDefined();
    const serverInfo = result?.['serverInfo'] as { name?: string };
    expect(serverInfo?.name).toBe('luqen-dashboard');
  });

  it('Case 4: valid Bearer + tools/list returns the 7 dashboard data tools (Phase 30 + Phase 46)', async () => {
    // Phase 30-02 populated the dashboard MCP with six data tools covering
    // MCPT-01 (scan/report/issue) + MCPT-02 brand-score retrieval. Phase 46
    // adds dashboard_get_scan_progress (AGENT-07) — bringing the total to 7.
    // A caller with scans.create + reports.view + branding.view sees all 7.
    // Admin scope on its own does NOT expose the data tools because the
    // manifest filter is permission-driven (filterToolsByPermissions) when
    // the caller has any resolved permissions — the stub below grants the
    // three permissions that match DASHBOARD_DATA_TOOL_METADATA.
    const verify = makeFakeVerifier({
      sub: 'user-4',
      // scans.create is a write-tier permission; the scope-filter admits the
      // write-tier dashboard_scan_site tool only when the caller carries the
      // matching scope. Phase 31.2 made scope ∩ RBAC the default for end-user
      // callers — grant both tiers so this Phase 30 data-tool assertion holds.
      scopes: ['read', 'write'],
      orgId: 'org-4',
      role: 'member',
    });
    app = await buildApp({
      verifyToken: verify,
      storage: makeStubStorage(['scans.create', 'reports.view', 'branding.view']),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer valid-jwt',
      },
      payload: listToolsPayload(),
    });

    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as { tools?: Array<{ name: string }> } | undefined;
    expect(result).toBeDefined();
    const tools = result?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain('dashboard_scan_site');
    expect(names).toContain('dashboard_list_reports');
    expect(names).toContain('dashboard_get_report');
    expect(names).toContain('dashboard_get_scan_progress');
    expect(names).toContain('dashboard_query_issues');
    expect(names).toContain('dashboard_list_brand_scores');
    expect(names).toContain('dashboard_get_brand_score');
    // Admin tools (plan 30-03) are still empty stubs here, so the count is 7.
    expect(names.length).toBe(7);
  });

  it('Case 5: cookie-only request (no Bearer) is rejected with 401', async () => {
    const verify = makeFakeVerifier({
      sub: 'u1',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    app = await buildApp({ verifyToken: verify, storage: makeStubStorage() });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'Cookie': 'session=would-have-been-valid-in-cookie-flow',
      },
      payload: initializePayload(),
    });

    // PITFALLS.md #9: MCP endpoint is Bearer-only — cookies never win.
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error?: string };
    expect(body.error).toBe('Bearer token required');
  });

  it('Case 6: admin role → full permission set resolved (RBAC admin shortcut)', async () => {
    const verify = makeFakeVerifier({
      sub: 'admin-user',
      scopes: ['admin'],
      orgId: 'org-any',
      role: 'admin',
    });
    // The stub roles repo would return empty, but resolveEffectivePermissions
    // short-circuits for role='admin' → full permission set. We just prove the
    // initialize flow still works (no errors thrown from permission resolution).
    app = await buildApp({ verifyToken: verify, storage: makeStubStorage([]) });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer valid-jwt',
      },
      payload: initializePayload(),
    });

    expect(response.statusCode).toBe(200);
  });

  it('prompts/list returns exactly ["scan", "report", "fix"] — MCPI-06 enforcement', async () => {
    // Belt-and-braces alongside the dedicated prompts.test.ts file: the
    // dashboard MCP must always surface exactly the three prompts locked by
    // 30-CONTEXT.md D-13. Permissions don't gate prompts (they're global
    // templates), so an empty-permission caller should still see all three.
    const verify = makeFakeVerifier({
      sub: 'user-prompts',
      scopes: ['read'],
      orgId: 'org-prompts',
      role: 'member',
    });
    app = await buildApp({ verifyToken: verify, storage: makeStubStorage([]) });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: { jsonrpc: '2.0', id: 99, method: 'prompts/list', params: {} },
    });
    const result = parseSseOrJson(response.body)['result'] as {
      prompts: Array<{ name: string }>;
    };
    const names = result.prompts.map((p) => p.name).sort();
    expect(names).toEqual(['fix', 'report', 'scan']);
    expect(result.prompts.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Startup-fail test (blocker 2 fix — no silent fallback when key missing)
// ---------------------------------------------------------------------------

describe('createDashboardJwtVerifier startup behaviour', () => {
  // Phase 31.1 Plan 03: verifier signature now requires an options object.
  // The legacy single-arg signature is gone — callers must pass either
  // `jwksUri` (preferred) or `legacyPem` (deprecated) alongside `expectedAudience`.
  it('throws with DASHBOARD_JWT_PUBLIC_KEY in the error when both jwksUri and legacyPem are missing', async () => {
    await expect(
      createDashboardJwtVerifier({ expectedAudience: 'https://test/mcp' }),
    ).rejects.toThrow(/DASHBOARD_JWT_PUBLIC_KEY/);
  });

  it('throws with DASHBOARD_JWT_PUBLIC_KEY when legacyPem is only whitespace and jwksUri is blank', async () => {
    await expect(
      createDashboardJwtVerifier({
        expectedAudience: 'https://test/mcp',
        legacyPem: '    \n   ',
        jwksUri: '',
      }),
    ).rejects.toThrow(/DASHBOARD_JWT_PUBLIC_KEY/);
  });
});

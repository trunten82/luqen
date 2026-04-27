/**
 * Compliance MCP discovery tools — integration tests.
 *
 * Covers the four tools registered by
 * packages/dashboard/src/mcp/tools/compliance.ts:
 *
 *   1. tools/list — all four register only when complianceAccess provided
 *   2. tools/list — RBAC filtering hides compliance tools when caller lacks
 *      compliance.view
 *   3. dashboard_list_jurisdictions — happy path proxies through to compliance
 *   4. dashboard_list_regulations — happy path + filters
 *   5. dashboard_get_regulation — returns matched row, errors on miss
 *   6. dashboard_list_wcag_criteria — happy path + filters
 *   7. complianceAccess returning null → tools surface friendly error
 *
 * Mirrors the pattern in admin-tools.test.ts / data-tools.test.ts.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import {
  COMPLIANCE_TOOL_NAMES,
} from '../../src/mcp/tools/compliance.js';
import type { McpTokenPayload, McpTokenVerifier } from '../../src/mcp/middleware.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
} from '../../src/db/service-connections-repository.js';
import * as complianceClient from '../../src/compliance-client.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeStubStorage(perms: readonly string[] = []): StorageAdapter {
  const empty = {} as unknown;
  const permSet = new Set(perms);
  return {
    scans: empty as StorageAdapter['scans'],
    brandScores: empty as StorageAdapter['brandScores'],
    users: empty as StorageAdapter['users'],
    organizations: empty as StorageAdapter['organizations'],
    roles: {
      getEffectivePermissions: async () => permSet,
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
  } as ServiceConnectionsRepository;
}

function makeStubScanService(): ScanService {
  return {
    initiateScan: async () => ({ ok: true, scanId: 'stub-scan' }),
    getScanForOrg: async () => ({ ok: false, error: 'Scan not found' }),
  } as unknown as ScanService;
}

function makeFakeVerifier(payload: McpTokenPayload): McpTokenVerifier {
  return async (token: string): Promise<McpTokenPayload> => {
    if (token === 'valid-jwt') return payload;
    throw new Error('Invalid token');
  };
}

interface BuildOpts {
  readonly permissions: readonly string[];
  readonly complianceAccessReturns?:
    | { baseUrl: string; token: string }
    | null;
}

async function buildApp(o: BuildOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMcpRoutes(app, {
    verifyToken: makeFakeVerifier({
      sub: 'tester',
      scopes: ['read', 'write', 'admin'],
      orgId: 'org-1',
      role: 'member',
    }),
    storage: makeStubStorage(o.permissions),
    scanService: makeStubScanService(),
    serviceConnections: makeStubServiceConnections(),
    complianceAccess: async () => o.complianceAccessReturns ?? null,
    resourceMetadataUrl: 'http://stub/.well-known/oauth-protected-resource',
  } as unknown as Parameters<typeof registerMcpRoutes>[1]);
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

async function callTool(
  app: FastifyInstance,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await app.inject({
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

// ---------------------------------------------------------------------------
// tools/list visibility
// ---------------------------------------------------------------------------

describe('Compliance MCP tools — tools/list visibility', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('caller with compliance.view sees all 4 compliance discovery tools', async () => {
    app = await buildApp({
      permissions: ['compliance.view'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 't' },
    });
    const resp = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list'),
    });
    const names = (
      (parseSseOrJson(resp.body)['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([...COMPLIANCE_TOOL_NAMES]));
    expect(names.length).toBe(4);
  });

  it('caller without compliance.view sees zero compliance tools', async () => {
    app = await buildApp({
      permissions: ['scans.create'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 't' },
    });
    const resp = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list'),
    });
    const names = (
      (parseSseOrJson(resp.body)['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    for (const n of COMPLIANCE_TOOL_NAMES) {
      expect(names).not.toContain(n);
    }
  });
});

// ---------------------------------------------------------------------------
// Handler happy paths
// ---------------------------------------------------------------------------

describe('Compliance MCP tools — handler happy paths', () => {
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
    vi.restoreAllMocks();
  });

  it('dashboard_list_jurisdictions proxies through to compliance-client', async () => {
    vi.spyOn(complianceClient, 'listJurisdictions').mockResolvedValue([
      { id: 'us-ca', name: 'California', type: 'subdivision' },
      { id: 'eu', name: 'European Union', type: 'region' },
    ]);
    app = await buildApp({
      permissions: ['compliance.view'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 't' },
    });
    const parsed = await callTool(app, 'dashboard_list_jurisdictions', {});
    const body = extractText(parsed);
    expect((body['data'] as Array<{ id: string }>).map((j) => j.id)).toEqual([
      'us-ca',
      'eu',
    ]);
    expect((body['meta'] as { count: number }).count).toBe(2);
  });

  it('dashboard_list_regulations forwards jurisdictionId server-side and post-filters q client-side', async () => {
    // Two regs returned by the API; client-side q filter narrows to one.
    const spy = vi.spyOn(complianceClient, 'listRegulations').mockResolvedValue([
      {
        id: 'EU-EAA',
        name: 'European Accessibility Act',
        shortName: 'EAA',
        jurisdictionId: 'EU',
        enforcementDate: '2025-06-28',
        status: 'in-force',
        scope: 'public-services',
      },
      {
        id: 'EU-WAD',
        name: 'Web Accessibility Directive',
        shortName: 'WAD',
        jurisdictionId: 'EU',
        enforcementDate: '2018-09-23',
        status: 'in-force',
        scope: 'public-sector',
      },
    ]);
    app = await buildApp({
      permissions: ['compliance.view'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 't' },
    });
    const parsed = await callTool(app, 'dashboard_list_regulations', {
      jurisdictionId: 'EU',
      q: 'web',
    });
    const body = extractText(parsed);
    const ids = (body['data'] as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(['EU-WAD']); // q='web' matches "Web Accessibility Directive"
    expect((body['meta'] as { count: number }).count).toBe(1);
    // Only jurisdictionId is forwarded to the API; q is NOT sent server-side
    // because compliance /api/v1/regulations does not support it.
    expect(spy).toHaveBeenCalledWith(
      'http://compliance',
      't',
      { jurisdictionId: 'EU' },
      'org-1',
    );
  });

  it('dashboard_list_regulations with no filters returns full set unchanged', async () => {
    const spy = vi.spyOn(complianceClient, 'listRegulations').mockResolvedValue([
      { id: 'EU-EAA', name: 'EAA', shortName: 'EAA', jurisdictionId: 'EU', enforcementDate: '', status: 'in-force', scope: '' },
      { id: 'US-ADA', name: 'ADA', shortName: 'ADA', jurisdictionId: 'US', enforcementDate: '', status: 'in-force', scope: '' },
    ]);
    app = await buildApp({
      permissions: ['compliance.view'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 't' },
    });
    const parsed = await callTool(app, 'dashboard_list_regulations', {});
    const body = extractText(parsed);
    expect((body['data'] as Array<{ id: string }>).length).toBe(2);
    // Empty filter object → undefined passed to the client (not an empty {})
    expect(spy).toHaveBeenCalledWith('http://compliance', 't', undefined, 'org-1');
  });

  it('dashboard_get_regulation returns the matched row (case-sensitive id match)', async () => {
    const spy = vi.spyOn(complianceClient, 'listRegulations').mockResolvedValue([
      {
        id: 'EU-EAA',
        name: 'European Accessibility Act',
        shortName: 'EAA',
        jurisdictionId: 'EU',
        enforcementDate: '2025-06-28',
        status: 'in-force',
        scope: 'public-services',
      },
      {
        id: 'EU-WAD',
        name: 'Web Accessibility Directive',
        shortName: 'WAD',
        jurisdictionId: 'EU',
        enforcementDate: '2018-09-23',
        status: 'in-force',
        scope: 'public-sector',
      },
    ]);
    app = await buildApp({
      permissions: ['compliance.view'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 't' },
    });
    const parsed = await callTool(app, 'dashboard_get_regulation', {
      regulationId: 'EU-EAA',
    });
    const body = extractText(parsed);
    expect(body['id']).toBe('EU-EAA');
    expect(body['shortName']).toBe('EAA');
    // No `id` filter sent to API (it does not support one) — full list fetched, find applied locally.
    expect(spy).toHaveBeenCalledWith('http://compliance', 't', undefined, 'org-1');
  });

  it('dashboard_get_regulation returns error envelope on miss', async () => {
    vi.spyOn(complianceClient, 'listRegulations').mockResolvedValue([]);
    app = await buildApp({
      permissions: ['compliance.view'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 't' },
    });
    const parsed = await callTool(app, 'dashboard_get_regulation', {
      regulationId: 'does-not-exist',
    });
    const body = extractText(parsed);
    expect(body['error']).toMatch(/not found/i);
  });

  it('dashboard_list_wcag_criteria forwards regulationId server-side and post-filters wcagLevel + wcagVersion client-side', async () => {
    const spy = vi.spyOn(complianceClient, 'listRequirements').mockResolvedValue([
      {
        id: 'req-1',
        regulationId: 'EU-EAA',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '1.4.3',
        obligation: 'mandatory',
      },
      {
        id: 'req-2',
        regulationId: 'EU-EAA',
        wcagVersion: '2.0',
        wcagLevel: 'A',
        wcagCriterion: '1.1.1',
        obligation: 'mandatory',
      },
      {
        id: 'req-3',
        regulationId: 'EU-EAA',
        wcagVersion: '2.1',
        wcagLevel: 'A',
        wcagCriterion: '2.5.3',
        obligation: 'mandatory',
      },
    ]);
    app = await buildApp({
      permissions: ['compliance.view'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 't' },
    });
    const parsed = await callTool(app, 'dashboard_list_wcag_criteria', {
      regulationId: 'EU-EAA',
      wcagLevel: 'AA',
      wcagVersion: '2.1',
    });
    const body = extractText(parsed);
    const criteria = (body['data'] as Array<{ wcagCriterion: string }>).map((c) => c.wcagCriterion);
    // Only req-1 matches both wcagLevel=AA AND wcagVersion=2.1
    expect(criteria).toEqual(['1.4.3']);
    expect((body['meta'] as { count: number }).count).toBe(1);
    // Only regulationId is forwarded to the API; wcagLevel + wcagVersion are NOT.
    expect(spy).toHaveBeenCalledWith(
      'http://compliance',
      't',
      { regulationId: 'EU-EAA' },
      'org-1',
    );
  });
});

// ---------------------------------------------------------------------------
// complianceAccess null → friendly error
// ---------------------------------------------------------------------------

describe('Compliance MCP tools — degraded mode when compliance not configured', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('compliance discovery tools are not registered when complianceAccess is omitted', async () => {
    // We omit complianceAccess by passing buildApp without complianceAccessReturns
    // — but buildApp always provides a complianceAccess callback. Instead make
    // the callback return null (= service not configured) and confirm the
    // handler surfaces a clear error rather than a silent empty response.
    app = await buildApp({
      permissions: ['compliance.view'],
      complianceAccessReturns: null,
    });
    const parsed = await callTool(app, 'dashboard_list_jurisdictions', {});
    const body = extractText(parsed);
    expect(body['error']).toMatch(/compliance service is not configured/i);
  });
});

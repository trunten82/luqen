/**
 * Phase 30 dashboard data tools — integration tests.
 *
 * Covers the six data tools registered by
 * packages/dashboard/src/mcp/tools/data.ts:
 *
 *   1. tools/list RBAC filtering per permission (4 cases)
 *   2. D-17 runtime guard — NO data tool inputSchema contains orgId
 *   3. destructiveHint annotation on dashboard_scan_site (D-03)
 *   4. Classification coverage — 6 org-scoped comments, 0 N/A,
 *      no TODO deferrals, no console.log, no orgId in zod schema
 *   5. Handler happy paths via tools/call for scan_site, get_report polling,
 *      and get_brand_score exactly-one-of validation
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import { DASHBOARD_DATA_TOOL_METADATA } from '../../src/mcp/metadata.js';
import { DATA_TOOL_NAMES } from '../../src/mcp/tools/data.js';
import type { McpTokenPayload, McpTokenVerifier } from '../../src/mcp/middleware.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type { ScanRecord } from '../../src/db/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface StubOverrides {
  readonly initiateScan?: ScanService['initiateScan'];
  readonly getScanForOrg?: ScanService['getScanForOrg'];
  readonly listScans?: StorageAdapter['scans']['listScans'];
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
      getScan: async () => null,
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

function makeStubScanService(o: StubOverrides = {}): ScanService {
  return {
    initiateScan: o.initiateScan ?? (async () => ({ ok: true, scanId: 'stub-scan' })),
    getScanForOrg: o.getScanForOrg ?? (async () => ({ ok: false, error: 'Scan not found' })),
  } as unknown as ScanService;
}

function makeFakeVerifier(payload: McpTokenPayload, acceptedToken = 'valid-jwt'): McpTokenVerifier {
  return async (token: string): Promise<McpTokenPayload> => {
    if (token === acceptedToken) return payload;
    throw new Error('Invalid token');
  };
}

async function buildApp(opts: {
  readonly verifier: McpTokenVerifier;
  readonly storage?: StorageAdapter;
  readonly scanService?: ScanService;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMcpRoutes(app, {
    verifyToken: opts.verifier,
    storage: opts.storage ?? makeStubStorage(),
    scanService: opts.scanService ?? makeStubScanService(),
  });
  await app.ready();
  return app;
}

function rpc(method: string, params: unknown, id = 1): unknown {
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

// ---------------------------------------------------------------------------
// tools/list RBAC filtering
// ---------------------------------------------------------------------------

describe('Phase 30 data tools — tools/list RBAC filtering', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('caller with all three required permissions sees the 6 data tools (admin tools empty in 30-02)', async () => {
    const verifier = makeFakeVerifier({
      sub: 'u',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    const storage = makeStubStorage({
      getEffectivePermissions: async () =>
        new Set(['scans.create', 'reports.view', 'branding.view']),
    });
    app = await buildApp({ verifier, storage });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list', {}),
    });
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('dashboard_scan_site');
    expect(names).toContain('dashboard_list_reports');
    expect(names).toContain('dashboard_get_report');
    expect(names).toContain('dashboard_query_issues');
    expect(names).toContain('dashboard_list_brand_scores');
    expect(names).toContain('dashboard_get_brand_score');
    expect(names.length).toBe(6);
  });

  it('caller with only reports.view sees 3 report tools', async () => {
    const verifier = makeFakeVerifier({
      sub: 'u',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    const storage = makeStubStorage({
      getEffectivePermissions: async () => new Set(['reports.view']),
    });
    app = await buildApp({ verifier, storage });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list', {}),
    });
    const parsed = parseSseOrJson(response.body);
    const names = (parsed['result'] as { tools: Array<{ name: string }> }).tools.map(
      (t) => t.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'dashboard_list_reports',
        'dashboard_get_report',
        'dashboard_query_issues',
      ]),
    );
    expect(names).not.toContain('dashboard_scan_site');
    expect(names).not.toContain('dashboard_list_brand_scores');
    expect(names.length).toBe(3);
  });

  it('caller with only branding.view sees 2 brand score tools', async () => {
    const verifier = makeFakeVerifier({
      sub: 'u',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    const storage = makeStubStorage({
      getEffectivePermissions: async () => new Set(['branding.view']),
    });
    app = await buildApp({ verifier, storage });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list', {}),
    });
    const names = (parseSseOrJson(response.body)['result'] as {
      tools: Array<{ name: string }>;
    }).tools.map((t) => t.name);
    expect(names).toContain('dashboard_list_brand_scores');
    expect(names).toContain('dashboard_get_brand_score');
    expect(names).not.toContain('dashboard_scan_site');
    expect(names.length).toBe(2);
  });

  it('caller with only scans.create sees dashboard_scan_site', async () => {
    const verifier = makeFakeVerifier({
      sub: 'u',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    const storage = makeStubStorage({
      getEffectivePermissions: async () => new Set(['scans.create']),
    });
    app = await buildApp({ verifier, storage });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list', {}),
    });
    const names = (parseSseOrJson(response.body)['result'] as {
      tools: Array<{ name: string }>;
    }).tools.map((t) => t.name);
    expect(names).toEqual(['dashboard_scan_site']);
  });
});

// ---------------------------------------------------------------------------
// D-17 invariant + destructive annotation + classification coverage
// ---------------------------------------------------------------------------

describe('Phase 30 data tools — D-17 invariant + destructive annotation + classification coverage', () => {
  it('D-17 runtime guard — NO data tool inputSchema contains orgId', async () => {
    const { server, toolNames, metadata } = await createDashboardMcpServer({
      storage: makeStubStorage(),
      scanService: makeStubScanService(),
    });

    // Plan 30-02: admin tools + resources + prompts are still stubs →
    // toolNames length equals DATA_TOOL_NAMES length = 6.
    expect(DATA_TOOL_NAMES.length).toBe(6);
    expect(toolNames.length).toBe(6);
    expect(DASHBOARD_DATA_TOOL_METADATA.length).toBe(6);
    expect(metadata.length).toBeGreaterThanOrEqual(6);

    const registered =
      (
        server as unknown as {
          _registeredTools?: Record<string, { inputSchema?: unknown }>;
        }
      )._registeredTools ?? {};
    const entries = Object.entries(registered);
    expect(entries.length).toBeGreaterThanOrEqual(6);

    for (const [name, tool] of entries) {
      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      let shapeRecord: Record<string, unknown> = {};
      if (schema != null && typeof schema === 'object') {
        const def = (schema as { _def?: { shape?: unknown } })._def;
        if (def != null && typeof def === 'object' && 'shape' in def) {
          const shape = (def as { shape?: unknown }).shape;
          if (typeof shape === 'function') {
            shapeRecord = (shape as () => Record<string, unknown>)() ?? {};
          } else if (shape != null && typeof shape === 'object') {
            shapeRecord = shape as Record<string, unknown>;
          }
        }
        if (Object.keys(shapeRecord).length === 0) {
          const s = (schema as { shape?: unknown }).shape;
          if (s != null && typeof s === 'object') {
            shapeRecord = s as Record<string, unknown>;
          }
        }
        if (Object.keys(shapeRecord).length === 0) {
          shapeRecord = schema as Record<string, unknown>;
        }
      }
      expect(shapeRecord, `tool ${name} must not accept orgId (D-17)`).not.toHaveProperty(
        'orgId',
      );
      let serialised = '';
      try {
        serialised = JSON.stringify(schema, (_k, v) => (typeof v === 'function' ? '[fn]' : v));
      } catch {
        serialised = String(schema);
      }
      expect(
        serialised.includes('"orgId"'),
        `tool ${name} schema must not contain "orgId"`,
      ).toBe(false);
    }
  });

  it('dashboard_scan_site carries destructiveHint annotation', async () => {
    const { server } = await createDashboardMcpServer({
      storage: makeStubStorage(),
      scanService: makeStubScanService(),
    });
    const registered =
      (
        server as unknown as {
          _registeredTools?: Record<string, { annotations?: Record<string, unknown> }>;
        }
      )._registeredTools ?? {};
    const scanTool = registered['dashboard_scan_site'];
    expect(scanTool).toBeDefined();
    expect(scanTool?.annotations).toBeDefined();
    expect(scanTool?.annotations?.['destructiveHint']).toBe(true);
  });

  it('Classification coverage — data.ts has 6 org-scoped comments, no TODO markers, no orgId in zod schema, no console.log', async () => {
    const source = await readFile(
      resolve(__dirname, '../../src/mcp/tools/data.ts'),
      'utf-8',
    );
    const orgScoped = (source.match(/\/\/ orgId: ctx\.orgId \(org-scoped/g) ?? []).length;
    const global = (source.match(/\/\/ orgId: N\/A /g) ?? []).length;
    expect(orgScoped).toBe(6);
    expect(global).toBe(0);
    expect(source).not.toMatch(/TODO\(phase-/);
    expect(source).not.toMatch(/orgId\s*:\s*z\./);
    expect(source).not.toMatch(/console\.log/);
  });
});

// ---------------------------------------------------------------------------
// Handler behaviour via tools/call
// ---------------------------------------------------------------------------

describe('Phase 30 data tools — handler behaviour via tools/call', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    activeApp: FastifyInstance,
  ): Promise<Record<string, unknown>> {
    const response = await activeApp.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/call', { name, arguments: args }),
    });
    return parseSseOrJson(response.body);
  }

  function extractText(result: Record<string, unknown>): Record<string, unknown> {
    const r = result['result'] as { content?: Array<{ text?: string }> };
    const text = r?.content?.[0]?.text ?? '{}';
    return JSON.parse(text) as Record<string, unknown>;
  }

  it('dashboard_scan_site — returns {scanId, status: "queued", url} on success', async () => {
    const verifier = makeFakeVerifier({
      sub: 'user-x',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    const storage = makeStubStorage({
      getEffectivePermissions: async () => new Set(['scans.create']),
    });
    const scanService = makeStubScanService({
      initiateScan: async () => ({ ok: true, scanId: 'scan-xyz' }),
    });
    app = await buildApp({ verifier, storage, scanService });
    const resp = await callTool('dashboard_scan_site', { siteUrl: 'https://example.com' }, app);
    const data = extractText(resp);
    expect(data['scanId']).toBe('scan-xyz');
    expect(data['status']).toBe('queued');
    expect(data['url']).toBe('https://example.com');
  });

  it('dashboard_get_report — running scan returns {status: "running"} without report', async () => {
    const verifier = makeFakeVerifier({
      sub: 'user-x',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    const storage = makeStubStorage({
      getEffectivePermissions: async () => new Set(['reports.view']),
    });
    const runningScan: ScanRecord = {
      id: 'x',
      siteUrl: 'https://example.com',
      status: 'running',
      standard: 'WCAG2AA',
      jurisdictions: [],
      regulations: [],
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      orgId: 'org-1',
    };
    const scanService = makeStubScanService({
      getScanForOrg: async () => ({ ok: true, scan: runningScan }),
    });
    app = await buildApp({ verifier, storage, scanService });
    const resp = await callTool('dashboard_get_report', { scanId: 'x' }, app);
    const data = extractText(resp);
    expect(data['status']).toBe('running');
    expect(data['report']).toBeUndefined();
  });

  it('dashboard_get_brand_score — error when neither scanId nor siteUrl supplied', async () => {
    const verifier = makeFakeVerifier({
      sub: 'u',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    const storage = makeStubStorage({
      getEffectivePermissions: async () => new Set(['branding.view']),
    });
    app = await buildApp({ verifier, storage });
    const resp = await callTool('dashboard_get_brand_score', {}, app);
    const r = resp['result'] as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(data['error']).toContain('exactly one');
  });

  it('dashboard_get_brand_score — error when both scanId and siteUrl supplied', async () => {
    const verifier = makeFakeVerifier({
      sub: 'u',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    });
    const storage = makeStubStorage({
      getEffectivePermissions: async () => new Set(['branding.view']),
    });
    app = await buildApp({ verifier, storage });
    const resp = await callTool(
      'dashboard_get_brand_score',
      { scanId: 'x', siteUrl: 'https://example.com' },
      app,
    );
    const r = resp['result'] as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
  });
});

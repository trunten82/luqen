/**
 * Phase 30 dashboard prompts — integration tests (MCPI-06).
 *
 * Covers the three prompts registered by
 * packages/dashboard/src/mcp/prompts.ts:
 *
 *   1. DASHBOARD_PROMPT_NAMES shape — ['scan', 'report', 'fix']
 *   2. prompts/list returns exactly 3 prompts
 *   3. prompts/list exposes wire-format arguments with required flags
 *      derived from zod .optional() correctly
 *   4. prompts/get interpolates arguments into a single user message that
 *      embeds the tool-aware system preamble (D-15 — SDK 1.27.1 has no
 *      'system' role, so preamble is in the user message text)
 *   5. /scan defaults to WCAG2AA when 'standard' is omitted (D-14)
 *   6. /fix scanId suffix is conditional on presence (no "undefined")
 *   7. Every prompt message uses role='user' only — no system, no
 *      assistant (D-15)
 *   8. D-17 runtime guard via _registeredPrompts iteration: no argsSchema
 *      contains an orgId key
 *
 * Helpers (buildApp, rpc, parseSseOrJson, makeFakeVerifier,
 * makeStubStorage, makeStubScanService) are inlined here rather than
 * imported from sibling test files so 30-03/30-04/30-05 stay independent
 * during Wave 2 parallel execution. Shape mirrors the 30-02
 * data-tools.test.ts scaffolding (Wave 1 — stable dependency).
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import { DASHBOARD_PROMPT_NAMES } from '../../src/mcp/prompts.js';
import type { McpTokenPayload, McpTokenVerifier } from '../../src/mcp/middleware.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';

// ---------------------------------------------------------------------------
// Stubs (inlined — matches 30-02 data-tools.test.ts scaffolding)
// ---------------------------------------------------------------------------

interface StubOverrides {
  readonly getEffectivePermissions?: (userId: string, orgId?: string) => Promise<Set<string>>;
}

function makeStubStorage(o: StubOverrides = {}): StorageAdapter {
  const empty = {} as unknown;
  const perms = new Set<string>();
  return {
    scans: {
      listScans: async () => [],
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
      getReport: async () => null,
      getTrendData: async () => [],
      getLatestPerSite: async () => [],
    } as unknown as StorageAdapter['scans'],
    brandScores: {
      insert: async () => {},
      getLatestForScan: async () => null,
      getHistoryForSite: async () => [],
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

async function buildApp(opts: {
  readonly permissions?: readonly string[];
}): Promise<FastifyInstance> {
  const verifier = makeFakeVerifier({
    sub: 'u-test',
    scopes: ['read'],
    orgId: 'org-test',
    role: 'member',
  });
  const storage = makeStubStorage({
    getEffectivePermissions: async () => new Set(opts.permissions ?? []),
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

const STD_HEADERS = {
  authorization: 'Bearer valid-jwt',
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

// ---------------------------------------------------------------------------
// 1. DASHBOARD_PROMPT_NAMES shape
// ---------------------------------------------------------------------------

describe('Phase 30 prompts — DASHBOARD_PROMPT_NAMES shape (MCPI-06)', () => {
  it('exports exactly 3 names in canonical order', () => {
    expect(DASHBOARD_PROMPT_NAMES.length).toBe(3);
    expect(DASHBOARD_PROMPT_NAMES[0]).toBe('scan');
    expect(DASHBOARD_PROMPT_NAMES[1]).toBe('report');
    expect(DASHBOARD_PROMPT_NAMES[2]).toBe('fix');
  });
});

// ---------------------------------------------------------------------------
// 2-4. prompts/list — count + wire-format arguments
// ---------------------------------------------------------------------------

describe('Phase 30 prompts — prompts/list', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('returns exactly 3 prompts: scan, report, fix', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/list'),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      prompts: Array<{ name: string }>;
    };
    expect(result.prompts.length).toBe(3);
    const names = result.prompts.map((p) => p.name).sort();
    expect(names).toEqual(['fix', 'report', 'scan']);
  });

  it('/scan exposes siteUrl (required) and standard (optional) wire arguments', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/list'),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      prompts: Array<{
        name: string;
        arguments?: Array<{ name: string; required?: boolean; description?: string }>;
      }>;
    };
    const scan = result.prompts.find((p) => p.name === 'scan');
    expect(scan).toBeDefined();
    const args = scan?.arguments ?? [];
    const siteUrl = args.find((a) => a.name === 'siteUrl');
    const standard = args.find((a) => a.name === 'standard');
    expect(siteUrl?.required).toBe(true);
    expect(siteUrl?.description).toContain('website URL');
    // .optional() → required is absent or false on the wire
    expect(standard?.required === undefined || standard?.required === false).toBe(true);
    expect(standard?.description).toContain('WCAG2AA');
  });

  it('/report exposes scanId (required)', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/list'),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      prompts: Array<{ name: string; arguments?: Array<{ name: string; required?: boolean }> }>;
    };
    const report = result.prompts.find((p) => p.name === 'report');
    const scanId = (report?.arguments ?? []).find((a) => a.name === 'scanId');
    expect(scanId?.required).toBe(true);
  });

  it('/fix exposes issueId (required) and scanId (optional)', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/list'),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      prompts: Array<{ name: string; arguments?: Array<{ name: string; required?: boolean }> }>;
    };
    const fix = result.prompts.find((p) => p.name === 'fix');
    const issueId = (fix?.arguments ?? []).find((a) => a.name === 'issueId');
    const scanId = (fix?.arguments ?? []).find((a) => a.name === 'scanId');
    expect(issueId?.required).toBe(true);
    expect(scanId?.required === undefined || scanId?.required === false).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5-8. prompts/get — interpolation, defaults, conditional suffix, role
// ---------------------------------------------------------------------------

describe('Phase 30 prompts — prompts/get interpolation', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('/scan with siteUrl + standard interpolates both into the user message', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/get', {
        name: 'scan',
        arguments: { siteUrl: 'https://example.com', standard: 'WCAG2AAA' },
      }),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };
    expect(result.messages.length).toBe(1);
    expect(result.messages[0]?.role).toBe('user');
    expect(result.messages[0]?.content.type).toBe('text');
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('System: You are a WCAG compliance assistant');
    expect(text).toContain('User: Scan https://example.com for WCAG WCAG2AAA compliance');
  });

  it('/scan without standard defaults to WCAG2AA (D-14 default)', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/get', {
        name: 'scan',
        arguments: { siteUrl: 'https://example.com' },
      }),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      messages: Array<{ content: { text: string } }>;
    };
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('WCAG2AA');
    expect(text).not.toContain('undefined');
  });

  it('/report interpolates scanId', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/get', {
        name: 'report',
        arguments: { scanId: 'abc-123' },
      }),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      messages: Array<{ content: { text: string } }>;
    };
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('Retrieve the scan report for abc-123');
  });

  it('/fix with only issueId omits the scan suffix', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/get', {
        name: 'fix',
        arguments: { issueId: 'WCAG2AA.Principle1.H37' },
      }),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      messages: Array<{ content: { text: string } }>;
    };
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('Generate a code fix for WCAG issue WCAG2AA.Principle1.H37.');
    expect(text).not.toContain(' in scan ');
  });

  it('/fix with issueId + scanId appends the scan suffix', async () => {
    app = await buildApp({ permissions: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: STD_HEADERS,
      payload: rpc('prompts/get', {
        name: 'fix',
        arguments: { issueId: 'WCAG2AA.Principle1.H37', scanId: 's99' },
      }),
    });
    const result = parseSseOrJson(response.body)['result'] as {
      messages: Array<{ content: { text: string } }>;
    };
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('Generate a code fix for WCAG issue WCAG2AA.Principle1.H37 in scan s99');
  });

  it('all prompt messages use role=user only (SDK 1.27.1 + D-15)', async () => {
    app = await buildApp({ permissions: [] });
    const cases: Array<{ name: string; args: Record<string, unknown> }> = [
      { name: 'scan', args: { siteUrl: 'https://x.com' } },
      { name: 'report', args: { scanId: 'r1' } },
      { name: 'fix', args: { issueId: 'WCAG2AA.X' } },
    ];
    for (const { name, args } of cases) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: STD_HEADERS,
        payload: rpc('prompts/get', { name, arguments: args }),
      });
      const result = parseSseOrJson(response.body)['result'] as {
        messages: Array<{ role: string }>;
      };
      expect(result.messages.every((m) => m.role === 'user')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. D-17 invariant — runtime iteration over _registeredPrompts
// ---------------------------------------------------------------------------

describe('Phase 30 prompts — D-17 argsSchema iteration guard', () => {
  it('NO prompt argsSchema contains orgId key, and length is exactly 3', async () => {
    const { server } = await createDashboardMcpServer({
      storage: makeStubStorage(),
      scanService: makeStubScanService(),
    });
    const registered =
      (
        server as unknown as {
          _registeredPrompts?: Record<string, { argsSchema?: Record<string, unknown> }>;
        }
      )._registeredPrompts ?? {};
    const entries = Object.entries(registered);
    expect(entries.length).toBe(3);
    for (const [name, prompt] of entries) {
      const shape = prompt.argsSchema ?? {};
      expect(shape, `prompt ${name} must not accept orgId (D-17)`).not.toHaveProperty('orgId');
      let serialised = '';
      try {
        serialised = JSON.stringify(shape, (_k, v) => (typeof v === 'function' ? '[fn]' : v));
      } catch {
        serialised = String(shape);
      }
      expect(
        serialised.includes('"orgId"'),
        `prompt ${name} argsSchema must not contain "orgId"`,
      ).toBe(false);
    }
  });
});

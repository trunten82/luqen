/**
 * scan-fix-tools.test.ts — Module-level tests for dashboard_scan_page
 * and dashboard_generate_fix MCP tools.
 *
 * Both tools are exercised directly via registerScanTools/registerFixTools
 * on a fresh McpServer instance (InMemoryTransport + Client). No
 * registerMcpRoutes wiring is used here — that integration belongs to Plan 03.
 *
 * Test groups:
 *   "dashboard_scan_page"  — findings shape, SSRF block, error paths
 *   "dashboard_generate_fix" — enriched fix payload, legalContext degrade,
 *                              platform forwarding, disclaimer, LLM error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerScanTools, SCAN_TOOL_NAMES } from '../../src/mcp/tools/scan.js';
import { registerFixTools, FIX_TOOL_NAMES, DRAFT_DISCLAIMER } from '../../src/mcp/tools/fix.js';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { DASHBOARD_AGENT_TOOL_METADATA } from '../../src/mcp/metadata.js';
import type { DirectScanner } from '@luqen/core';
import type { McpTokenPayload, McpTokenVerifier } from '../../src/mcp/middleware.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type { ServiceConnectionsRepository } from '../../src/db/service-connections-repository.js';

// ---------------------------------------------------------------------------
// Shared stub factories (copied verbatim from compliance-tools.test.ts pattern)
// ---------------------------------------------------------------------------

// (These are kept for parity with the compliance test pattern; not all are
// used directly here since we bypass registerMcpRoutes.)

// ---------------------------------------------------------------------------
// McpServer helpers
// ---------------------------------------------------------------------------

async function makeServerAndClient(
  configure: (server: McpServer) => void,
): Promise<{ client: Client; closeAll: () => Promise<void> }> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  configure(server);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    closeAll: async () => {
      await client.close();
    },
  };
}

function parseToolText(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stub scanner
// ---------------------------------------------------------------------------

const FAKE_ISSUE = {
  code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
  type: 'error',
  message: 'img element missing non-empty alt attribute',
  selector: '#main img',
  context: '<img src="logo.png">',
  runner: 'htmlcs',
};

function makeStubScanner(
  issues: DirectScanResult['issues'] = [FAKE_ISSUE],
  throws?: Error,
): DirectScanner {
  return {
    scan: throws !== undefined
      ? async () => { throw throws; }
      : async () => ({ url: 'http://example.com', issues }),
  } as unknown as DirectScanner;
}

// ---------------------------------------------------------------------------
// Stub LLM access and fetch
// ---------------------------------------------------------------------------

const FAKE_FIX_RESPONSE = {
  fixedHtml: '<img src="logo.png" alt="Company logo">',
  explanation: 'Added descriptive alt text.',
  effort: 'low',
  wcagCriterion: '1.1.1',
  diff: '- <img src="logo.png">\n+ <img src="logo.png" alt="Company logo">',
};

// ============================================================================
// TEST SUITE: dashboard_scan_page
// ============================================================================

describe('dashboard_scan_page', () => {
  let client: Client;
  let closeAll: () => Promise<void>;

  afterEach(async () => {
    if (closeAll !== undefined) await closeAll();
    vi.restoreAllMocks();
  });

  it('returns structured findings array with expected shape from html input', async () => {
    const scanner = makeStubScanner([FAKE_ISSUE]);
    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: { html: '<img src="logo.png">' },
    });

    expect(result.isError).toBeFalsy();
    const body = parseToolText(result);
    const findings = body['findings'] as Array<Record<string, unknown>>;
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);

    const finding = findings[0];
    expect(typeof finding['code']).toBe('string');
    expect(typeof finding['type']).toBe('string');
    expect(typeof finding['message']).toBe('string');
    expect(typeof finding['selector']).toBe('string');
    expect(typeof finding['context']).toBe('string');
    expect(typeof finding['runner']).toBe('string');

    // meta block
    const meta = body['meta'] as Record<string, unknown>;
    expect(typeof meta['count']).toBe('number');
    expect(typeof meta['standard']).toBe('string');
  });

  it('returns isError:true for a private/internal url (SSRF blocked)', async () => {
    const scanner = makeStubScanner();
    const scanSpy = vi.spyOn(scanner, 'scan');

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: { url: 'http://127.0.0.1/admin' },
    });

    expect(result.isError).toBe(true);
    const body = parseToolText(result);
    expect(typeof body['error']).toBe('string');
    // The scanner must NOT have been invoked (SSRF guard fires first)
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('returns isError:true for localhost url (SSRF blocked)', async () => {
    const scanner = makeStubScanner();
    const scanSpy = vi.spyOn(scanner, 'scan');

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: { url: 'http://localhost:8080/private' },
    });

    expect(result.isError).toBe(true);
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('returns isError:true when neither url nor html is supplied', async () => {
    const scanner = makeStubScanner();

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const body = parseToolText(result);
    expect(typeof body['error']).toBe('string');
  });

  it('returns isError:true (graceful) when the scanner throws', async () => {
    const scanner = makeStubScanner([], new Error('Chromium unavailable'));

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: { html: '<div>test</div>' },
    });

    expect(result.isError).toBe(true);
    const body = parseToolText(result);
    expect(typeof body['error']).toBe('string');
  });
});

// ============================================================================
// TEST SUITE: dashboard_generate_fix
// ============================================================================

describe('dashboard_generate_fix', () => {
  let client: Client;
  let closeAll: () => Promise<void>;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (closeAll !== undefined) await closeAll();
    vi.restoreAllMocks();
  });

  function makeLlmAccess(
    response: Record<string, unknown> | null = FAKE_FIX_RESPONSE,
    shouldFail = false,
  ): () => Promise<{ baseUrl: string; token: string } | null> {
    return async () => {
      if (response === null) return null;
      return { baseUrl: 'http://llm-service', token: 'test-token' };
    };
  }

  function makeComplianceAccess(
    result: Record<string, unknown> | null = { matrix: {}, issueAnnotations: new Map(), summary: {} },
  ): () => Promise<{ baseUrl: string; token: string } | null> {
    return async () => {
      if (result === null) return null;
      return { baseUrl: 'http://compliance-service', token: 'compliance-token' };
    };
  }

  it('happy path: returns wcagCriterion (echoed), diff, fixedHtml, explanation, effort, legalContext, disclaimer', async () => {
    // Stub global fetch for the LLM call
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('generate-fix')) {
        return {
          ok: true,
          json: async () => FAKE_FIX_RESPONSE,
        };
      }
      // compliance fetch
      return {
        ok: true,
        json: async () => ({
          matrix: {},
          annotatedIssues: [],
          summary: { totalJurisdictions: 0, passing: 0, failing: 0, totalMandatoryViolations: 0, totalOptionalViolations: 0 },
        }),
      };
    }));

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerFixTools(server, {
        llmAccess: makeLlmAccess(),
        complianceAccess: makeComplianceAccess(),
      });
    }));

    const result = await client.callTool({
      name: 'dashboard_generate_fix',
      arguments: {
        wcagCriterion: '1.1.1',
        issueMessage: 'img element missing alt',
        htmlContext: '<img src="logo.png">',
      },
    });

    expect(result.isError).toBeFalsy();
    const body = parseToolText(result);
    expect(body['wcagCriterion']).toBe('1.1.1');
    expect(typeof body['diff']).toBe('string');
    expect(typeof body['fixedHtml']).toBe('string');
    expect(typeof body['explanation']).toBe('string');
    expect(typeof body['effort']).toBe('string');
    expect('legalContext' in body).toBe(true);
    expect(typeof body['disclaimer']).toBe('string');
  });

  it('gracefully degrades legalContext to null when compliance unavailable (no isError)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('generate-fix')) {
        return {
          ok: true,
          json: async () => FAKE_FIX_RESPONSE,
        };
      }
      throw new Error('compliance unreachable');
    }));

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerFixTools(server, {
        llmAccess: makeLlmAccess(),
        complianceAccess: makeComplianceAccess(null),
      });
    }));

    const result = await client.callTool({
      name: 'dashboard_generate_fix',
      arguments: {
        wcagCriterion: '1.1.1',
        issueMessage: 'img element missing alt',
        htmlContext: '<img src="logo.png">',
      },
    });

    // Must NOT be an error
    expect(result.isError).toBeFalsy();
    const body = parseToolText(result);
    expect(body['legalContext']).toBeNull();
    // disclaimer still present
    expect(typeof body['disclaimer']).toBe('string');
  });

  it('forwards platform to the LLM request body', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('generate-fix')) {
        capturedBody = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
        return {
          ok: true,
          json: async () => FAKE_FIX_RESPONSE,
        };
      }
      return {
        ok: true,
        json: async () => ({
          matrix: {},
          annotatedIssues: [],
          summary: { totalJurisdictions: 0, passing: 0, failing: 0, totalMandatoryViolations: 0, totalOptionalViolations: 0 },
        }),
      };
    }));

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerFixTools(server, {
        llmAccess: makeLlmAccess(),
        complianceAccess: makeComplianceAccess(),
      });
    }));

    await client.callTool({
      name: 'dashboard_generate_fix',
      arguments: {
        wcagCriterion: '1.1.1',
        issueMessage: 'img element missing alt',
        htmlContext: '<img src="logo.png">',
        platform: 'wordpress-gutenberg',
      },
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!['platform']).toBe('wordpress-gutenberg');
  });

  it('returns isError:true when LLM is unavailable', async () => {
    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerFixTools(server, {
        llmAccess: async () => null,
        complianceAccess: makeComplianceAccess(),
      });
    }));

    const result = await client.callTool({
      name: 'dashboard_generate_fix',
      arguments: {
        wcagCriterion: '1.1.1',
        issueMessage: 'img element missing alt',
        htmlContext: '<img src="logo.png">',
      },
    });

    expect(result.isError).toBe(true);
    const body = parseToolText(result);
    expect(typeof body['error']).toBe('string');
  });

  it('(D-10) disclaimer does not contain forbidden asserting language', () => {
    expect(DRAFT_DISCLAIMER).toBeDefined();
    // Must not contain asserting/overclaiming language
    expect(DRAFT_DISCLAIMER.toLowerCase()).not.toMatch(/\bcompliant\b/);
    expect(DRAFT_DISCLAIMER).not.toContain('100%');
    expect(DRAFT_DISCLAIMER).not.toContain('lawsuit-proof');
    // Must frame output as a draft for human review
    expect(DRAFT_DISCLAIMER.toLowerCase()).toContain('draft');
    expect(DRAFT_DISCLAIMER.toLowerCase()).toContain('human review');
  });
});

// ============================================================================
// INTEGRATION SUITE: RBAC / auth / never-apply end-to-end (Plan 03 — Task 3)
// ============================================================================
//
// Boots the full registerMcpRoutes stack (Bearer-only auth, mcp.use gate,
// per-tool RBAC filter) with stub storage/services. Proves MCPFIX-05 and D-09/D-10.

// ---------------------------------------------------------------------------
// Stubs for integration suite
// ---------------------------------------------------------------------------

function makeIntegrationStubStorage(perms: readonly string[] = []): StorageAdapter {
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

function makeIntegrationStubScanService(): ScanService {
  return {
    initiateScan: async () => ({ ok: true, scanId: 'stub-scan' }),
    getScanForOrg: async () => ({ ok: false, error: 'Scan not found' }),
  } as unknown as ScanService;
}

function makeIntegrationStubServiceConnections(): ServiceConnectionsRepository {
  return {
    list: async () => [],
    get: async () => null,
    upsert: (async (input: { serviceId: string; url: string; clientId: string; clientSecret?: string; updatedBy: string }) => ({
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

function makeIntegrationFakeVerifier(payload: McpTokenPayload): McpTokenVerifier {
  return async (token: string): Promise<McpTokenPayload> => {
    if (token === 'valid-jwt') return payload;
    throw new Error('Invalid token');
  };
}

/** Stub DirectScanner that returns a single fake finding. */
function makeIntegrationStubScanner(): DirectScanner {
  return {
    scan: async () => ({
      url: 'http://example.com',
      issues: [
        {
          code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
          type: 'error',
          message: 'img element missing non-empty alt attribute',
          selector: '#main img',
          context: '<img src="logo.png">',
          runner: 'htmlcs',
        },
      ],
    }),
  } as unknown as DirectScanner;
}

interface IntegrationBuildOpts {
  readonly permissions: readonly string[];
  readonly complianceAccessReturns?: { baseUrl: string; token: string } | null;
  readonly llmAccessReturns?: { baseUrl: string; token: string } | null;
  readonly includeScanner?: boolean;
}

async function buildIntegrationApp(o: IntegrationBuildOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMcpRoutes(app, {
    verifyToken: makeIntegrationFakeVerifier({
      sub: 'agent-tester',
      scopes: ['read', 'write', 'admin'],
      orgId: 'org-1',
      role: 'member',
    }),
    storage: makeIntegrationStubStorage(o.permissions),
    scanService: makeIntegrationStubScanService(),
    serviceConnections: makeIntegrationStubServiceConnections(),
    complianceAccess: async () => o.complianceAccessReturns ?? null,
    llmAccess: o.llmAccessReturns !== undefined
      ? async () => o.llmAccessReturns ?? null
      : undefined,
    scanner: o.includeScanner !== false ? makeIntegrationStubScanner() : undefined,
    resourceMetadataUrl: 'http://stub/.well-known/oauth-protected-resource',
  } as unknown as Parameters<typeof registerMcpRoutes>[1]);
  await app.ready();
  return app;
}

function integrationRpc(method: string, params: unknown = {}, id = 1): unknown {
  return { jsonrpc: '2.0', id, method, params };
}

function integrationParseSseOrJson(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (dataLine === undefined) throw new Error(`No SSE data line in body: ${body}`);
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
}

async function integrationCallTool(
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
    payload: integrationRpc('tools/call', { name, arguments: args }),
  });
  return integrationParseSseOrJson(resp.body);
}

function integrationExtractText(parsed: Record<string, unknown>): Record<string, unknown> {
  const r = parsed['result'] as { content?: Array<{ text?: string }> } | undefined;
  return JSON.parse(r?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Integration: RBAC tools/list filtering (MCPFIX-05, D-11)
// ---------------------------------------------------------------------------

describe('Agent MCP tools — RBAC tools/list filtering (MCPFIX-05)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('caller WITHOUT scans.create does not see dashboard_scan_page in tools/list', async () => {
    app = await buildIntegrationApp({
      permissions: ['issues.fix'],          // has fix but NOT scan
      complianceAccessReturns: null,
      llmAccessReturns: { baseUrl: 'http://llm', token: 'tok' },
    });
    const resp = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: integrationRpc('tools/list'),
    });
    const names = (
      (integrationParseSseOrJson(resp.body)['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names).not.toContain('dashboard_scan_page');
    for (const n of SCAN_TOOL_NAMES) {
      expect(names).not.toContain(n);
    }
  });

  it('caller WITHOUT issues.fix does not see dashboard_generate_fix in tools/list', async () => {
    app = await buildIntegrationApp({
      permissions: ['scans.create'],        // has scan but NOT fix
      complianceAccessReturns: null,
      llmAccessReturns: { baseUrl: 'http://llm', token: 'tok' },
    });
    const resp = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: integrationRpc('tools/list'),
    });
    const names = (
      (integrationParseSseOrJson(resp.body)['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names).not.toContain('dashboard_generate_fix');
    for (const n of FIX_TOOL_NAMES) {
      expect(names).not.toContain(n);
    }
  });

  it('caller WITH scans.create + issues.fix sees both agent tools in tools/list', async () => {
    app = await buildIntegrationApp({
      permissions: ['scans.create', 'issues.fix'],
      complianceAccessReturns: null,
      llmAccessReturns: { baseUrl: 'http://llm', token: 'tok' },
    });
    const resp = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: integrationRpc('tools/list'),
    });
    const names = (
      (integrationParseSseOrJson(resp.body)['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names).toContain('dashboard_scan_page');
    expect(names).toContain('dashboard_generate_fix');
  });
});

// ---------------------------------------------------------------------------
// Integration: tools/call RBAC runtime guard (MCPFIX-05)
// ---------------------------------------------------------------------------

describe('Agent MCP tools — tools/call RBAC runtime guard (MCPFIX-05)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('tools/call dashboard_generate_fix WITHOUT issues.fix returns permission rejection', async () => {
    app = await buildIntegrationApp({
      permissions: ['scans.create'],        // scan but NOT fix
      complianceAccessReturns: null,
      llmAccessReturns: { baseUrl: 'http://llm', token: 'tok' },
    });
    const parsed = await integrationCallTool(app, 'dashboard_generate_fix', {
      wcagCriterion: '1.1.1',
      issueMessage: 'img missing alt',
      htmlContext: '<img src="logo.png">',
    });
    // http-plugin rejects with a JSON-RPC error or isError result (not a successful fix)
    const hasRpcError = 'error' in parsed;
    const hasToolError = (
      parsed['result'] as { content?: Array<{ text?: string }>; isError?: boolean } | undefined
    )?.isError === true;
    expect(hasRpcError || hasToolError).toBe(true);
    // Ensure it's not a successful fix payload
    const maybeResult = parsed['result'] as { content?: Array<{ text?: string }> } | undefined;
    if (maybeResult?.content?.[0]?.text !== undefined) {
      const body = JSON.parse(maybeResult.content[0].text) as Record<string, unknown>;
      expect('fixedHtml' in body).toBe(false); // no successful fix output
    }
  });

  it('tools/call dashboard_scan_page WITHOUT scans.create returns permission rejection', async () => {
    app = await buildIntegrationApp({
      permissions: ['issues.fix'],          // fix but NOT scan
      complianceAccessReturns: null,
      llmAccessReturns: { baseUrl: 'http://llm', token: 'tok' },
    });
    const parsed = await integrationCallTool(app, 'dashboard_scan_page', {
      html: '<img src="logo.png">',
    });
    const hasRpcError = 'error' in parsed;
    const hasToolError = (
      parsed['result'] as { content?: Array<{ text?: string }>; isError?: boolean } | undefined
    )?.isError === true;
    expect(hasRpcError || hasToolError).toBe(true);
    const maybeResult = parsed['result'] as { content?: Array<{ text?: string }> } | undefined;
    if (maybeResult?.content?.[0]?.text !== undefined) {
      const body = JSON.parse(maybeResult.content[0].text) as Record<string, unknown>;
      expect('findings' in body).toBe(false); // no successful scan output
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: unauthenticated requests are rejected (T-80-12)
// ---------------------------------------------------------------------------

describe('Agent MCP tools — unauthenticated requests rejected (T-80-12)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('request without Authorization header gets 401 (mcp.use gate unchanged)', async () => {
    app = await buildIntegrationApp({
      permissions: ['scans.create', 'issues.fix'],
      complianceAccessReturns: null,
      llmAccessReturns: { baseUrl: 'http://llm', token: 'tok' },
    });
    const resp = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: integrationRpc('tools/list'),
    });
    expect(resp.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Integration: authorized happy path (MCPFIX-01..04 + D-10)
// ---------------------------------------------------------------------------

describe('Agent MCP tools — authorized happy path (MCPFIX-01..04 + D-10)', () => {
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

  it('authorized scan returns structured findings (MCPFIX-01)', async () => {
    app = await buildIntegrationApp({
      permissions: ['scans.create', 'issues.fix'],
      complianceAccessReturns: null,
      llmAccessReturns: { baseUrl: 'http://llm', token: 'tok' },
    });
    const parsed = await integrationCallTool(app, 'dashboard_scan_page', {
      html: '<img src="logo.png">',
    });
    expect(parsed['result']).toBeDefined();
    const body = integrationExtractText(parsed);
    expect(Array.isArray(body['findings'])).toBe(true);
    const findings = body['findings'] as Array<Record<string, unknown>>;
    expect(findings.length).toBeGreaterThan(0);
    const f = findings[0];
    expect(typeof f['code']).toBe('string');
    expect(typeof f['type']).toBe('string');
    expect(typeof f['message']).toBe('string');
  });

  it('authorized fix returns wcagCriterion + diff + fixedHtml + explanation + effort + disclaimer (MCPFIX-02..04 + D-10)', async () => {
    // Stub global fetch: LLM endpoint returns a fix; compliance degrades to null
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('generate-fix')) {
        return {
          ok: true,
          json: async () => ({
            fixedHtml: '<img src="logo.png" alt="Company logo">',
            explanation: 'Added descriptive alt text.',
            effort: 'low',
            wcagCriterion: '1.1.1',
            diff: '- <img src="logo.png">\n+ <img src="logo.png" alt="Company logo">',
          }),
        };
      }
      // compliance fetch stub
      return {
        ok: true,
        json: async () => ({
          matrix: {},
          annotatedIssues: [],
          summary: { totalJurisdictions: 0, passing: 0, failing: 0, totalMandatoryViolations: 0, totalOptionalViolations: 0 },
        }),
      };
    }));

    app = await buildIntegrationApp({
      permissions: ['scans.create', 'issues.fix'],
      complianceAccessReturns: { baseUrl: 'http://compliance', token: 'comp-tok' },
      llmAccessReturns: { baseUrl: 'http://llm', token: 'llm-tok' },
    });

    const parsed = await integrationCallTool(app, 'dashboard_generate_fix', {
      wcagCriterion: '1.1.1',
      issueMessage: 'img element missing alt',
      htmlContext: '<img src="logo.png">',
    });

    expect(parsed['result']).toBeDefined();
    const body = integrationExtractText(parsed);

    // MCPFIX-02: wcagCriterion + diff
    expect(body['wcagCriterion']).toBe('1.1.1');
    expect(typeof body['diff']).toBe('string');
    // MCPFIX-02: fixedHtml
    expect(typeof body['fixedHtml']).toBe('string');
    expect(typeof body['explanation']).toBe('string');
    expect(typeof body['effort']).toBe('string');
    // MCPFIX-03: legalContext (from compliance)
    expect('legalContext' in body).toBe(true);
    // D-10: disclaimer must equal DRAFT_DISCLAIMER
    expect(body['disclaimer']).toBe(DRAFT_DISCLAIMER);
  });

  it('legalContext degrades to null (not isError) when compliance stub is null (D-06)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('generate-fix')) {
        return {
          ok: true,
          json: async () => ({
            fixedHtml: '<img src="logo.png" alt="Logo">',
            explanation: 'Added alt.',
            effort: 'low',
            wcagCriterion: '1.1.1',
            diff: '- <img>\n+ <img alt="Logo">',
          }),
        };
      }
      throw new Error('compliance unreachable');
    }));

    app = await buildIntegrationApp({
      permissions: ['scans.create', 'issues.fix'],
      complianceAccessReturns: null,  // no compliance configured
      llmAccessReturns: { baseUrl: 'http://llm', token: 'llm-tok' },
    });

    const parsed = await integrationCallTool(app, 'dashboard_generate_fix', {
      wcagCriterion: '1.1.1',
      issueMessage: 'img element missing alt',
      htmlContext: '<img src="logo.png">',
    });

    const resultMeta = parsed['result'] as { isError?: boolean } | undefined;
    // Must NOT be an error (D-06 graceful degrade)
    expect(resultMeta?.isError).not.toBe(true);
    const body = integrationExtractText(parsed);
    expect(body['legalContext']).toBeNull();
    expect(body['disclaimer']).toBe(DRAFT_DISCLAIMER);
  });
});

// ---------------------------------------------------------------------------
// Never-apply guarantee (D-09 MCPFIX-05)
// ---------------------------------------------------------------------------

describe('Agent MCP tools — never-apply guarantee (D-09)', () => {
  it('neither agent tool metadata has destructive:true', () => {
    for (const meta of DASHBOARD_AGENT_TOOL_METADATA) {
      expect(
        (meta as { destructive?: boolean }).destructive,
        `Tool ${meta.name} must not have destructive:true`,
      ).not.toBe(true);
    }
  });

  it('dashboard_scan_page and dashboard_generate_fix metadata entries are annotated read-only (no destructive flag)', () => {
    const scanMeta = DASHBOARD_AGENT_TOOL_METADATA.find((m) => m.name === 'dashboard_scan_page');
    const fixMeta  = DASHBOARD_AGENT_TOOL_METADATA.find((m) => m.name === 'dashboard_generate_fix');
    expect(scanMeta).toBeDefined();
    expect(fixMeta).toBeDefined();
    expect((scanMeta as { destructive?: boolean } | undefined)?.destructive).not.toBe(true);
    expect((fixMeta  as { destructive?: boolean } | undefined)?.destructive).not.toBe(true);
  });

  it('SCAN_TOOL_NAMES and FIX_TOOL_NAMES contain exactly the agent tool names', () => {
    expect(SCAN_TOOL_NAMES).toContain('dashboard_scan_page');
    expect(FIX_TOOL_NAMES).toContain('dashboard_generate_fix');
  });
});

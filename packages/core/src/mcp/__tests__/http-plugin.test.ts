import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { createMcpHttpPlugin } from '../http-plugin.js';
import type { ToolMetadata } from '../types.js';

/**
 * Integration tests for createMcpHttpPlugin.
 *
 * These tests verify the FOUR security-critical paths called out in the plan:
 *   1. 401 when request.tokenPayload is absent (auth gate)
 *   2. 403 when scope is insufficient
 *   3. 200 + MCP initialize response on the happy path
 *   4. tools/list filtered by caller's RBAC permissions (blocker-4 fix —
 *      proves the setRequestHandler(ListToolsRequestSchema) path ran)
 */

const PROTOCOL_VERSION = '2025-11-25';

interface InstalledServer {
  readonly app: FastifyInstance;
  readonly mcpServer: McpServer;
}

async function buildAppWithFakeAuth(
  faux: { tokenPayload?: unknown; orgId?: string; authType?: string; permissions?: Set<string> },
  toolMetadata: readonly ToolMetadata[],
): Promise<InstalledServer> {
  const app = Fastify({ logger: false });

  // Faux auth preHandler mirrors the service-global auth middleware contract:
  // it populates request.tokenPayload, request.orgId, request.authType, and
  // request.permissions. The MCP plugin is registered AFTER this preHandler,
  // so it inherits auth the same way it will in production.
  app.addHook('preHandler', async (request) => {
    const r = request as unknown as Record<string, unknown>;
    if (faux.tokenPayload != null) r['tokenPayload'] = faux.tokenPayload;
    if (faux.orgId != null) r['orgId'] = faux.orgId;
    if (faux.authType != null) r['authType'] = faux.authType;
    if (faux.permissions != null) r['permissions'] = faux.permissions;
  });

  const mcpServer = new McpServer({ name: 'test', version: '0.0.1' });

  // Register two tools: one unannotated (no requiredPermission) and one
  // requiring 'compliance.manage'. The tools/list filter MUST keep the
  // unannotated one visible to a caller with only 'compliance.view', and
  // hide the admin one.
  mcpServer.registerTool(
    'public_health',
    {
      description: 'Public health ping — no auth gate',
      inputSchema: { detail: z.string().optional().describe('Optional detail flag') },
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
  );

  mcpServer.registerTool(
    'compliance_admin_tool',
    {
      description: 'Admin tool that requires compliance.manage',
      inputSchema: { action: z.string().describe('Admin action to perform') },
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
  );

  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata,
    requiredScope: 'read',
    path: '/api/v1/mcp',
  });
  await app.register(plugin);
  await app.ready();

  return { app, mcpServer };
}

function initializePayload(): unknown {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'vitest-client', version: '0.0.1' },
    },
  };
}

function listToolsPayload(): unknown {
  return { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
}

function parseSseOrJson(body: string): Record<string, unknown> {
  // Streamable HTTP responses default to SSE framing (event: message, data: ...).
  // We strip the SSE prefix when present and JSON.parse the payload.
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (dataLine == null) throw new Error(`No SSE data line in body: ${body}`);
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
}

const COMPLIANCE_METADATA: readonly ToolMetadata[] = [
  { name: 'public_health' }, // no requiredPermission
  { name: 'compliance_admin_tool', requiredPermission: 'compliance.manage' },
];

describe('createMcpHttpPlugin', () => {
  let installed: InstalledServer;

  afterEachCleanup(() => installed?.app.close());

  it('returns 401 when tokenPayload is absent (unauthenticated request)', async () => {
    installed = await buildAppWithFakeAuth({}, COMPLIANCE_METADATA);
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: initializePayload(),
    });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error?: string };
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 403 when caller scopes do not cover requiredScope', async () => {
    installed = await buildAppWithFakeAuth(
      {
        // tokenPayload present but has no scopes that cover 'read'
        tokenPayload: { sub: 'u1', scopes: [], orgId: 'org-1' },
        orgId: 'org-1',
        authType: 'jwt',
      },
      COMPLIANCE_METADATA,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: initializePayload(),
    });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { error?: string };
    expect(body.error).toMatch(/Insufficient scope/);
  });

  it('returns 200 + MCP initialize result on happy path with read scope', async () => {
    installed = await buildAppWithFakeAuth(
      {
        tokenPayload: { sub: 'u2', scopes: ['read'], orgId: 'org-2' },
        orgId: 'org-2',
        authType: 'jwt',
        permissions: new Set(['compliance.view']),
      },
      COMPLIANCE_METADATA,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: initializePayload(),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    expect(parsed['jsonrpc']).toBe('2.0');
    expect(parsed['id']).toBe(1);
    const result = parsed['result'] as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result?.['protocolVersion']).toBeDefined();
    expect(result?.['serverInfo']).toBeDefined();
  });

  it('tools/list filters out admin tools when caller only has compliance.view (RBAC filter)', async () => {
    installed = await buildAppWithFakeAuth(
      {
        tokenPayload: { sub: 'u3', scopes: ['read'], orgId: 'org-3' },
        orgId: 'org-3',
        authType: 'jwt',
        permissions: new Set(['compliance.view']),
      },
      COMPLIANCE_METADATA,
    );

    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: listToolsPayload(),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as { tools?: Array<{ name: string }> } | undefined;
    expect(result).toBeDefined();
    const names = (result?.tools ?? []).map((t) => t.name);
    expect(names).toContain('public_health');
    expect(names).not.toContain('compliance_admin_tool');
  });

  it('tools/list returns all tools when caller has admin scope (service-to-service fallback)', async () => {
    installed = await buildAppWithFakeAuth(
      {
        tokenPayload: { sub: 'service-client', scopes: ['admin'] },
        orgId: 'system',
        authType: 'apikey',
      },
      COMPLIANCE_METADATA,
    );

    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: listToolsPayload(),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as { tools?: Array<{ name: string }> } | undefined;
    const names = (result?.tools ?? []).map((t) => t.name);
    expect(names).toContain('public_health');
    expect(names).toContain('compliance_admin_tool');
  });
});

// Small helper because vitest's top-level afterEach is a global, and we want
// to ensure the Fastify app from each test gets closed even on failure.
function afterEachCleanup(fn: () => Promise<unknown> | unknown): void {
  afterEach(async () => {
    await fn();
  });
}

// Import afterEach explicitly so TypeScript resolves the symbol.
// (We don't destructure at the top-level import to keep the helper beneath.)
import { afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Phase 31.2 Plan 03 (D-07 + D-08): RBAC ∩ scope composition + tools/call
// per-tool runtime guard + 30.1 invariant preservation.
// ---------------------------------------------------------------------------

/**
 * Build a Fastify app with a richer fixture for the 31.2 intersection tests.
 * Registers two tools that exercise both halves of the RBAC ∩ scope
 * intersection:
 *   - dashboard_list_reports (requiredPermission: reports.view) — read-tier
 *   - dashboard_scan_site    (requiredPermission: scans.create) — write-tier
 */
async function build312App(
  faux: { tokenPayload?: unknown; orgId?: string; authType?: string; permissions?: Set<string> },
  toolMetadata: readonly ToolMetadata[],
): Promise<InstalledServer> {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async (request) => {
    const r = request as unknown as Record<string, unknown>;
    if (faux.tokenPayload != null) r['tokenPayload'] = faux.tokenPayload;
    if (faux.orgId != null) r['orgId'] = faux.orgId;
    if (faux.authType != null) r['authType'] = faux.authType;
    if (faux.permissions != null) r['permissions'] = faux.permissions;
  });

  const mcpServer = new McpServer({ name: 'test-31-2', version: '0.0.1' });

  mcpServer.registerTool(
    'dashboard_list_reports',
    {
      description: 'List reports (reports.view)',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify({ data: [] }) }],
    }),
  );

  mcpServer.registerTool(
    'dashboard_scan_site',
    {
      description: 'Scan a site (scans.create)',
      inputSchema: { url: z.string().describe('Site URL to scan') },
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify({ scanId: 'stub' }) }],
    }),
  );

  // Unannotated tool — informational; no requiredPermission.
  mcpServer.registerTool(
    'dashboard_info',
    {
      description: 'No-permission informational tool',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
    }),
  );

  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata,
    requiredScope: 'read',
    path: '/api/v1/mcp',
  });
  await app.register(plugin);
  await app.ready();

  return { app, mcpServer };
}

const TOOLS_31_2: readonly ToolMetadata[] = [
  { name: 'dashboard_list_reports', requiredPermission: 'reports.view' },
  { name: 'dashboard_scan_site', requiredPermission: 'scans.create', destructive: true },
  { name: 'dashboard_info' }, // unannotated — D-04 carry-forward
];

function callToolPayload(name: string, args: unknown, id = 4): unknown {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

describe('createMcpHttpPlugin — Phase 31.2 RBAC ∩ scope intersection (D-07)', () => {
  let installed: InstalledServer;
  afterEachCleanup(() => installed?.app.close());

  it('Test A: user w/ {scans.create, reports.view} + scope=read → sees reports.view tool, NOT scans.create (read-tier excludes write)', async () => {
    installed = await build312App(
      {
        tokenPayload: { sub: 'u-A', scopes: ['read'], orgId: 'org-1' },
        orgId: 'org-1',
        authType: 'jwt',
        permissions: new Set(['scans.create', 'reports.view']),
      },
      TOOLS_31_2,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: listToolsPayload(),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as { tools?: Array<{ name: string }> } | undefined;
    const names = (result?.tools ?? []).map((t) => t.name);
    expect(names).toContain('dashboard_list_reports'); // scope=read allows .view + RBAC has reports.view ✓
    expect(names).toContain('dashboard_info');          // unannotated passes both filters
    expect(names).not.toContain('dashboard_scan_site'); // scope=read excludes write-tier despite RBAC pass
  });

  it('Test B: user w/ {reports.view} + scope=write → sees reports.view, NOT scans.create (RBAC narrows)', async () => {
    installed = await build312App(
      {
        tokenPayload: { sub: 'u-B', scopes: ['write'], orgId: 'org-1' },
        orgId: 'org-1',
        authType: 'jwt',
        permissions: new Set(['reports.view']),
      },
      TOOLS_31_2,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: listToolsPayload(),
    });
    const parsed = parseSseOrJson(response.body);
    const names = (
      (parsed['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names).toContain('dashboard_list_reports');
    expect(names).toContain('dashboard_info');
    expect(names).not.toContain('dashboard_scan_site'); // scope=write allows, but RBAC lacks scans.create
  });

  it('Test C: user w/ {scans.create, reports.view} + scope=write → sees BOTH (intersection kept)', async () => {
    installed = await build312App(
      {
        tokenPayload: { sub: 'u-C', scopes: ['write'], orgId: 'org-1' },
        orgId: 'org-1',
        authType: 'jwt',
        permissions: new Set(['scans.create', 'reports.view']),
      },
      TOOLS_31_2,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: listToolsPayload(),
    });
    const parsed = parseSseOrJson(response.body);
    const names = (
      (parsed['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names).toContain('dashboard_list_reports');
    expect(names).toContain('dashboard_scan_site');
    expect(names).toContain('dashboard_info');
  });

  it('Test F (30.1 non-regression): S2S caller w/ empty perms + scope=read → scope-filter is authoritative', async () => {
    installed = await build312App(
      {
        tokenPayload: { sub: 'service-client', scopes: ['read'] },
        orgId: 'system',
        authType: 'apikey',
        permissions: new Set<string>(), // empty perms — S2S branch
      },
      TOOLS_31_2,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: listToolsPayload(),
    });
    const parsed = parseSseOrJson(response.body);
    const names = (
      (parsed['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    // 30.1 invariant: S2S read scope sees read-tier tools only.
    expect(names).toContain('dashboard_list_reports');
    expect(names).toContain('dashboard_info');
    expect(names).not.toContain('dashboard_scan_site');
  });
});

describe('createMcpHttpPlugin — Phase 31.2 tools/call runtime guard (D-08)', () => {
  let installed: InstalledServer;
  afterEachCleanup(() => installed?.app.close());

  it('Test D: tools/call on dashboard_scan_site without scans.create returns MCP error envelope (isError=true, Forbidden text)', async () => {
    installed = await build312App(
      {
        tokenPayload: { sub: 'u-D', scopes: ['write'], orgId: 'org-1' },
        orgId: 'org-1',
        authType: 'jwt',
        permissions: new Set(['reports.view']), // NO scans.create
      },
      TOOLS_31_2,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: callToolPayload('dashboard_scan_site', { url: 'https://example.com' }),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as
      | { isError?: boolean; content?: Array<{ text?: string }> }
      | undefined;
    expect(result?.isError).toBe(true);
    const text = result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/Forbidden|insufficient permission/i);
    expect(text).toContain('scans.create'); // surfaces the missing permission for client self-diagnosis
  });

  it('Test E: tools/call on unannotated tool (no requiredPermission) dispatches normally', async () => {
    installed = await build312App(
      {
        tokenPayload: { sub: 'u-E', scopes: ['read'], orgId: 'org-1' },
        orgId: 'org-1',
        authType: 'jwt',
        permissions: new Set(['reports.view']),
      },
      TOOLS_31_2,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: callToolPayload('dashboard_info', {}),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as
      | { isError?: boolean; content?: Array<{ text?: string }> }
      | undefined;
    expect(result?.isError).not.toBe(true);
    const text = result?.content?.[0]?.text ?? '';
    expect(text).toContain('"ok":true');
  });

  it('Test D-authorized: tools/call on dashboard_scan_site WITH scans.create dispatches normally', async () => {
    installed = await build312App(
      {
        tokenPayload: { sub: 'u-D2', scopes: ['write'], orgId: 'org-1' },
        orgId: 'org-1',
        authType: 'jwt',
        permissions: new Set(['scans.create', 'reports.view']),
      },
      TOOLS_31_2,
    );
    const response = await installed.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: callToolPayload('dashboard_scan_site', { url: 'https://example.com' }),
    });
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as
      | { isError?: boolean; content?: Array<{ text?: string }> }
      | undefined;
    expect(result?.isError).not.toBe(true);
    const text = result?.content?.[0]?.text ?? '';
    expect(text).toContain('"scanId":"stub"');
  });
});

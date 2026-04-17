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

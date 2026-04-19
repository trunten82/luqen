/**
 * Integration tests for POST /api/v1/mcp on the LLM service.
 *
 * Phase 29 (MCPT-03) populates the tool catalogue with 4 GLOBAL tools:
 *   - llm_generate_fix, llm_analyse_report, llm_discover_branding,
 *     llm_extract_requirements
 *
 * These tests verify:
 *   - 401 without Bearer (MCPI-02)
 *   - 200 MCP initialize with valid Bearer (MCPI-01)
 *   - tools/list with read scope returns exactly the 4 LLM tool names
 *   - tools/list admin scope sees all 4 via scope fallback
 *   - D-13 runtime guard — NO tool inputSchema contains orgId (MCPI-04)
 *   - Classification coverage — all 4 handlers are GLOBAL, zero TODO(phase-30)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import { createLlmMcpServer } from '../../src/mcp/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = '2025-11-25';
const TEST_DB = '/tmp/llm-mcp-test.db';

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
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (dataLine == null) throw new Error(`No SSE data line in body: ${body}`);
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
}

function cleanup(): void {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('POST /api/v1/mcp — llm', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let readToken: string;
  let adminToken: string;

  beforeAll(async () => {
    // Phase 31.1 Plan 03: force the MCP-facing preHandler to reuse the
    // local-signed `verifyToken` instead of fetching the dashboard JWKS —
    // the test mints tokens with the in-memory keypair created just below,
    // so there's no dashboard to stand up. See server.ts fallback branch.
    process.env['DASHBOARD_JWKS_URL'] = '';

    cleanup();
    const db = new SqliteAdapter(TEST_DB);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    const signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      logger: false,
    });
    await app.ready();

    readToken = await signToken({
      sub: 'test-read',
      scopes: ['read'],
      expiresIn: '1h',
    });

    adminToken = await signToken({
      sub: 'test-admin',
      scopes: ['admin'],
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it('returns 401 when no Bearer token is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: initializePayload(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 200 MCP initialize with valid Bearer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: `Bearer ${readToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: initializePayload(),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result?.['protocolVersion']).toBeDefined();
    const serverInfo = result?.['serverInfo'] as { name?: string } | undefined;
    expect(serverInfo?.name).toBe('luqen-llm');
  });

  it('tools/list with read scope — returns exactly the 4 LLM tools', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: `Bearer ${readToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: listToolsPayload(),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as { tools?: Array<{ name: string }> } | undefined;
    const names = (result?.tools ?? []).map((t) => t.name);
    expect(names).toContain('llm_generate_fix');
    expect(names).toContain('llm_analyse_report');
    expect(names).toContain('llm_discover_branding');
    expect(names).toContain('llm_extract_requirements');
    expect(names.length).toBe(4);
  });

  it('tools/list admin scope — all 4 LLM tools visible via scope fallback', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: listToolsPayload(),
    });
    expect(response.statusCode).toBe(200);
    const parsed = parseSseOrJson(response.body);
    const result = parsed['result'] as { tools?: Array<{ name: string }> } | undefined;
    const names = (result?.tools ?? []).map((t) => t.name);
    expect(names.length).toBe(4);
  });

  it('MCPI-04 runtime guard — NO LLM tool inputSchema contains orgId (D-13)', async () => {
    // Build an isolated server instance purely to iterate registered tools.
    const freshDb = new SqliteAdapter(':memory:');
    const { server, metadata, toolNames } = await createLlmMcpServer({ db: freshDb });

    // Metadata + toolNames shape check: all 4 tools present, no orgId anywhere.
    expect(toolNames.length).toBe(4);
    expect(metadata.length).toBe(4);

    const registered = (server as unknown as {
      _registeredTools?: Record<string, { inputSchema?: unknown }>;
    })._registeredTools ?? {};
    const entries = Object.entries(registered);
    expect(entries.length).toBe(4);

    for (const [name, tool] of entries) {
      // McpServer stores the raw zod SCHEMA at inputSchema. We try every
      // reasonable shape-extraction path and fall back to serialising the
      // whole thing to JSON for a grep-level safety net (a recursive check
      // would risk false negatives on nested types).
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
      expect(shapeRecord, `tool ${name} must not accept orgId (D-13, MCPI-04)`).not.toHaveProperty('orgId');
      // Belt-and-braces: no orgId token anywhere in the serialised schema.
      let serialised = '';
      try {
        serialised = JSON.stringify(schema, (_k, v) => (typeof v === 'function' ? '[fn]' : v));
      } catch {
        serialised = String(schema);
      }
      expect(serialised.includes('"orgId"'), `tool ${name} schema must not contain "orgId" (D-13)`).toBe(false);
    }

    await freshDb.close();
  });

  it('Classification coverage — all 4 LLM handlers are GLOBAL, NO TODO(phase-30) deferrals', async () => {
    const source = await readFile(resolve(__dirname, '../../src/mcp/server.ts'), 'utf-8');
    expect(source).not.toMatch(/TODO\(phase-30\)/);
    expect(source).not.toMatch(/TODO phase-30/);
    expect(source).not.toMatch(/TODO phase 30/);

    // Every one of the 4 tool handlers must carry EITHER a GLOBAL marker
    // ("orgId: N/A") OR an ORG-SCOPED marker ("orgId: ctx.orgId"). The total
    // classification comments must be exactly 4 — one per tool — with no gaps.
    const globalMatches = source.match(/\/\/ orgId: N\/A /g) ?? [];
    const orgScopedMatches = source.match(/\/\/ orgId: ctx\.orgId /g) ?? [];
    const totalClassifications = globalMatches.length + orgScopedMatches.length;
    expect(totalClassifications).toBe(4);

    // All 4 LLM tools are GLOBAL (D-06) — no org-scoped DB reads. orgId is
    // used only for per-org prompt overrides inside the capability executor.
    expect(globalMatches.length).toBe(4);
    expect(orgScopedMatches.length).toBe(0);

    // D-13 invariant — no zod schema declares an orgId field.
    expect(source).not.toMatch(/orgId\s*:\s*z\./);

    // PITFALLS.md #11 — no stdout console.log may exist in the stdio-shared file.
    expect(source).not.toMatch(/console\.log/);
  });
});

/**
 * Integration tests for POST /api/v1/mcp on the branding service.
 *
 * Phase 28 delivers the MCP TRANSPORT for branding — the tool catalogue is
 * empty (Phase 29 populates it). These tests verify:
 *   - 401 without Bearer (MCPI-02)
 *   - 200 MCP initialize with valid Bearer (MCPI-01)
 *   - 200 tools/list returning an empty but valid list
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import type { FastifyInstance } from 'fastify';

const PROTOCOL_VERSION = '2025-11-25';

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

describe('POST /api/v1/mcp — branding', () => {
  let app: FastifyInstance;
  let readToken: string;

  beforeAll(async () => {
    const db = new SqliteAdapter(':memory:');
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
  });

  afterAll(async () => {
    await app.close();
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
    expect(serverInfo?.name).toBe('luqen-branding');
  });

  it('returns 200 with empty tools list', async () => {
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
    expect(result).toBeDefined();
    expect(Array.isArray(result?.tools)).toBe(true);
    expect(result?.tools?.length).toBe(0);
  });
});

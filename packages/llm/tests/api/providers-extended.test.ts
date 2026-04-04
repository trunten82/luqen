import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

// Mock the registry so provider test/list-models don't require a real LLM
vi.mock('../../src/providers/registry.js', () => ({
  createAdapter: vi.fn(),
  getSupportedTypes: vi.fn(() => ['ollama', 'openai']),
}));

import { createAdapter } from '../../src/providers/registry.js';
const mockCreateAdapter = vi.mocked(createAdapter);

const TEST_DB = '/tmp/llm-prov-ext-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

function makeMockAdapter(healthy: boolean, models: Array<{ id: string; name: string }> = []) {
  return {
    type: 'mock',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(healthy),
    listModels: vi.fn().mockResolvedValue(models),
    complete: vi.fn(),
  };
}

describe('Provider API (extended)', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let adminToken: string;
  let providerId: string;

  beforeAll(async () => {
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

    adminToken = await signToken({
      sub: 'admin-user',
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });

    // Create a base provider for tests
    mockCreateAdapter.mockReturnValue(makeMockAdapter(true));
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Ext Test Provider',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
      },
    });
    providerId = createRes.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  describe('GET /api/v1/providers/:id', () => {
    it('returns 200 with provider details', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/providers/${providerId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ id: string; name: string }>();
      expect(body.id).toBe(providerId);
      expect(body.name).toBe('Ext Test Provider');
    });

    it('returns 404 for nonexistent provider', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers/nonexistent-id',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/v1/providers/:id', () => {
    it('returns 404 when provider does not exist', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/providers/does-not-exist',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Updated' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('updates status field correctly', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/providers/${providerId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'inactive' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('inactive');
    });
  });

  describe('POST /api/v1/providers (validation)', () => {
    it('returns 400 when required fields missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Missing type and url' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/providers/:id/test', () => {
    it('returns 200 with ok:true when adapter is healthy', async () => {
      mockCreateAdapter.mockReturnValueOnce(makeMockAdapter(true));

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/providers/${providerId}/test`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ ok: boolean; status: string }>();
      expect(body.ok).toBe(true);
      expect(body.status).toBe('active');
    });

    it('returns 200 with ok:false when adapter is unhealthy', async () => {
      mockCreateAdapter.mockReturnValueOnce(makeMockAdapter(false));

      // Create a fresh provider for this test
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Unhealthy Provider', type: 'ollama', baseUrl: 'http://localhost:11434' },
      });
      const unhealthyId = createRes.json<{ id: string }>().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/providers/${unhealthyId}/test`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ ok: boolean; status: string }>();
      expect(body.ok).toBe(false);
      expect(body.status).toBe('error');
    });

    it('returns 404 when provider does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/providers/nonexistent/test',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 502 when adapter connect throws', async () => {
      const failingAdapter = makeMockAdapter(true);
      failingAdapter.connect = vi.fn().mockRejectedValue(new Error('Connection refused'));
      mockCreateAdapter.mockReturnValueOnce(failingAdapter);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/providers/${providerId}/test`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(502);
    });
  });

  describe('GET /api/v1/providers/:id/models', () => {
    it('returns 200 with models list from adapter', async () => {
      const testModels = [
        { id: 'llama3.2', name: 'Llama 3.2' },
        { id: 'mistral', name: 'Mistral' },
      ];
      mockCreateAdapter.mockReturnValueOnce(makeMockAdapter(true, testModels));

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/providers/${providerId}/models`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const models = res.json<Array<{ id: string; name: string }>>();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(2);
      expect(models[0].id).toBe('llama3.2');
    });

    it('returns 404 when provider does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers/nonexistent/models',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 502 when adapter list fails', async () => {
      const failingAdapter = makeMockAdapter(true);
      failingAdapter.listModels = vi.fn().mockRejectedValue(new Error('Network error'));
      // connect succeeds but listModels fails
      mockCreateAdapter.mockReturnValueOnce(failingAdapter);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/providers/${providerId}/models`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(502);
    });
  });
});

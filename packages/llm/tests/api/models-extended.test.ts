import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-models-ext-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Model API (extended)', () => {
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

    // Create a provider
    const providerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Ext Models Provider', type: 'ollama', baseUrl: 'http://localhost:11434' },
    });
    providerId = providerRes.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  describe('POST /api/v1/models (validation)', () => {
    it('returns 400 when providerId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/models',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { modelId: 'llama3.2', displayName: 'Llama 3.2' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when modelId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/models',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { providerId, displayName: 'Llama 3.2' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when displayName is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/models',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { providerId, modelId: 'llama3.2' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when providerId references nonexistent provider', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/models',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { providerId: 'does-not-exist', modelId: 'model-x', displayName: 'Model X' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/Provider not found/);
    });
  });

  describe('GET /api/v1/models/:id', () => {
    it('returns 404 for nonexistent model', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/models/nonexistent-model-id',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 200 with model for existing id', async () => {
      // Create a model first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/models',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { providerId, modelId: 'gemma-test', displayName: 'Gemma Test' },
      });
      const created = createRes.json<{ id: string }>();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/models/${created.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ modelId: string }>().modelId).toBe('gemma-test');
    });
  });

  describe('DELETE /api/v1/models/:id', () => {
    it('returns 404 when model does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/models/does-not-exist',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/models?providerId=X', () => {
    it('returns empty array for provider with no models', async () => {
      // Create a fresh provider
      const p2Res = await app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Empty Provider', type: 'openai', baseUrl: 'https://api.openai.com' },
      });
      const emptyProviderId = p2Res.json<{ id: string }>().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/models?providerId=${emptyProviderId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const models = res.json<unknown[]>();
      expect(models.length).toBe(0);
    });
  });
});

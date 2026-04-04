import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-capabilities-ext-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Capability API (extended)', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let adminToken: string;
  let modelId: string;

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

    // Create a provider and model
    const providerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Cap Ext Provider', type: 'ollama', baseUrl: 'http://localhost:11434' },
    });
    const modelRes = await app.inject({
      method: 'POST',
      url: '/api/v1/models',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerId: providerRes.json<{ id: string }>().id,
        modelId: 'llama3.2',
        displayName: 'Llama 3.2',
      },
    });
    modelId = modelRes.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  describe('PUT /api/v1/capabilities/:name/assign (validation)', () => {
    it('returns 400 when modelId is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/capabilities/generate-fix/assign',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/modelId/);
    });

    it('returns 400 when model does not exist', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/capabilities/generate-fix/assign',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { modelId: 'nonexistent-model-id' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/Model not found/);
    });

    it('accepts explicit priority value', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/capabilities/generate-fix/assign',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { modelId, priority: 5 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ priority: number }>().priority).toBe(5);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/capabilities/bad-name/assign',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { modelId },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/v1/capabilities/:name/assign/:modelId', () => {
    beforeAll(async () => {
      // Assign model first so we can patch it
      await app.inject({
        method: 'PUT',
        url: '/api/v1/capabilities/analyse-report/assign',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { modelId, priority: 1 },
      });
    });

    it('updates priority and returns updated: true', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/capabilities/analyse-report/assign/${modelId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { priority: 10 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ updated: boolean; priority: number }>();
      expect(body.updated).toBe(true);
      expect(body.priority).toBe(10);
    });

    it('returns 400 when priority is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/capabilities/analyse-report/assign/${modelId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/priority/);
    });

    it('returns 400 when priority is not a number', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/capabilities/analyse-report/assign/${modelId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { priority: 'high' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/capabilities/invalid-cap/assign/${modelId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { priority: 5 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/capabilities/:name/assign/:modelId (extended)', () => {
    it('returns 404 when assignment does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/capabilities/discover-branding/assign/nonexistent-model-id',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/capabilities/bad-capability/assign/some-model',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

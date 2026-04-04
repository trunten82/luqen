import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-models-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Model API', () => {
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
      sub: 'test-admin',
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });

    // Create a provider to use in tests
    const providerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Models Test Provider',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
      },
    });
    const provider = providerRes.json<{ id: string }>();
    providerId = provider.id;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  // 1. POST registers a model
  it('POST /api/v1/models registers a model', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/models',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerId,
        modelId: 'llama3.2',
        displayName: 'Llama 3.2',
        capabilities: ['generate-fix', 'analyse-report'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      id: string;
      modelId: string;
      capabilities: string[];
    }>();
    expect(body.id).toBeDefined();
    expect(body.modelId).toBe('llama3.2');
    expect(body.capabilities).toContain('generate-fix');
    expect(body.capabilities).toContain('analyse-report');
  });

  // 2. GET lists models
  it('GET /api/v1/models lists models', async () => {
    // Ensure at least one model exists
    await app.inject({
      method: 'POST',
      url: '/api/v1/models',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerId,
        modelId: 'mistral',
        displayName: 'Mistral 7B',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/models',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const models = response.json<unknown[]>();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  // 3. GET with ?providerId filters
  it('GET /api/v1/models?providerId filters by provider', async () => {
    // Create a second provider and model
    const p2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Other Provider',
        type: 'openai',
        baseUrl: 'https://api.openai.com',
      },
    });
    const p2 = p2Res.json<{ id: string }>();

    await app.inject({
      method: 'POST',
      url: '/api/v1/models',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerId: p2.id,
        modelId: 'gpt-4o',
        displayName: 'GPT-4o',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/models?providerId=${providerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const models = response.json<Array<{ providerId: string }>>();
    expect(Array.isArray(models)).toBe(true);
    // All returned models should belong to the original provider
    for (const m of models) {
      expect(m.providerId).toBe(providerId);
    }
  });

  // 4. DELETE removes a model
  it('DELETE /api/v1/models/:id removes a model', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/models',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerId,
        modelId: 'gemma2',
        displayName: 'Gemma 2',
      },
    });
    const created = createRes.json<{ id: string }>();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/models/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/models/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(404);
  });
});

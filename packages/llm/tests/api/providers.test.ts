import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-providers-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Provider API', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let adminToken: string;

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
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  // 1. POST creates a provider
  it('POST /api/v1/providers creates a provider', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Test Ollama',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ id: string; name: string; type: string; status: string }>();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Test Ollama');
    expect(body.type).toBe('ollama');
    expect(body.status).toBe('active');
    // apiKey must not be in the response
    expect((body as Record<string, unknown>).apiKey).toBeUndefined();
  });

  // 2. GET lists providers without apiKey
  it('GET /api/v1/providers lists providers without apiKey', async () => {
    // Create a provider with apiKey
    await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'OpenAI Test',
        type: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-secret-key',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const providers = response.json<Array<Record<string, unknown>>>();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
    // No apiKey should be present in any provider
    for (const p of providers) {
      expect(p.apiKey).toBeUndefined();
    }
  });

  // 3. PATCH updates provider
  it('PATCH /api/v1/providers/:id updates provider', async () => {
    // Create a provider first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Provider To Update',
        type: 'ollama',
        baseUrl: 'http://original.com',
      },
    });
    const created = createRes.json<{ id: string }>();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/providers/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Updated Provider Name', baseUrl: 'http://updated.com' },
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json<{ name: string; baseUrl: string }>();
    expect(updated.name).toBe('Updated Provider Name');
    expect(updated.baseUrl).toBe('http://updated.com');
  });

  // 4. DELETE removes provider
  it('DELETE /api/v1/providers/:id removes provider', async () => {
    // Create a provider first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Provider To Delete',
        type: 'ollama',
        baseUrl: 'http://delete-me.com',
      },
    });
    const created = createRes.json<{ id: string }>();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/providers/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/providers/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(404);
  });

  // 5. Returns 401 without auth token
  it('returns 401 without auth token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/providers',
    });

    expect(response.statusCode).toBe(401);
  });
});

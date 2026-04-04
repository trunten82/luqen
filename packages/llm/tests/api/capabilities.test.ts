import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import { CAPABILITY_NAMES } from '../../src/types.js';

const TEST_DB = '/tmp/llm-capabilities-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Capability API', () => {
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
      sub: 'test-admin',
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });

    // Create a provider and model for capability tests
    const providerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Capability Test Provider',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
      },
    });
    const provider = providerRes.json<{ id: string }>();

    const modelRes = await app.inject({
      method: 'POST',
      url: '/api/v1/models',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerId: provider.id,
        modelId: 'llama3.2',
        displayName: 'Llama 3.2',
      },
    });
    const model = modelRes.json<{ id: string }>();
    modelId = model.id;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  // 1. GET lists all 4 capabilities
  it('GET /api/v1/capabilities lists all 4 capabilities', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const capabilities = response.json<Array<{ name: string; assignments: unknown[] }>>();
    expect(Array.isArray(capabilities)).toBe(true);
    expect(capabilities.length).toBe(CAPABILITY_NAMES.length);

    // All 4 capability names should be present
    const names = capabilities.map(c => c.name);
    for (const name of CAPABILITY_NAMES) {
      expect(names).toContain(name);
    }
  });

  // 2. PUT assigns a model to a capability
  it('PUT /api/v1/capabilities/:name/assign assigns a model', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/capabilities/generate-fix/assign',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { modelId },
    });

    expect(response.statusCode).toBe(200);
    const assignment = response.json<{ capability: string; modelId: string }>();
    expect(assignment.capability).toBe('generate-fix');
    expect(assignment.modelId).toBe(modelId);
  });

  // 3. DELETE unassigns a model from a capability
  it('DELETE /api/v1/capabilities/:name/assign/:modelId unassigns', async () => {
    // Assign first
    await app.inject({
      method: 'PUT',
      url: '/api/v1/capabilities/analyse-report/assign',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { modelId },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/capabilities/analyse-report/assign/${modelId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(204);
  });

  // 4. GET /api/v1/status shows capability coverage
  it('GET /api/v1/status shows capability coverage', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const status = response.json<{
      providers: number;
      models: number;
      capabilities: { total: number; covered: number; coverage: number };
    }>();
    expect(typeof status.providers).toBe('number');
    expect(typeof status.models).toBe('number');
    expect(status.capabilities.total).toBe(CAPABILITY_NAMES.length);
    expect(typeof status.capabilities.covered).toBe('number');
    expect(typeof status.capabilities.coverage).toBe('number');
  });

  // 5. Rejects invalid capability name
  it('PUT rejects invalid capability name with 400', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/capabilities/invalid-capability/assign',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { modelId },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: string }>();
    expect(body.error).toContain('Invalid capability name');
  });
});

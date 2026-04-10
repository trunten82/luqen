import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import { buildExtractionPrompt } from '../../src/prompts/extract-requirements.js';

// Build a valid override for extract-requirements: prepend a custom line before the default
// so locked blocks remain byte-identical while free regions are customised.
const EXTRACT_DEFAULT = buildExtractionPrompt(
  '{content}',
  { regulationId: '{regulationId}', regulationName: '{regulationName}' },
);
const VALID_EXTRACT_OVERRIDE = 'My custom template note.\n' + EXTRACT_DEFAULT;

const TEST_DB = '/tmp/llm-prompts-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Prompt Override API', () => {
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

  // 1. List returns empty array initially
  it('GET /api/v1/prompts returns empty list initially', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/prompts',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  // 2. Create override
  it('PUT /api/v1/prompts/:capability creates a prompt override', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/prompts/extract-requirements',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        template: VALID_EXTRACT_OVERRIDE,
        orgId: 'test-org',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      capability: string;
      orgId: string;
      template: string;
      isOverride: boolean;
      updatedAt: string;
    }>();
    expect(body.capability).toBe('extract-requirements');
    expect(body.orgId).toBe('test-org');
    expect(body.template).toBe(VALID_EXTRACT_OVERRIDE);
    expect(body.isOverride).toBe(true);
    expect(body.updatedAt).toBeTruthy();
  });

  // 3. Get override returns the custom template
  it('GET /api/v1/prompts/:capability returns the override', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/prompts/extract-requirements?orgId=test-org',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      capability: string;
      template: string;
      isOverride: boolean;
    }>();
    expect(body.capability).toBe('extract-requirements');
    expect(body.isOverride).toBe(true);
    expect(body.template).toContain('My custom template note.');
  });

  // 4. Delete override
  it('DELETE /api/v1/prompts/:capability deletes the override', async () => {
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/prompts/extract-requirements?orgId=test-org',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(deleteRes.statusCode).toBe(204);

    // After delete, GET should return isOverride: false
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/prompts/extract-requirements?orgId=test-org',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json<{ isOverride: boolean }>();
    expect(body.isOverride).toBe(false);
  });

  // 5. Reject invalid capability name
  it('PUT rejects invalid capability name with 400', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/prompts/invalid-capability',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { template: 'something' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: string }>();
    expect(body.error).toContain('Invalid capability');
  });
});

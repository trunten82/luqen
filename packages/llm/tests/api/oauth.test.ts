import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier, hashClientSecret } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-oauth-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('OAuth Routes', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let db: SqliteAdapter;
  let testClientId: string;
  const testClientSecret = 'super-secret-test-client-secret-123';

  beforeAll(async () => {
    cleanup();
    db = new SqliteAdapter(TEST_DB);
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

    // Seed a test OAuth client directly in the DB
    const secretHash = await hashClientSecret(testClientSecret);
    const client = await db.createClient({
      name: 'Test OAuth Client',
      secretHash,
      scopes: ['read', 'write'],
      grantTypes: ['client_credentials'],
      orgId: 'system',
    });
    testClientId = client.id;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  describe('POST /api/v1/oauth/token', () => {
    it('returns access_token with valid client_credentials grant', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'client_credentials',
          client_id: testClientId,
          client_secret: testClientSecret,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ access_token: string; token_type: string; expires_in: number; scope: string }>();
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toMatch(/bearer/i);
      expect(body.expires_in).toBeGreaterThan(0);
      expect(body.scope).toBeDefined();
    });

    it('returns 401 with invalid client_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'client_credentials',
          client_id: 'nonexistent-client-id',
          client_secret: testClientSecret,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/invalid_client/);
    });

    it('returns 401 with wrong client_secret', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'client_credentials',
          client_id: testClientId,
          client_secret: 'wrong-secret',
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/invalid_client/);
    });

    it('returns 400 when grant_type is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          client_id: testClientId,
          client_secret: testClientSecret,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for unsupported grant_type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: testClientId,
          client_secret: testClientSecret,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/unsupported_grant_type/);
    });

    it('returns 400 when client_credentials requested but client_id missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'client_credentials',
          client_secret: testClientSecret,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('accepts client credentials via Basic auth header', async () => {
      const encoded = Buffer.from(`${testClientId}:${testClientSecret}`).toString('base64');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        headers: { authorization: `Basic ${encoded}` },
        payload: { grant_type: 'client_credentials' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().access_token).toBeDefined();
    });

    it('returns 400 for invalid_scope when requested scope not allowed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'client_credentials',
          client_id: testClientId,
          client_secret: testClientSecret,
          scope: 'admin',
        },
      });

      // Client only has read/write — requesting admin should fail
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/invalid_scope/);
    });

    it('filters scopes to allowed subset when requesting partial scopes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'client_credentials',
          client_id: testClientId,
          client_secret: testClientSecret,
          scope: 'read',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().scope).toBe('read');
    });
  });

  describe('POST /api/v1/oauth/revoke', () => {
    it('returns 200 with revoked: true (stateless best-effort)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/revoke',
        payload: { token: 'any-token-value' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().revoked).toBe(true);
    });

    it('returns 200 even with empty body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/revoke',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
    });
  });
});

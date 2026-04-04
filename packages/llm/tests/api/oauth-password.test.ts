import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier, hashPassword } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-oauth-password-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('OAuth Password Grant and Token Expiry Formats', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let db: SqliteAdapter;
  const testUsername = 'test-admin-user';
  const testPassword = 'Sup3rS3cur3Pass!';

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
      tokenExpiry: '30m',  // Use minutes format to test parseExpiryToSeconds('m' case)
      logger: false,
    });

    await app.ready();

    // Seed a test user
    const passwordHash = await hashPassword(testPassword);
    await db.createUser({
      username: testUsername,
      passwordHash,
      role: 'admin',
    });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  describe('Password grant flow', () => {
    it('returns access_token with valid username/password (admin user)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'password',
          username: testUsername,
          password: testPassword,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ access_token: string; token_type: string; expires_in: number; scope: string }>();
      expect(body.access_token).toBeDefined();
      // 30m = 1800 seconds
      expect(body.expires_in).toBe(1800);
      expect(body.scope).toContain('read');
      expect(body.scope).toContain('admin');
    });

    it('returns 401 for wrong password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'password',
          username: testUsername,
          password: 'wrongpassword',
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/invalid_grant/);
    });

    it('returns 401 for unknown username', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'password',
          username: 'nobody',
          password: 'somepass',
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/invalid_grant/);
    });

    it('returns 400 when username is missing from password grant', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'password',
          password: testPassword,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when password is missing from password grant', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'password',
          username: testUsername,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('filters requested scopes against user role permissions', async () => {
      // Seed a viewer user
      const viewerHash = await hashPassword('viewerpass');
      await db.createUser({
        username: 'viewer-test-user',
        passwordHash: viewerHash,
        role: 'viewer',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'password',
          username: 'viewer-test-user',
          password: 'viewerpass',
          scope: 'read',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().scope).toBe('read');
    });

    it('returns 400 when requested scope not allowed for user role', async () => {
      // Seed a viewer user who requests admin scope
      const viewerHash = await hashPassword('viewerpass2');
      await db.createUser({
        username: 'viewer-test-user2',
        passwordHash: viewerHash,
        role: 'viewer',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'password',
          username: 'viewer-test-user2',
          password: 'viewerpass2',
          scope: 'admin',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/invalid_scope/);
    });
  });

  describe('Token expiry format (minutes)', () => {
    it('expires_in is 1800 for tokenExpiry=30m', async () => {
      // Re-use the password grant above — already uses 30m server
      const passwordHash = await hashPassword('testpass123');
      await db.createUser({
        username: 'expiry-test-user',
        passwordHash,
        role: 'editor',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {
          grant_type: 'password',
          username: 'expiry-test-user',
          password: 'testpass123',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ expires_in: number }>().expires_in).toBe(1800);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-clients-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('OAuth Client Routes', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let adminToken: string;
  let readToken: string;

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

    readToken = await signToken({
      sub: 'read-user',
      scopes: ['read'],
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  describe('GET /api/v1/clients', () => {
    it('returns 200 with list when admin scope present', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const clients = res.json<unknown[]>();
      expect(Array.isArray(clients)).toBe(true);
    });

    it('returns 401 when no auth header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/clients',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when only read scope (not admin)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${readToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('does not return secretHash in the response', async () => {
      // Create a client first
      await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Hash Test Client',
          scopes: ['read'],
          grantTypes: ['client_credentials'],
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const clients = res.json<Array<Record<string, unknown>>>();
      for (const c of clients) {
        expect(c.secretHash).toBeUndefined();
      }
    });
  });

  describe('POST /api/v1/clients', () => {
    it('creates a client and returns clientSecret (once)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'New Service Client',
          scopes: ['read', 'write'],
          grantTypes: ['client_credentials'],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; name: string; clientSecret: string; scopes: string[] }>();
      expect(body.name).toBe('New Service Client');
      expect(body.clientSecret).toBeDefined();
      expect(typeof body.clientSecret).toBe('string');
      expect(body.scopes).toContain('read');
      expect(body.scopes).toContain('write');
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          scopes: ['read'],
          grantTypes: ['client_credentials'],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when scopes is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Missing Scopes',
          grantTypes: ['client_credentials'],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when grantTypes is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Missing GrantTypes',
          scopes: ['read'],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when read-only token attempts create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${readToken}` },
        payload: {
          name: 'Unauthorized Client',
          scopes: ['read'],
          grantTypes: ['client_credentials'],
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/v1/clients/:id', () => {
    it('deletes a client and returns 204', async () => {
      // Create a client to delete
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Client To Delete',
          scopes: ['read'],
          grantTypes: ['client_credentials'],
        },
      });
      const created = createRes.json<{ id: string }>();

      // Look up the real DB id from list (the POST creates a new UUID for the DB record)
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const clients = listRes.json<Array<{ id: string; name: string }>>();
      const dbClient = clients.find(c => c.name === 'Client To Delete');
      expect(dbClient).toBeDefined();

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/clients/${dbClient!.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(deleteRes.statusCode).toBe(204);
    });

    it('returns 404 when client does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/clients/nonexistent-client-id',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 403 when read-only token attempts delete', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/clients/some-id',
        headers: { authorization: `Bearer ${readToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

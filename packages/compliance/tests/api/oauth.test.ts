import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportSPKI, exportPKCS8, decodeJwt } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('OAuth2 token endpoint', () => {
  let app: FastifyInstance;
  let clientId: string;
  let clientSecret: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    const db = new SqliteAdapter(':memory:');
    const signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      corsOrigins: ['*'],
      logger: false,
    });

    // Create a client with known credentials
    const client = await db.createClient({
      name: 'test-oauth-client',
      scopes: ['read', 'write'],
      grantTypes: ['client_credentials'],
    });

    clientId = client.id;
    clientSecret = client.secret;

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a token with client_credentials grant', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(typeof body.access_token).toBe('string');
    expect(body.token_type).toBe('Bearer');
    expect(typeof body.expires_in).toBe('number');
    expect(body.scope).toMatch(/read/);
  });

  it('accepts credentials via Basic auth header', async () => {
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${encoded}`,
      },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(typeof body.access_token).toBe('string');
  });

  it('rejects invalid client_secret', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: 'wrong-secret',
      }),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.error).toMatch(/invalid_client/);
  });

  it('rejects unknown grant_type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects missing client credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('OAuth2 password grant', () => {
  let app: FastifyInstance;
  let db: SqliteAdapter;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    db = new SqliteAdapter(':memory:');
    const signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      corsOrigins: ['*'],
      logger: false,
    });

    // Create test users
    await db.createUser({ username: 'admin-user', password: 'admin-pass', role: 'admin' });
    await db.createUser({ username: 'viewer-user', password: 'viewer-pass', role: 'viewer' });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a token with valid admin credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        username: 'admin-user',
        password: 'admin-pass',
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(typeof body.access_token).toBe('string');
    expect(body.token_type).toBe('bearer');
    expect(typeof body.expires_in).toBe('number');
    expect(body.scope).toMatch(/read/);
    expect(body.scope).toMatch(/write/);
    expect(body.scope).toMatch(/admin/);
  });

  it('token contains correct claims for admin user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        username: 'admin-user',
        password: 'admin-pass',
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    const claims = decodeJwt(body.access_token as string);

    expect(typeof claims.sub).toBe('string');
    expect(claims.role).toBe('admin');
    expect(claims.username).toBe('admin-user');
    expect(Array.isArray(claims.scopes)).toBe(true);
    expect((claims.scopes as string[]).sort()).toEqual(['admin', 'read', 'write']);
  });

  it('issues a token with correct scopes for viewer role', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        username: 'viewer-user',
        password: 'viewer-pass',
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    const claims = decodeJwt(body.access_token as string);

    expect(claims.role).toBe('viewer');
    expect(claims.username).toBe('viewer-user');
    expect((claims.scopes as string[])).toEqual(['read']);
    expect(body.scope).toBe('read');
  });

  it('returns 401 for invalid password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        username: 'admin-user',
        password: 'wrong-password',
      }),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.error).toMatch(/invalid_grant/);
  });

  it('returns 401 for unknown username', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        username: 'no-such-user',
        password: 'any-password',
      }),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.error).toMatch(/invalid_grant/);
  });

  it('returns 400 when username or password is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        username: 'admin-user',
      }),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('OAuth2 scope enforcement', () => {
  let app: FastifyInstance;
  let readToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    readToken = ctx.readToken;
    adminToken = ctx.adminToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('read token can access GET /api/v1/jurisdictions', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader(readToken),
    });
    expect(response.statusCode).toBe(200);
  });

  it('read token cannot POST to /api/v1/jurisdictions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'TEST', name: 'Test', type: 'country' }),
    });
    expect(response.statusCode).toBe(403);
  });

  it('requires auth for protected endpoints', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
    });
    expect(response.statusCode).toBe(401);
  });

  it('admin token can DELETE jurisdictions', async () => {
    // First create one
    await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'TEST-DEL', name: 'Test Delete', type: 'country' }),
    });

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/api/v1/TEST-DEL',
      headers: authHeader(adminToken),
    });

    // Should not be 403
    expect(deleteResponse.statusCode).not.toBe(403);
  });
});

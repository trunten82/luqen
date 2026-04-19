/**
 * Phase 31.2 Plan 05 Task 2 — WWW-Authenticate header emission on branding
 * service 401 responses. Mirrors the dashboard fix from 31.1 commit e0637ac
 * and the compliance work in Task 1.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import type { FastifyInstance } from 'fastify';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

// Branding defaults to port 4100 (well-known.ts registerBrandingProtectedResourceMetadata).
// Leave BRANDING_PUBLIC_URL unset in this test so middleware falls back to the
// default — that's the exact URL clients would see in production when the env
// var is also unset, and it's the same URL the well-known route advertises.
const EXPECTED_BASE = 'Bearer resource_metadata="http://localhost:4100/.well-known/oauth-protected-resource"';
const EXPECTED_INVALID = `${EXPECTED_BASE}, error="invalid_token"`;

describe('Auth middleware — WWW-Authenticate header parity (Phase 31.2 Plan 05)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    // Phase 31.1 Plan 03: force the MCP-facing preHandler to reuse the
    // local-signed verifier instead of fetching the dashboard JWKS — the
    // test doesn't stand up a dashboard.
    process.env['DASHBOARD_JWKS_URL'] = '';
    delete process.env['BRANDING_PUBLIC_URL'];

    const db = new SqliteAdapter(':memory:');
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
  });

  afterEach(() => {
    delete process.env['BRANDING_API_KEY'];
  });

  it('Test 1: missing Authorization on protected route returns 401 with WWW-Authenticate base header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/guidelines' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(EXPECTED_BASE);
  });

  it('Test 2: invalid Bearer token returns 401 with WWW-Authenticate + error="invalid_token"', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/guidelines',
      headers: { authorization: 'Bearer totally_invalid_token_garbage.xxx.yyy' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(EXPECTED_INVALID);
  });

  it('Test 3: valid JWT passes auth — no 401 and no WWW-Authenticate header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/guidelines',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('Test 4: valid BRANDING_API_KEY passes auth — no 401 and no WWW-Authenticate header', async () => {
    process.env['BRANDING_API_KEY'] = 'test-branding-api-key-abc';
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/guidelines',
      headers: { authorization: 'Bearer test-branding-api-key-abc' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('Test 5 (regression): /.well-known/oauth-protected-resource remains public (200, no 401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('Test 6 (regression): POST /api/v1/oauth/token remains public (not 401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      payload: {},
    });
    // Token endpoint public — may return 400 (bad grant) but MUST NOT 401.
    expect(res.statusCode).not.toBe(401);
  });
});

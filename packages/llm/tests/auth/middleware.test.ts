import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-middleware-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Auth Middleware', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let signToken: Awaited<ReturnType<typeof createTokenSigner>>;

  beforeAll(async () => {
    cleanup();
    // Phase 31.1 Plan 03: force MCP-facing preHandler to reuse the
    // local-signed verifier instead of fetching the dashboard JWKS — this
    // harness doesn't stand up a dashboard. Leave LLM_PUBLIC_URL unset so
    // middleware falls back to the default http://localhost:5100 advertised
    // by the well-known route (matches must_have #7).
    process.env['DASHBOARD_JWKS_URL'] = '';
    delete process.env['LLM_PUBLIC_URL'];

    const db = new SqliteAdapter(TEST_DB);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      logger: false,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  afterEach(() => {
    // Clean up API key env var after each test
    delete process.env['LLM_API_KEY'];
  });

  describe('Public path bypass', () => {
    it('GET /api/v1/health bypasses auth without Authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });
      expect(res.statusCode).toBe(200);
    });

    it('POST /api/v1/oauth/token bypasses auth without Authorization header', async () => {
      // Should not 401 — even without auth (grant_type error expected)
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: {},
      });
      // Token endpoint is public — response could be 400 (bad request) but not 401
      expect(res.statusCode).not.toBe(401);
    });

    it('POST /api/v1/oauth/revoke bypasses auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/revoke',
        payload: {},
      });
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe('Missing / invalid auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/Missing or invalid/);
    });

    it('returns 401 when Authorization header has no Bearer prefix', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for an invalid JWT token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: { authorization: 'Bearer invalid.token.here' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/Invalid or expired/);
    });
  });

  describe('JWT authentication', () => {
    it('allows request with valid JWT and read scope', async () => {
      const token = await signToken({
        sub: 'test-client',
        scopes: ['read'],
        expiresIn: '1h',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 403 when JWT lacks required scope (admin endpoint with read-only token)', async () => {
      const token = await signToken({
        sub: 'read-only-client',
        scopes: ['read'],
        expiresIn: '1h',
      });

      // POST /api/v1/providers requires admin scope
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Test', type: 'ollama', baseUrl: 'http://localhost:11434' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/Insufficient scope/);
    });

    it('allows request with admin JWT to admin endpoint', async () => {
      const token = await signToken({
        sub: 'admin-client',
        scopes: ['read', 'write', 'admin'],
        expiresIn: '1h',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'MW Test Provider', type: 'ollama', baseUrl: 'http://localhost:11434' },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('API key authentication', () => {
    it('allows request when LLM_API_KEY matches Authorization header', async () => {
      process.env['LLM_API_KEY'] = 'test-service-key-xyz';

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: { authorization: 'Bearer test-service-key-xyz' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('falls through to JWT validation when API key does not match', async () => {
      process.env['LLM_API_KEY'] = 'correct-key';

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: { authorization: 'Bearer wrong-key' },
      });
      // Falls through to JWT validation — invalid token → 401
      expect(res.statusCode).toBe(401);
    });

    it('grants full scopes (admin) when API key auth succeeds', async () => {
      process.env['LLM_API_KEY'] = 'full-access-key';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/providers',
        headers: { authorization: 'Bearer full-access-key' },
        payload: { name: 'API Key Provider', type: 'ollama', baseUrl: 'http://localhost:11434' },
      });
      // API key has admin scope, so should reach the route handler
      expect(res.statusCode).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 31.2 Plan 05 (G9 closure) — WWW-Authenticate parity with the
  // dashboard fix from commit e0637ac. External MCP clients discover the
  // authorization server via the resource_metadata hint on 401 per RFC 6750
  // §3.1 + MCP Authorization spec 2025-06-18.
  // -------------------------------------------------------------------------

  describe('WWW-Authenticate header (Phase 31.2 Plan 05)', () => {
    const EXPECTED_BASE =
      'Bearer resource_metadata="http://localhost:5100/.well-known/oauth-protected-resource"';
    const EXPECTED_INVALID = `${EXPECTED_BASE}, error="invalid_token"`;

    it('missing Authorization on protected route emits base WWW-Authenticate header', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/providers' });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe(EXPECTED_BASE);
    });

    it('invalid Bearer token emits WWW-Authenticate with error="invalid_token"', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: { authorization: 'Bearer totally_invalid_token_garbage' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe(EXPECTED_INVALID);
    });

    it('valid JWT request does not emit WWW-Authenticate header', async () => {
      const token = await signToken({
        sub: 'ok-client',
        scopes: ['read'],
        expiresIn: '1h',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['www-authenticate']).toBeUndefined();
    });

    it('valid LLM_API_KEY request does not emit WWW-Authenticate header', async () => {
      process.env['LLM_API_KEY'] = 'www-auth-api-key';
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: { authorization: 'Bearer www-auth-api-key' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['www-authenticate']).toBeUndefined();
    });
  });
});

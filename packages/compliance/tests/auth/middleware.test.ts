/**
 * Phase 31.2 Plan 05 Task 1 — WWW-Authenticate header emission on compliance
 * service 401 responses. Mirrors the dashboard fix from 31.1 commit e0637ac
 * so external MCP clients can discover the authorization server per RFC 6750
 * + MCP Authorization spec 2025-06-18.
 *
 * Exercises the service-global auth middleware (packages/compliance/src/auth/
 * middleware.ts) end-to-end via app.inject. Helpers.ts already sets
 * COMPLIANCE_PUBLIC_URL implicitly to the default 'http://localhost:4000' —
 * we assert the header value matches the well-known protected-resource URL
 * derived from that default. RFC 9728 shape is verified separately in
 * tests/api/well-known.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, authHeader } from '../api/helpers.js';

const EXPECTED_BASE = 'Bearer resource_metadata="http://localhost:4000/.well-known/oauth-protected-resource"';
const EXPECTED_INVALID = `${EXPECTED_BASE}, error="invalid_token"`;

describe('Auth middleware — WWW-Authenticate header parity (Phase 31.2 Plan 05)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    adminToken = ctx.adminToken;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    delete process.env['COMPLIANCE_API_KEY'];
  });

  it('Test 1: missing Authorization on protected route returns 401 with WWW-Authenticate base header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/jurisdictions' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(EXPECTED_BASE);
  });

  it('Test 2: invalid Bearer token returns 401 with WWW-Authenticate + error="invalid_token"', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: { authorization: 'Bearer totally_invalid_token_garbage.xxx.yyy' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(EXPECTED_INVALID);
  });

  it('Test 3: valid JWT passes auth — no 401 and no WWW-Authenticate header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('Test 4: valid COMPLIANCE_API_KEY passes auth — no 401 and no WWW-Authenticate header', async () => {
    process.env['COMPLIANCE_API_KEY'] = 'test-compliance-api-key';
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader('test-compliance-api-key'),
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

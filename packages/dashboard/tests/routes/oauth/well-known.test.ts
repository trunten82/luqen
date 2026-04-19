/**
 * Phase 31.1 Plan 02 Task 3 — /.well-known/oauth-authorization-server
 * (Tests 8, 9). RFC 8414.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerWellKnownRoutes } from '../../../src/routes/oauth/well-known.js';

let server: FastifyInstance;
beforeEach(async () => {
  server = Fastify({ logger: false });
  await registerWellKnownRoutes(server);
  await server.ready();
});
afterEach(async () => { await server.close(); });

describe('GET /.well-known/oauth-authorization-server — Test 8 (RFC 8414 fields)', () => {
  it('returns 200 with all required metadata fields', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as Record<string, unknown>;
    expect(typeof body['issuer']).toBe('string');
    expect(typeof body['authorization_endpoint']).toBe('string');
    expect(typeof body['token_endpoint']).toBe('string');
    expect(typeof body['registration_endpoint']).toBe('string');
    expect(typeof body['jwks_uri']).toBe('string');
    expect(body['response_types_supported']).toEqual(['code']);
    expect(body['grant_types_supported']).toEqual(
      expect.arrayContaining(['authorization_code', 'refresh_token', 'client_credentials']),
    );
    expect(body['code_challenge_methods_supported']).toEqual(['S256']);
    expect(body['token_endpoint_auth_methods_supported']).toEqual(
      expect.arrayContaining(['none', 'client_secret_basic']),
    );
    expect(body['scopes_supported']).toEqual(
      expect.arrayContaining(['read', 'write', 'admin.system', 'admin.org', 'admin.users']),
    );
    expect(body['response_modes_supported']).toEqual(['query']);
  });
});

describe('GET /.well-known/oauth-authorization-server — Test 9 (Cache-Control)', () => {
  it('sets Cache-Control public, max-age=3600', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });
});

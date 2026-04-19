/**
 * Phase 31.1 Plan 03 Task 3 — /.well-known/oauth-protected-resource
 *
 * RFC 9728 Resource Server metadata for the dashboard. The dashboard acts
 * as both AS (its own /oauth/authorize + /oauth/token + /oauth/jwks.json)
 * AND RS (its own /mcp endpoint) per D-02 — so this endpoint lists the
 * dashboard itself in authorization_servers.
 *
 * Tests covered (from plan):
 *   - 1: returns 200 + application/json with RFC 9728 shape
 *   - 2: Cache-Control: public, max-age=3600
 *   - 5: authorization_servers[0] equals the dashboard issuer (D-02)
 *   - 6: reachable WITHOUT authentication (public metadata)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerProtectedResourceMetadata } from '../../../src/routes/oauth/protected-resource.js';

const DASHBOARD_URL = 'https://dashboard.test.example';

let server: FastifyInstance;

beforeEach(async () => {
  process.env['DASHBOARD_PUBLIC_URL'] = DASHBOARD_URL;
  server = Fastify({ logger: false });
  await registerProtectedResourceMetadata(server);
  await server.ready();
});

afterEach(async () => {
  await server.close();
  delete process.env['DASHBOARD_PUBLIC_URL'];
});

describe('GET /.well-known/oauth-protected-resource — dashboard (Phase 31.1 Plan 03)', () => {
  it('Test 1: returns 200 + application/json + RFC 9728 shape', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as Record<string, unknown>;
    expect(body['resource']).toBe(`${DASHBOARD_URL}/api/v1/mcp`);
    expect(body['authorization_servers']).toEqual([DASHBOARD_URL]);
    expect(body['scopes_supported']).toEqual(['read', 'write', 'admin.system', 'admin.org', 'admin.users']);
    expect(body['bearer_methods_supported']).toEqual(['header']);
    expect(typeof body['resource_documentation']).toBe('string');
  });

  it('Test 2: Cache-Control header set to public, max-age=3600', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('Test 5: authorization_servers[0] equals the dashboard issuer (D-02 AS+RS)', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });
    const body = res.json() as { authorization_servers: string[] };
    expect(body.authorization_servers[0]).toBe(DASHBOARD_URL);
  });

  it('Test 6: endpoint is reachable without any Authorization header', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
      // Deliberately no auth headers
    });
    expect(res.statusCode).toBe(200);
  });
});

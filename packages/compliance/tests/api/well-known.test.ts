/**
 * Phase 31.1 Plan 03 Task 3 — compliance /.well-known/oauth-protected-resource
 *
 * RFC 9728 Resource Server metadata for compliance.
 *   - resource = COMPLIANCE_PUBLIC_URL/api/v1/mcp
 *   - authorization_servers = [DASHBOARD_PUBLIC_URL]
 *   - scopes_supported + bearer_methods_supported as the plan specifies
 *   - Cache-Control: public, max-age=3600
 *   - Reachable without authentication
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerComplianceProtectedResourceMetadata } from '../../src/api/routes/well-known.js';

const COMPLIANCE_URL = 'https://compliance.test.example';
const DASHBOARD_URL = 'https://dashboard.test.example';

let server: FastifyInstance;

beforeEach(async () => {
  process.env['COMPLIANCE_PUBLIC_URL'] = COMPLIANCE_URL;
  process.env['DASHBOARD_PUBLIC_URL'] = DASHBOARD_URL;
  server = Fastify({ logger: false });
  await registerComplianceProtectedResourceMetadata(server);
  await server.ready();
});

afterEach(async () => {
  await server.close();
  delete process.env['COMPLIANCE_PUBLIC_URL'];
  delete process.env['DASHBOARD_PUBLIC_URL'];
});

describe('GET /.well-known/oauth-protected-resource — compliance (Phase 31.1 Plan 03)', () => {
  it('Test 1a: returns 200 + RFC 9728 shape with compliance MCP URL as resource', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json() as Record<string, unknown>;
    expect(body['resource']).toBe(`${COMPLIANCE_URL}/api/v1/mcp`);
    expect(body['authorization_servers']).toEqual([DASHBOARD_URL]);
    expect(body['scopes_supported']).toEqual(['read', 'write', 'admin.system', 'admin.org', 'admin.users']);
    expect(body['bearer_methods_supported']).toEqual(['header']);
  });

  it('Test 2: Cache-Control header set to public, max-age=3600', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('Test 6a: endpoint is reachable without any Authorization header', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });
    expect(res.statusCode).toBe(200);
  });
});

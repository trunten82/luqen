/**
 * Phase 31.1 Plan 02 Task 3 — integration smoke test (Test 10).
 *
 * Spins up a Fastify server with all five OAuth route groups mounted via
 * `registerOauthRoutes` and asserts each endpoint is reachable (non-404).
 * Does NOT exercise the full flow — that's covered by authorize/token/
 * register/jwks/well-known test files individually.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../../src/plugins/crypto.js';
import { ensureInitialSigningKey } from '../../../src/auth/oauth-key-bootstrap.js';
import { createDashboardSigner } from '../../../src/auth/oauth-signer.js';
import { registerSession } from '../../../src/auth/session.js';
import { registerOauthRoutes } from '../../../src/routes/oauth/index.js';

const ENC_KEY = 'test-session-secret-at-least-32b';

let server: FastifyInstance;
let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  setEncryptionSalt('phase-31-1-plan-02-integration-salt');
  dbPath = join(tmpdir(), `test-integration-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await ensureInitialSigningKey(storage, ENC_KEY);
  const signer = await createDashboardSigner(storage, ENC_KEY);

  server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, ENC_KEY);
  await server.register(import('@fastify/csrf-protection'), {
    sessionPlugin: '@fastify/secure-session',
  });
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).send(JSON.stringify({ template, data }));
    },
  );
  await registerOauthRoutes(server, storage, signer);
  await server.ready();
});

afterEach(async () => {
  await server.close();
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('OAuth route registrar — Test 10 (integration smoke test)', () => {
  it('mounts all five OAuth endpoint groups (non-404 responses)', async () => {
    // GET /.well-known/oauth-authorization-server
    const wellKnown = await server.inject({
      method: 'GET', url: '/.well-known/oauth-authorization-server',
    });
    expect(wellKnown.statusCode).toBe(200);

    // GET /oauth/jwks.json
    const jwks = await server.inject({ method: 'GET', url: '/oauth/jwks.json' });
    expect(jwks.statusCode).toBe(200);
    expect((jwks.json() as { keys: unknown[] }).keys.length).toBe(1);

    // GET /.well-known/jwks.json (mirror route)
    const jwksAlt = await server.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    expect(jwksAlt.statusCode).toBe(200);

    // POST /oauth/register (expect 201 or 400 — definitely not 404)
    const register = await server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Integration Test Client',
        redirect_uris: ['https://app.test/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(register.statusCode).toBe(201);

    // POST /oauth/token (expect 400 with invalid_client since we pass nothing)
    const token = await server.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=client_credentials',
    });
    expect(token.statusCode).not.toBe(404);
    expect(token.statusCode).toBe(400);

    // GET /oauth/authorize — no session → redirect to /login (302) or 401
    const authz = await server.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=x&redirect_uri=https://a.test/&scope=read&resource=https://s/m&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`,
    });
    expect(authz.statusCode).not.toBe(404);
  });
});

/**
 * Phase 31.1 Plan 02 Task 3 — /oauth/register (RFC 7591 DCR).
 *
 * Tests 1–7 per plan Task 3 behaviour section. D-16/D-17/D-18.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerRegisterRoutes } from '../../../src/routes/oauth/register.js';

async function buildServer(): Promise<{ server: FastifyInstance; storage: SqliteStorageAdapter; dbPath: string }> {
  const dbPath = join(tmpdir(), `test-register-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerRegisterRoutes(server, storage);
  await server.ready();
  return { server, storage, dbPath };
}

describe('POST /oauth/register — Test 1 (public client, token_endpoint_auth_method=none)', () => {
  let ctx: { server: FastifyInstance; storage: SqliteStorageAdapter; dbPath: string };
  beforeEach(async () => { ctx = await buildServer(); });
  afterEach(async () => {
    await ctx.server.close();
    await ctx.storage.disconnect();
    if (existsSync(ctx.dbPath)) rmSync(ctx.dbPath);
  });

  it('returns 201 with dcr_-prefixed client_id and null client_secret', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Claude Desktop',
        redirect_uris: ['https://app.test/cb'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
        scope: 'read write',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      client_id: string; client_secret: string | null; client_id_issued_at: number;
    };
    expect(body.client_id).toMatch(/^dcr_[a-f0-9]{32}$/);
    expect(body.client_secret).toBeNull();
    expect(typeof body.client_id_issued_at).toBe('number');
  });
});

describe('POST /oauth/register — Test 2 (confidential client returns client_secret)', () => {
  let ctx: { server: FastifyInstance; storage: SqliteStorageAdapter; dbPath: string };
  beforeEach(async () => { ctx = await buildServer(); });
  afterEach(async () => {
    await ctx.server.close();
    await ctx.storage.disconnect();
    if (existsSync(ctx.dbPath)) rmSync(ctx.dbPath);
  });

  it('returns 201 with a non-null 64-hex-char client_secret', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Server-Side MCP Client',
        redirect_uris: ['https://app.test/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'read',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { client_secret: string | null };
    expect(typeof body.client_secret).toBe('string');
    expect(body.client_secret).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('POST /oauth/register — Test 3 (missing client_name)', () => {
  let ctx: { server: FastifyInstance; storage: SqliteStorageAdapter; dbPath: string };
  beforeEach(async () => { ctx = await buildServer(); });
  afterEach(async () => {
    await ctx.server.close();
    await ctx.storage.disconnect();
    if (existsSync(ctx.dbPath)) rmSync(ctx.dbPath);
  });

  it('returns 400 invalid_client_metadata when client_name is absent', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        redirect_uris: ['https://app.test/cb'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; error_description?: string };
    expect(body.error).toBe('invalid_client_metadata');
    expect(body.error_description).toContain('client_name');
  });
});

describe('POST /oauth/register — Test 4 (http redirect rejected unless localhost)', () => {
  let ctx: { server: FastifyInstance; storage: SqliteStorageAdapter; dbPath: string };
  beforeEach(async () => { ctx = await buildServer(); });
  afterEach(async () => {
    await ctx.server.close();
    await ctx.storage.disconnect();
    if (existsSync(ctx.dbPath)) rmSync(ctx.dbPath);
  });

  it('rejects http://attacker.com redirect', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Attacker',
        redirect_uris: ['http://attacker.com/cb'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_redirect_uri' });
  });

  it('accepts http://localhost:PORT/cb', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Dev Client',
        redirect_uris: ['http://localhost:33418/callback'],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('accepts http://127.0.0.1:PORT/cb', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Dev Client 2',
        redirect_uris: ['http://127.0.0.1:8080/callback'],
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /oauth/register — Test 5 (unsupported grant_types)', () => {
  let ctx: { server: FastifyInstance; storage: SqliteStorageAdapter; dbPath: string };
  beforeEach(async () => { ctx = await buildServer(); });
  afterEach(async () => {
    await ctx.server.close();
    await ctx.storage.disconnect();
    if (existsSync(ctx.dbPath)) rmSync(ctx.dbPath);
  });

  it('returns 400 invalid_client_metadata when grant_types contains unsupported entry', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Bad Client',
        redirect_uris: ['https://app.test/cb'],
        grant_types: ['authorization_code', 'password'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });
});

describe('POST /oauth/register — Test 6 (rate limit: 10/hr/IP returns JSON 429)', () => {
  let ctx: { server: FastifyInstance; storage: SqliteStorageAdapter; dbPath: string };
  beforeEach(async () => { ctx = await buildServer(); });
  afterEach(async () => {
    await ctx.server.close();
    await ctx.storage.disconnect();
    if (existsSync(ctx.dbPath)) rmSync(ctx.dbPath);
  });

  it('the 11th request from the same IP returns 429 with JSON body', async () => {
    const payload = {
      client_name: 'Spammer',
      redirect_uris: ['https://app.test/cb'],
    };
    for (let i = 0; i < 10; i++) {
      const r = await ctx.server.inject({
        method: 'POST',
        url: '/oauth/register',
        remoteAddress: '203.0.113.5',
        payload,
      });
      expect(r.statusCode).toBe(201);
    }
    const eleventh = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      remoteAddress: '203.0.113.5',
      payload,
    });
    expect(eleventh.statusCode).toBe(429);
    const ct = eleventh.headers['content-type'] as string;
    expect(ct).toContain('application/json');
    expect(eleventh.json()).toMatchObject({ error: 'too_many_requests', statusCode: 429 });
  });
});

describe('POST /oauth/register — Test 7 (unknown token_endpoint_auth_method)', () => {
  let ctx: { server: FastifyInstance; storage: SqliteStorageAdapter; dbPath: string };
  beforeEach(async () => { ctx = await buildServer(); });
  afterEach(async () => {
    await ctx.server.close();
    await ctx.storage.disconnect();
    if (existsSync(ctx.dbPath)) rmSync(ctx.dbPath);
  });

  it('returns 400 invalid_client_metadata for private_key_jwt etc.', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        client_name: 'Unsupported',
        redirect_uris: ['https://app.test/cb'],
        token_endpoint_auth_method: 'private_key_jwt',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });
});

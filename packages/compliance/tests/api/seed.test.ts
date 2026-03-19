import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Seed API', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let readToken: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    adminToken = ctx.adminToken;
    readToken = ctx.readToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/seed/status returns unseeded state initially', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/seed/status',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.seeded).toBe(false);
    expect(body.jurisdictions).toBe(0);
    expect(body.regulations).toBe(0);
    expect(body.requirements).toBe(0);
  });

  it('POST /api/v1/seed loads baseline data (requires admin)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/seed',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.seeded).toBe(true);
    expect(Number(body.jurisdictions)).toBeGreaterThan(0);
    expect(Number(body.regulations)).toBeGreaterThan(0);
    expect(Number(body.requirements)).toBeGreaterThan(0);
  });

  it('GET /api/v1/seed/status returns seeded counts after seeding', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/seed/status',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.seeded).toBe(true);
    expect(Number(body.jurisdictions)).toBeGreaterThan(0);
  });

  it('POST /api/v1/seed is idempotent (can run twice)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/seed',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  it('POST /api/v1/seed requires admin scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/seed',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(403);
  });

  it('GET /api/v1/seed/status requires read scope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/seed/status',
    });

    expect(response.statusCode).toBe(401);
  });
});

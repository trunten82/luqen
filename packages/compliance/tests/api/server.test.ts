import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Server setup', () => {
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

  it('has health route registered', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
  });

  it('has OpenAPI JSON route registered', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/docs/json' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.openapi).toBeDefined();
  });

  it('returns 401 for unknown protected routes without auth', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/jurisdictions' });
    expect(response.statusCode).toBe(401);
  });

  it('has jurisdictions route registered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
  });

  it('has regulations route registered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/regulations',
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
  });

  it('has requirements route registered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/requirements',
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
  });

  it('has compliance check route registered', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ jurisdictions: ['EU'], issues: [] }),
    });
    expect(response.statusCode).toBe(200);
  });

  it('has updates route registered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/updates',
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
  });

  it('has sources route registered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sources',
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
  });

  it('has webhooks route registered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks',
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
  });

  it('has seed route registered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/seed/status',
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
  });
});

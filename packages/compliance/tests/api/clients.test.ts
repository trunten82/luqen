import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Clients API', () => {
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

  it('GET /api/v1/clients returns list of clients', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/clients',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    // At least the test clients created in helpers
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('requires admin scope to GET /api/v1/clients', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/clients',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(403);
  });

  it('POST /api/v1/clients creates a client', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'new-test-client',
        scopes: ['read'],
        grantTypes: ['client_credentials'],
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.name).toBe('new-test-client');
    expect(body.id).toBeDefined();
    // Secret should be returned on creation
    expect(body.secret).toBeDefined();
  });

  it('POST /api/v1/clients returns 400 for missing fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'incomplete' }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('requires admin scope to POST /api/v1/clients', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'forbidden-client',
        scopes: ['read'],
        grantTypes: ['client_credentials'],
      }),
    });

    expect(response.statusCode).toBe(403);
  });

  it('POST /api/v1/clients/:id/revoke deletes a client', async () => {
    // Create one to revoke
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'client-to-revoke',
        scopes: ['read'],
        grantTypes: ['client_credentials'],
      }),
    });
    const { id } = JSON.parse(createRes.body) as { id: string };

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/clients/${id}/revoke`,
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(204);
  });

  it('requires admin scope to POST /api/v1/clients/:id/revoke', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/clients/some-id/revoke',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(403);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Users API', () => {
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

  it('GET /api/v1/users returns list of users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('requires admin scope to GET /api/v1/users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(403);
  });

  it('POST /api/v1/users creates a user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'testuser',
        password: 'secureP@ssw0rd',
        role: 'editor',
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.username).toBe('testuser');
    expect(body.role).toBe('editor');
    expect(body.active).toBe(true);
    // Password hash should not be exposed
    expect(body.passwordHash).toBeUndefined();
  });

  it('POST /api/v1/users returns 400 for missing fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'incomplete' }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('requires admin scope to POST /api/v1/users', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'forbidden',
        password: 'secureP@ssw0rd',
        role: 'viewer',
      }),
    });

    expect(response.statusCode).toBe(403);
  });

  it('PATCH /api/v1/users/:id/deactivate deactivates a user', async () => {
    // Create a user to deactivate
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'todeactivate',
        password: 'secureP@ssw0rd',
        role: 'viewer',
      }),
    });
    const { id } = JSON.parse(createRes.body) as { id: string };

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${id}/deactivate`,
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(204);
  });

  it('requires admin scope to PATCH /api/v1/users/:id/deactivate', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/some-id/deactivate',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(403);
  });
});

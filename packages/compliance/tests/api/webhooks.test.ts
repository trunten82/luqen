import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Webhooks API', () => {
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

  it('GET /api/v1/webhooks returns empty list initially', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('requires admin scope to GET /api/v1/webhooks', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(403);
  });

  it('POST /api/v1/webhooks creates a webhook', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/webhook',
        secret: 'super-secret-key',
        events: ['regulation.created', 'requirement.updated'],
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.url).toBe('https://example.com/webhook');
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.active).toBe(true);
  });

  it('POST /api/v1/webhooks returns 400 for missing fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/webhook' }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('DELETE /api/v1/webhooks/:id removes a webhook', async () => {
    // Create one to delete
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/webhook-to-delete',
        secret: 'another-secret',
        events: ['regulation.created'],
      }),
    });
    const { id } = JSON.parse(createRes.body) as { id: string };

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/webhooks/${id}`,
      headers: authHeader(adminToken),
    });

    expect(deleteResponse.statusCode).toBe(204);
  });

  it('requires admin scope to POST /api/v1/webhooks', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/forbidden-webhook',
        secret: 'secret',
        events: ['regulation.created'],
      }),
    });
    expect(response.statusCode).toBe(403);
  });
});

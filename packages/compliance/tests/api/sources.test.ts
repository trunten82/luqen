import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Sources API', () => {
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

  it('GET /api/v1/sources returns empty list initially', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sources',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('POST /api/v1/sources creates a source', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'W3C Accessibility News',
        url: 'https://www.w3.org/accessibility/news',
        type: 'html',
        schedule: 'weekly',
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.name).toBe('W3C Accessibility News');
    expect(body.type).toBe('html');
  });

  it('GET /api/v1/sources lists created sources', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sources',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as unknown[];
    expect(body.length).toBeGreaterThan(0);
  });

  it('DELETE /api/v1/sources/:id removes a source', async () => {
    // Create one to delete
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Source To Delete',
        url: 'https://example.com/source-to-delete',
        type: 'rss',
        schedule: 'daily',
      }),
    });
    const { id } = JSON.parse(createRes.body) as { id: string };

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sources/${id}`,
      headers: authHeader(adminToken),
    });

    expect(deleteResponse.statusCode).toBe(204);
  });

  it('requires admin scope to POST /api/v1/sources', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Forbidden Source',
        url: 'https://example.com/forbidden',
        type: 'api',
        schedule: 'monthly',
      }),
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST /api/v1/sources/scan scans all sources', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/scan',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(typeof body.scanned).toBe('number');
    expect(typeof body.proposalsCreated).toBe('number');
    expect(Array.isArray(body.proposals)).toBe(true);
  });
});

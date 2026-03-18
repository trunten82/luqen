import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Jurisdictions API', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let readToken: string;
  let writeToken: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    adminToken = ctx.adminToken;
    readToken = ctx.readToken;
    writeToken = ctx.writeToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/jurisdictions returns empty list initially', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(0);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('POST /api/v1/jurisdictions creates a jurisdiction', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'EU', name: 'European Union', type: 'supranational' }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.id).toBe('EU');
    expect(body.name).toBe('European Union');
    expect(body.type).toBe('supranational');
  });

  it('GET /api/v1/jurisdictions lists created jurisdictions', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: unknown[]; total: number };
    expect(body.total).toBeGreaterThan(0);
  });

  it('POST /api/v1/jurisdictions creates a child jurisdiction', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'DE', name: 'Germany', type: 'country', parentId: 'EU' }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.parentId).toBe('EU');
  });

  it('GET /api/v1/jurisdictions/:id returns single jurisdiction with regulationsCount', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions/EU',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.id).toBe('EU');
    expect(typeof body.regulationsCount).toBe('number');
  });

  it('GET /api/v1/jurisdictions/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions/NONEXISTENT',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('PATCH /api/v1/jurisdictions/:id updates a jurisdiction', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/jurisdictions/EU',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'European Union (Updated)' }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.name).toBe('European Union (Updated)');
  });

  it('DELETE /api/v1/jurisdictions/:id removes a jurisdiction', async () => {
    // Create one to delete
    await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'TO-DEL', name: 'To Delete', type: 'country' }),
    });

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/api/v1/jurisdictions/TO-DEL',
      headers: authHeader(adminToken),
    });

    expect(deleteResponse.statusCode).toBe(204);

    // Verify it's gone
    const getResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions/TO-DEL',
      headers: authHeader(readToken),
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it('pagination works with limit and offset', async () => {
    // Create a few more jurisdictions
    for (let i = 1; i <= 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/jurisdictions',
        headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({ id: `J${i}`, name: `Jurisdiction ${i}`, type: 'country' }),
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions?limit=2&offset=0',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: unknown[]; total: number; limit: number; offset: number };
    expect(body.data.length).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.total).toBeGreaterThan(2);
  });

  it('requires write scope for POST', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'FORBIDDEN', name: 'Forbidden', type: 'country' }),
    });
    expect(response.statusCode).toBe(403);
  });

  it('requires admin scope for DELETE', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/jurisdictions/EU',
      headers: authHeader(writeToken),
    });
    expect(response.statusCode).toBe(403);
  });

  it('PATCH /api/v1/jurisdictions/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/jurisdictions/NONEXISTENT',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(response.statusCode).toBe(404);
  });

  it('DELETE /api/v1/jurisdictions/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/jurisdictions/NONEXISTENT-DEL',
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(404);
  });

  it('GET /api/v1/jurisdictions filters by parentId', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions?parentId=EU',
      headers: authHeader(readToken),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: Array<{ parentId: string }> };
    for (const j of body.data) {
      expect(j.parentId).toBe('EU');
    }
  });

  it('GET /api/v1/jurisdictions filters by type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions?type=supranational',
      headers: authHeader(readToken),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: Array<{ type: string }> };
    for (const j of body.data) {
      expect(j.type).toBe('supranational');
    }
  });
});

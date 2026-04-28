import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Updates API', () => {
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

  it('GET /api/v1/updates returns empty list initially', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/updates',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(0);
  });

  it('POST /api/v1/updates/propose creates a proposal', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/propose',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'https://example.com/regulation-change',
        type: 'amendment',
        summary: 'Test regulation update',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'some-id',
          before: { status: 'active' },
          after: { status: 'archived' },
        },
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.source).toBe('https://example.com/regulation-change');
    expect(body.type).toBe('amendment');
    expect(body.status).toBe('pending');
  });

  it('GET /api/v1/updates lists proposals', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/updates',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: unknown[]; total: number };
    expect(body.total).toBeGreaterThan(0);
  });

  it('GET /api/v1/updates filters by status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/updates?status=pending',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: Array<{ status: string }>; total: number };
    expect(body.total).toBeGreaterThan(0);
    for (const item of body.data) {
      expect(item.status).toBe('pending');
    }
  });

  it('GET /api/v1/updates/:id returns a proposal', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/updates',
      headers: authHeader(readToken),
    });
    const { data } = JSON.parse(listRes.body) as { data: Array<{ id: string }> };
    const id = data[0].id;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/updates/${id}`,
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.id).toBe(id);
  });

  it('GET /api/v1/updates/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/updates/nonexistent-id',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('PATCH /api/v1/updates/:id/approve approves a proposal', async () => {
    // Create a proposal to approve
    const propRes = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/propose',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'https://example.com/change2',
        type: 'new_requirement',
        summary: 'A new requirement',
        proposedChanges: {
          action: 'create',
          entityType: 'jurisdiction',
          after: { id: 'TEST-NEW', name: 'Test New', type: 'country' },
        },
      }),
    });
    const { id } = JSON.parse(propRes.body) as { id: string };

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/updates/${id}/approve`,
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.status).toBe('approved');
  });

  it('PATCH /api/v1/updates/:id/approve returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/updates/nonexistent-id/approve',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('PATCH /api/v1/updates/:id/reject rejects a proposal', async () => {
    // Create a proposal to reject
    const propRes = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/propose',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'https://example.com/change3',
        type: 'repeal',
        summary: 'A repealed regulation',
        proposedChanges: {
          action: 'delete',
          entityType: 'regulation',
          entityId: 'some-reg-id',
        },
      }),
    });
    const { id } = JSON.parse(propRes.body) as { id: string };

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/updates/${id}/reject`,
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.status).toBe('rejected');
  });

  it('PATCH /api/v1/updates/:id/reject returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/updates/nonexistent-id/reject',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects approve from a token without write scope', async () => {
    const propRes = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/propose',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'https://example.com/change4',
        type: 'amendment',
        summary: 'Test',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'x',
        },
      }),
    });
    const { id } = JSON.parse(propRes.body) as { id: string };

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/updates/${id}/approve`,
      headers: authHeader(readToken),
    });
    expect(response.statusCode).toBe(403);
  });
});

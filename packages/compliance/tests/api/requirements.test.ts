import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Requirements API', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let readToken: string;
  let writeToken: string;
  let regulationId: string;
  let requirementId: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    adminToken = ctx.adminToken;
    readToken = ctx.readToken;
    writeToken = ctx.writeToken;

    // Create jurisdiction then regulation
    await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'EU-REQT', name: 'EU for Requirements', type: 'supranational' }),
    });

    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/regulations',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'EAA-REQT',
        name: 'EAA',
        shortName: 'EAA',
        jurisdictionId: 'EU-REQT',
        description: 'European Accessibility Act',
        reference: 'EAA-REF',
        url: 'https://example.com/eaa',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: ['ict'],
      }),
    });
    regulationId = (JSON.parse(regRes.body) as { id: string }).id;

    // Create a requirement for later tests
    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/requirements',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        regulationId,
        wcagVersion: '2.1',
        wcagLevel: 'A',
        wcagCriterion: '1.1.1',
        obligation: 'mandatory',
        notes: 'Test note',
      }),
    });
    requirementId = (JSON.parse(reqRes.body) as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/requirements returns list with requirements', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/requirements',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThan(0);
  });

  it('POST /api/v1/requirements creates a requirement', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/requirements',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        regulationId,
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '2.1.1',
        obligation: 'mandatory',
        notes: '',
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.wcagCriterion).toBe('2.1.1');
    expect(body.wcagLevel).toBe('AA');
  });

  it('GET /api/v1/requirements filters by regulationId', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/requirements?regulationId=${regulationId}`,
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: unknown[]; total: number };
    expect(body.total).toBeGreaterThan(0);
  });

  it('GET /api/v1/requirements/:id returns requirement with regulation', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/requirements/${requirementId}`,
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.id).toBe(requirementId);
    expect(body.regulation).toBeDefined();
  });

  it('GET /api/v1/requirements/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/requirements/nonexistent-id',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('POST /api/v1/requirements/bulk creates multiple requirements', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/requirements/bulk',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        requirements: [
          {
            regulationId,
            wcagVersion: '2.1',
            wcagLevel: 'A',
            wcagCriterion: '3.1.1',
            obligation: 'mandatory',
            notes: '',
          },
          {
            regulationId,
            wcagVersion: '2.2',
            wcagLevel: 'AA',
            wcagCriterion: '2.4.11',
            obligation: 'recommended',
            notes: '',
          },
        ],
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  it('POST /api/v1/requirements/bulk returns 400 for invalid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/requirements/bulk',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ notAnArray: true }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('PATCH /api/v1/requirements/:id updates a requirement', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requirements/${requirementId}`,
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'Updated requirement notes' }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.notes).toBe('Updated requirement notes');
  });

  it('PATCH /api/v1/requirements/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/requirements/nonexistent-id',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'Updated' }),
    });

    expect(response.statusCode).toBe(404);
  });

  it('DELETE /api/v1/requirements/:id removes a requirement', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/requirements',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        regulationId,
        wcagVersion: '2.1',
        wcagLevel: 'AAA',
        wcagCriterion: '4.1.1',
        obligation: 'optional',
        notes: '',
      }),
    });
    const { id } = JSON.parse(createRes.body) as { id: string };

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/requirements/${id}`,
      headers: authHeader(adminToken),
    });

    expect(deleteResponse.statusCode).toBe(204);
  });

  it('DELETE /api/v1/requirements/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/requirements/nonexistent-id',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(404);
  });
});

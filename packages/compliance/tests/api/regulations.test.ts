import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Regulations API', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let readToken: string;
  let writeToken: string;
  let regulationId: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    adminToken = ctx.adminToken;
    readToken = ctx.readToken;
    writeToken = ctx.writeToken;

    // Create a jurisdiction to associate with regulations
    await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'EU-REG', name: 'EU for Regulations', type: 'supranational' }),
    });

    // Create a regulation for later tests
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/regulations',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'WCAG21',
        name: 'WCAG 2.1',
        shortName: 'WCAG21',
        jurisdictionId: 'EU-REG',
        description: 'Web Content Accessibility Guidelines',
        reference: 'WCAG-2.1',
        url: 'https://www.w3.org/TR/WCAG21/',
        enforcementDate: '2018-06-05',
        status: 'active',
        scope: 'public',
        sectors: ['web'],
      }),
    });
    regulationId = (JSON.parse(regRes.body) as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/regulations returns list with created regulation', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/regulations',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThan(0);
  });

  it('POST /api/v1/regulations creates a regulation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/regulations',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'EAA2025',
        name: 'EAA 2025',
        shortName: 'EAA',
        jurisdictionId: 'EU-REG',
        description: 'European Accessibility Act',
        reference: 'EAA-2025',
        url: 'https://example.com/eaa',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: ['ict'],
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.name).toBe('EAA 2025');
    expect(body.shortName).toBe('EAA');
  });

  it('GET /api/v1/regulations filters by jurisdictionId', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/regulations?jurisdictionId=EU-REG',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: unknown[]; total: number };
    expect(body.total).toBeGreaterThan(0);
  });

  it('GET /api/v1/regulations/:id returns regulation with requirements', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/regulations/${regulationId}`,
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.id).toBe(regulationId);
    expect(Array.isArray(body.requirements)).toBe(true);
  });

  it('GET /api/v1/regulations/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/regulations/nonexistent-id',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('PATCH /api/v1/regulations/:id updates a regulation', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/regulations/${regulationId}`,
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Updated description' }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.description).toBe('Updated description');
  });

  it('PATCH /api/v1/regulations/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/regulations/nonexistent-id',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Updated' }),
    });

    expect(response.statusCode).toBe(404);
  });

  it('DELETE /api/v1/regulations/:id removes a regulation', async () => {
    // Create one to delete
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/regulations',
      headers: { ...authHeader(writeToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'TO-DEL-REG',
        name: 'To Delete Reg',
        shortName: 'DEL',
        jurisdictionId: 'EU-REG',
        description: 'Will be deleted',
        reference: 'DEL-REF',
        url: 'https://example.com',
        enforcementDate: '2020-01-01',
        status: 'active',
        scope: 'public',
        sectors: [],
      }),
    });
    const { id } = JSON.parse(createRes.body) as { id: string };

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/regulations/${id}`,
      headers: authHeader(adminToken),
    });

    expect(deleteResponse.statusCode).toBe(204);
  });

  it('DELETE /api/v1/regulations/:id returns 404 for missing', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/regulations/nonexistent-id',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('requires admin scope for DELETE', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/regulations/${regulationId}`,
      headers: authHeader(writeToken),
    });
    expect(response.statusCode).toBe(403);
  });
});

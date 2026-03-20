import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const TEST_API_KEY = 'test-compliance-api-key-secret-12345';

describe('API Key Authentication', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let readToken: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    adminToken = ctx.adminToken;
    readToken = ctx.readToken;
  });

  afterEach(() => {
    delete process.env['COMPLIANCE_API_KEY'];
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 for valid API key on protected endpoint', async () => {
    process.env['COMPLIANCE_API_KEY'] = TEST_API_KEY;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader(TEST_API_KEY),
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 401 for wrong API key', async () => {
    process.env['COMPLIANCE_API_KEY'] = TEST_API_KEY;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader('wrong-api-key'),
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for missing auth header', async () => {
    process.env['COMPLIANCE_API_KEY'] = TEST_API_KEY;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
    });

    expect(response.statusCode).toBe(401);
  });

  it('existing JWT auth still works (backward compatibility)', async () => {
    process.env['COMPLIANCE_API_KEY'] = TEST_API_KEY;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader(readToken),
    });

    expect(response.statusCode).toBe(200);
  });

  it('API key grants admin scope (can access admin endpoints)', async () => {
    process.env['COMPLIANCE_API_KEY'] = TEST_API_KEY;

    // POST requires write scope, DELETE requires admin scope
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { ...authHeader(TEST_API_KEY), 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'API-KEY-TEST', name: 'API Key Test', type: 'country' }),
    });

    expect(createResponse.statusCode).toBe(201);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/api/v1/jurisdictions/API-KEY-TEST',
      headers: authHeader(TEST_API_KEY),
    });

    expect(deleteResponse.statusCode).toBe(204);
  });

  it('falls through to JWT when API key env var is not set', async () => {
    // No COMPLIANCE_API_KEY set — JWT should still work
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects API key with different length (timing-safe)', async () => {
    process.env['COMPLIANCE_API_KEY'] = TEST_API_KEY;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: authHeader('short'),
    });

    expect(response.statusCode).toBe(401);
  });
});

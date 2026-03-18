import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestContext } from './helpers.js';

describe('X-Org-Id header handling', () => {
  let ctx: TestContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates jurisdiction with org context from header (API key auth)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: {
        authorization: `Bearer ${ctx.apiKey}`,
        'x-org-id': 'org-1',
      },
      payload: { name: 'Org Country', type: 'country' },
    });
    expect(createRes.statusCode).toBe(201);

    // List with org-1 header — should see it
    const org1Res = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: {
        authorization: `Bearer ${ctx.apiKey}`,
        'x-org-id': 'org-1',
      },
    });
    const org1Body = JSON.parse(org1Res.body);
    const orgNames = org1Body.data.map((j: { name: string }) => j.name);
    expect(orgNames).toContain('Org Country');
  });

  it('ignores X-Org-Id header when using JWT auth', async () => {
    // Create data using API key with org-1
    await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { authorization: `Bearer ${ctx.apiKey}`, 'x-org-id': 'org-1' },
      payload: { name: 'Org Only JWT Test', type: 'country' },
    });

    // List with JWT + x-org-id header — should NOT see org-scoped data
    // because JWT auth ignores x-org-id (defaults to system)
    const jwtRes = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: { authorization: `Bearer ${ctx.adminToken}`, 'x-org-id': 'org-1' },
    });
    const names = JSON.parse(jwtRes.body).data.map((j: { name: string }) => j.name);
    expect(names).not.toContain('Org Only JWT Test');
  });

  it('system request does not see org-specific data', async () => {
    // Create org-scoped data using API key
    await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { authorization: `Bearer ${ctx.apiKey}`, 'x-org-id': 'org-1' },
      payload: { name: 'Org Only', type: 'country' },
    });

    // List without x-org-id (defaults to system)
    const systemRes = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: { authorization: `Bearer ${ctx.apiKey}` },
    });
    const names = JSON.parse(systemRes.body).data.map((j: { name: string }) => j.name);
    expect(names).not.toContain('Org Only');
  });
});

describe('DELETE /api/v1/orgs/:id/data', () => {
  let ctx: TestContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes all data for an org', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { authorization: `Bearer ${ctx.apiKey}`, 'x-org-id': 'org-1' },
      payload: { name: 'Org J', type: 'country' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-1/data',
      headers: { authorization: `Bearer ${ctx.apiKey}` },
    });
    expect(res.statusCode).toBe(204);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: { authorization: `Bearer ${ctx.apiKey}`, 'x-org-id': 'org-1' },
    });
    expect(JSON.parse(listRes.body).data).toHaveLength(0);
  });

  it('rejects deleting system org', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/system/data',
      headers: { authorization: `Bearer ${ctx.apiKey}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires admin scope', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-1/data',
      headers: { authorization: `Bearer ${ctx.readToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

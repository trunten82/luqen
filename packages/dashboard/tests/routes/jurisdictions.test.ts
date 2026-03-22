import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { jurisdictionRoutes } from '../../src/routes/admin/jurisdictions.js';

vi.mock('../../src/compliance-client.js', () => ({
  listJurisdictions: vi.fn().mockResolvedValue([
    { id: 'EU', name: 'European Union', type: 'region', parentId: undefined },
    { id: 'US', name: 'United States', type: 'country', parentId: undefined },
  ]),
  listRegulations: vi.fn().mockResolvedValue([
    { id: 'reg-1', name: 'WCAG 2.1', shortName: 'WCAG', jurisdictionId: 'EU', enforcementDate: '2024-01-01', status: 'active', scope: 'web' },
  ]),
  createJurisdiction: vi.fn().mockResolvedValue({
    id: 'CA', name: 'Canada', type: 'country', parentId: undefined,
  }),
  updateJurisdiction: vi.fn().mockResolvedValue({
    id: 'EU', name: 'European Union Updated', type: 'region', parentId: undefined,
  }),
  deleteJurisdiction: vi.fn().mockResolvedValue(undefined),
}));

import * as complianceClient from '../../src/compliance-client.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const BASE_URL = 'http://localhost:9999';

interface TestContext {
  server: FastifyInstance;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['admin.system']): Promise<TestContext> {
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'admin', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await jurisdictionRoutes(server, BASE_URL);
  await server.ready();

  const cleanup = (): void => { void server.close(); };
  return { server, cleanup };
}

describe('Jurisdiction routes', () => {
  let ctx: TestContext;

  afterEach(() => { ctx.cleanup(); });

  describe('GET /admin/jurisdictions', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and renders jurisdictions template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { jurisdictions: unknown[] } };
      expect(body.template).toBe('admin/jurisdictions.hbs');
      expect(Array.isArray(body.data.jurisdictions)).toBe(true);
    });

    it('lists mocked jurisdictions', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });
      const body = response.json() as { data: { jurisdictions: Array<{ id: string }> } };
      expect(body.data.jurisdictions.length).toBeGreaterThan(0);
    });

    it('filters jurisdictions by search query', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions?q=european' });
      const body = response.json() as { data: { jurisdictions: Array<{ id: string; name: string }> } };
      expect(body.data.jurisdictions.every((j) => j.name.toLowerCase().includes('european'))).toBe(true);
    });

    it('returns empty results for non-matching search', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions?q=xyznonexistent' });
      const body = response.json() as { data: { jurisdictions: Array<unknown> } };
      expect(body.data.jurisdictions).toHaveLength(0);
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /admin/jurisdictions — compliance API error', () => {
    it('renders page with error message when compliance client throws', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockRejectedValueOnce(new Error('Service unavailable'));
      ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { error: string; jurisdictions: unknown[] } };
      expect(body.data.error).toBeTruthy();
      expect(body.data.jurisdictions).toHaveLength(0);
    });
  });

  describe('POST /admin/jurisdictions (create)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and row HTML on successful create', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Canada');
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'name=OnlyName',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on create', async () => {
      vi.mocked(complianceClient.createJurisdiction).mockRejectedValueOnce(new Error('Conflict'));
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Conflict');
    });
  });

  describe('PATCH /admin/jurisdictions/:id (update)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and row HTML on successful update', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=European+Union+Updated&type=region',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('European Union Updated');
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=EU&type=region',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /admin/jurisdictions/:id (delete)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 toast HTML on successful delete', async () => {
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/jurisdictions/EU',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('deleted successfully');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/jurisdictions/EU',
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on delete', async () => {
      vi.mocked(complianceClient.deleteJurisdiction).mockRejectedValueOnce(new Error('Not found'));
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/jurisdictions/EU',
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Not found');
    });
  });
});

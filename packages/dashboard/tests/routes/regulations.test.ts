import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { regulationRoutes } from '../../src/routes/admin/regulations.js';

vi.mock('../../src/compliance-client.js', () => ({
  listJurisdictions: vi.fn().mockResolvedValue([
    { id: 'EU', name: 'European Union', type: 'region' },
    { id: 'US', name: 'United States', type: 'country' },
  ]),
  listRegulations: vi.fn().mockResolvedValue([
    {
      id: 'wcag21',
      name: 'WCAG 2.1',
      shortName: 'WCAG',
      jurisdictionId: 'EU',
      enforcementDate: '2024-01-01',
      status: 'active',
      scope: 'web',
    },
    {
      id: 'ada',
      name: 'Americans with Disabilities Act',
      shortName: 'ADA',
      jurisdictionId: 'US',
      enforcementDate: '1990-07-26',
      status: 'active',
      scope: 'all',
    },
  ]),
  listRequirements: vi.fn().mockResolvedValue([
    { id: 'req-1', regulationId: 'wcag21', wcagVersion: '2.1', wcagLevel: 'AA', wcagCriterion: '1.1.1', obligation: 'mandatory' },
  ]),
  createRegulation: vi.fn().mockResolvedValue({
    id: 'new-reg',
    name: 'New Regulation',
    shortName: 'NR',
    jurisdictionId: 'EU',
    enforcementDate: '2025-01-01',
    status: 'active',
    scope: 'web',
  }),
  updateRegulation: vi.fn().mockResolvedValue({
    id: 'wcag21',
    name: 'WCAG 2.1 Updated',
    shortName: 'WCAG',
    jurisdictionId: 'EU',
    enforcementDate: '2024-01-01',
    status: 'active',
    scope: 'web',
  }),
  deleteRegulation: vi.fn().mockResolvedValue(undefined),
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

  await regulationRoutes(server, BASE_URL);
  await server.ready();

  const cleanup = (): void => { void server.close(); };
  return { server, cleanup };
}

describe('Regulation routes', () => {
  let ctx: TestContext;

  afterEach(() => { ctx.cleanup(); });

  describe('GET /admin/regulations', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and renders regulations template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/regulations.hbs');
    });

    it('lists mocked regulations', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations' });
      const body = response.json() as { data: { regulations: Array<{ id: string }> } };
      expect(Array.isArray(body.data.regulations)).toBe(true);
      expect(body.data.regulations.length).toBeGreaterThan(0);
    });

    it('filters by jurisdictionId query param', async () => {
      vi.mocked(complianceClient.listRegulations).mockResolvedValueOnce([
        { id: 'wcag21', name: 'WCAG 2.1', shortName: 'WCAG', jurisdictionId: 'EU', enforcementDate: '2024-01-01', status: 'active', scope: 'web' },
      ]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations?jurisdictionId=EU' });
      expect(response.statusCode).toBe(200);
      expect(complianceClient.listRegulations).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        { jurisdictionId: 'EU' },
        expect.anything(),
      );
    });

    it('includes jurisdictions data for the filter dropdown', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations' });
      const body = response.json() as { data: { jurisdictions: Array<{ id: string }> } };
      expect(Array.isArray(body.data.jurisdictions)).toBe(true);
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations' });
      expect(response.statusCode).toBe(403);
    });

    it('renders page with error when compliance client throws', async () => {
      vi.mocked(complianceClient.listRegulations).mockRejectedValueOnce(new Error('Service down'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { error: string } };
      expect(body.data.error).toBeTruthy();
    });
  });

  describe('POST /admin/regulations (create)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with row HTML on successful create', async () => {
      const payload = 'id=new-reg&name=New+Regulation&shortName=NR&jurisdictionId=EU&enforcementDate=2025-01-01&status=active&scope=web';
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('New Regulation');
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
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
        url: '/admin/regulations',
        payload: 'id=r&name=R&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on create', async () => {
      vi.mocked(complianceClient.createRegulation).mockRejectedValueOnce(new Error('Duplicate'));
      const payload = 'id=dup&name=Dup&shortName=D&jurisdictionId=EU&enforcementDate=2025-01-01&status=active&scope=web';
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Duplicate');
    });
  });

  describe('DELETE /admin/regulations/:id (delete)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 toast HTML on successful delete', async () => {
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/regulations/wcag21',
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
        url: '/admin/regulations/wcag21',
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on delete', async () => {
      vi.mocked(complianceClient.deleteRegulation).mockRejectedValueOnce(new Error('Not found'));
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/regulations/wcag21',
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Not found');
    });
  });
});

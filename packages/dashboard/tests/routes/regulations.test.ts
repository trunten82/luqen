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

    it('passes no filter when jurisdictionId is empty string', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations?jurisdictionId=' });
      expect(response.statusCode).toBe(200);
      // Empty jurisdictionId should pass undefined filter
      expect(complianceClient.listRegulations).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        undefined,
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

    it('renders page with fallback error when non-Error is thrown', async () => {
      vi.mocked(complianceClient.listRegulations).mockRejectedValueOnce('string error');
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { error: string } };
      expect(body.data.error).toBe('Failed to load regulations');
    });

    it('filters by search query q param', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations?q=wcag' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { regulations: Array<{ id: string }> } };
      // Only WCAG 2.1 should match (name or shortName contains 'wcag')
      expect(body.data.regulations.length).toBe(1);
      expect(body.data.regulations[0].id).toBe('wcag21');
    });

    it('filters by shortName via q param', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations?q=ada' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { regulations: Array<{ id: string }> } };
      expect(body.data.regulations.length).toBe(1);
      expect(body.data.regulations[0].id).toBe('ada');
    });

    it('returns empty results for non-matching q param', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations?q=xyznonexistent' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { regulations: Array<unknown> } };
      expect(body.data.regulations).toHaveLength(0);
    });

    it('paginates results with offset and limit', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations?offset=0&limit=1' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { regulations: Array<unknown>; hasNext: boolean; hasPrev: boolean; currentPage: number; nextOffset: number } };
      expect(body.data.regulations).toHaveLength(1);
      expect(body.data.hasNext).toBe(true);
      expect(body.data.hasPrev).toBe(false);
      expect(body.data.currentPage).toBe(1);
      expect(body.data.nextOffset).toBe(1);
    });

    it('returns hasPrev true when offset > 0', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations?offset=1&limit=1' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { hasPrev: boolean; hasNext: boolean; prevOffset: number } };
      expect(body.data.hasPrev).toBe(true);
      expect(body.data.hasNext).toBe(false);
      expect(body.data.prevOffset).toBe(0);
    });

    it('renders regulations-table.hbs for HTMX requests', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/regulations',
        headers: { 'hx-request': 'true' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { regulations: unknown[] } };
      expect(body.template).toBe('admin/regulations-table.hbs');
      expect(Array.isArray(body.data.regulations)).toBe(true);
    });

    it('renders regulations-table.hbs with pagination data for HTMX', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/regulations?offset=0&limit=1',
        headers: { 'hx-request': 'true' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { hasNext: boolean; hasPrev: boolean; q: string; jurisdictionId: undefined } };
      expect(body.template).toBe('admin/regulations-table.hbs');
      expect(body.data.hasNext).toBe(true);
      expect(body.data.q).toBe('');
    });

    it('includes user and currentPath in full page data', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations' });
      const body = response.json() as { data: { pageTitle: string; currentPath: string; user: { username: string } } };
      expect(body.data.pageTitle).toBe('Regulations');
      expect(body.data.currentPath).toBe('/admin/regulations');
      expect(body.data.user.username).toBe('admin');
    });

    it('does not include user/pageTitle in HTMX table response', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/regulations',
        headers: { 'hx-request': 'true' },
      });
      const body = response.json() as { data: Record<string, unknown> };
      expect(body.data['pageTitle']).toBeUndefined();
      expect(body.data['user']).toBeUndefined();
    });
  });

  describe('GET /admin/regulations/new', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with regulation-form.hbs template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/new' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { isNew: boolean; regulation: { id: string } } };
      expect(body.template).toBe('admin/regulation-form.hbs');
      expect(body.data.isNew).toBe(true);
      expect(body.data.regulation.id).toBe('');
    });

    it('includes jurisdictions list in form data', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/new' });
      const body = response.json() as { data: { jurisdictions: Array<{ id: string }> } };
      expect(Array.isArray(body.data.jurisdictions)).toBe(true);
      expect(body.data.jurisdictions.length).toBeGreaterThan(0);
    });

    it('pre-fills jurisdictionId from query param', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/new?jurisdictionId=US' });
      const body = response.json() as { data: { regulation: { jurisdictionId: string } } };
      expect(body.data.regulation.jurisdictionId).toBe('US');
    });

    it('defaults jurisdictionId to empty when no query param', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/new' });
      const body = response.json() as { data: { regulation: { jurisdictionId: string } } };
      expect(body.data.regulation.jurisdictionId).toBe('');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/new' });
      expect(response.statusCode).toBe(403);
    });

    it('still returns form even if listJurisdictions fails', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockRejectedValueOnce(new Error('fail'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/new' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { jurisdictions: unknown[]; isNew: boolean } };
      expect(body.data.isNew).toBe(true);
      expect(body.data.jurisdictions).toHaveLength(0);
    });

    it('sets default regulation field values', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/new' });
      const body = response.json() as { data: { regulation: { name: string; shortName: string; enforcementDate: string; status: string; scope: string } } };
      expect(body.data.regulation.name).toBe('');
      expect(body.data.regulation.shortName).toBe('');
      expect(body.data.regulation.enforcementDate).toBe('');
      expect(body.data.regulation.status).toBe('active');
      expect(body.data.regulation.scope).toBe('');
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

    it('returns 400 when id is empty', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload: 'id=&name=Test&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when name is empty', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload: 'id=test&name=&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when jurisdictionId is empty', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload: 'id=test&name=Test&jurisdictionId=',
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

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.createRegulation).mockRejectedValueOnce('string error');
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload: 'id=x&name=X&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to create regulation');
    });

    it('trims whitespace from fields before sending', async () => {
      const payload = 'id=+new-reg+&name=+New+Regulation+&shortName=+NR+&jurisdictionId=+EU+&enforcementDate=+2025-01-01+&status=+active+&scope=+web+';
      await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(complianceClient.createRegulation).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        expect.objectContaining({
          id: 'new-reg',
          name: 'New Regulation',
          shortName: 'NR',
          jurisdictionId: 'EU',
        }),
        expect.anything(),
      );
    });

    it('includes modal-container OOB swap and toast in response', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload: 'id=new-reg&name=New+Regulation&shortName=NR&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.body).toContain('modal-container');
      expect(response.body).toContain('hx-swap-oob="true"');
      expect(response.body).toContain('created successfully');
    });

    it('creates row HTML with View button', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/regulations',
        payload: 'id=new-reg&name=New+Regulation&shortName=NR&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.body).toContain('regulation-new-reg');
      expect(response.body).toContain('View');
    });
  });

  describe('GET /admin/regulations/:id/view', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with regulation-view.hbs for existing regulation', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { regulation: { id: string }; requirements: unknown[]; jurisdictionName: string; isSystem: boolean } };
      expect(body.template).toBe('admin/regulation-view.hbs');
      expect(body.data.regulation.id).toBe('wcag21');
      expect(body.data.requirements.length).toBeGreaterThan(0);
    });

    it('resolves jurisdiction name from jurisdictions list', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      const body = response.json() as { data: { jurisdictionName: string } };
      expect(body.data.jurisdictionName).toBe('European Union');
    });

    it('falls back to jurisdictionId when jurisdiction not found in list', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      const body = response.json() as { data: { jurisdictionName: string } };
      expect(body.data.jurisdictionName).toBe('EU');
    });

    it('returns isSystem=true for system orgId', async () => {
      vi.mocked(complianceClient.listRegulations).mockResolvedValueOnce([
        { id: 'wcag21', name: 'WCAG 2.1', shortName: 'WCAG', jurisdictionId: 'EU', enforcementDate: '2024-01-01', status: 'active', scope: 'web', orgId: 'system' },
      ]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      const body = response.json() as { data: { isSystem: boolean } };
      expect(body.data.isSystem).toBe(true);
    });

    it('returns isSystem=true for undefined orgId', async () => {
      vi.mocked(complianceClient.listRegulations).mockResolvedValueOnce([
        { id: 'wcag21', name: 'WCAG 2.1', shortName: 'WCAG', jurisdictionId: 'EU', enforcementDate: '2024-01-01', status: 'active', scope: 'web' },
      ]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      const body = response.json() as { data: { isSystem: boolean } };
      expect(body.data.isSystem).toBe(true);
    });

    it('returns isSystem=false for org-specific regulation', async () => {
      vi.mocked(complianceClient.listRegulations).mockResolvedValueOnce([
        { id: 'wcag21', name: 'WCAG 2.1', shortName: 'WCAG', jurisdictionId: 'EU', enforcementDate: '2024-01-01', status: 'active', scope: 'web', orgId: 'my-org' },
      ]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      const body = response.json() as { data: { isSystem: boolean } };
      expect(body.data.isSystem).toBe(false);
    });

    it('returns 404 when regulation is not found', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/nonexistent/view' });
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain('Regulation not found');
    });

    it('returns 500 when compliance client throws', async () => {
      vi.mocked(complianceClient.listRegulations).mockRejectedValueOnce(new Error('API error'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('API error');
    });

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.listRegulations).mockRejectedValueOnce(42);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to load regulation');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/view' });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /admin/regulations/:id/edit', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with regulation-form.hbs for existing regulation', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/edit' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { isNew: boolean; regulation: { id: string }; jurisdictions: unknown[] } };
      expect(body.template).toBe('admin/regulation-form.hbs');
      expect(body.data.isNew).toBe(false);
      expect(body.data.regulation.id).toBe('wcag21');
      expect(Array.isArray(body.data.jurisdictions)).toBe(true);
    });

    it('returns 404 when regulation is not found', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/nonexistent/edit' });
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain('Regulation not found');
    });

    it('returns 500 when compliance client throws', async () => {
      vi.mocked(complianceClient.listRegulations).mockRejectedValueOnce(new Error('API fail'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/edit' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('API fail');
    });

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.listRegulations).mockRejectedValueOnce(null);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/edit' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to load regulation');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/regulations/wcag21/edit' });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /admin/regulations/:id (update)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with row HTML on successful update', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'name=WCAG+2.1+Updated&jurisdictionId=EU&shortName=WCAG&enforcementDate=2024-01-01&status=active&scope=web',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('WCAG 2.1 Updated');
    });

    it('returns 400 when name is missing', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'name=&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Name and jurisdiction are required');
    });

    it('returns 400 when jurisdictionId is missing', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'name=Test&jurisdictionId=',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when both name and jurisdictionId are missing', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'shortName=test',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when updateRegulation throws', async () => {
      vi.mocked(complianceClient.updateRegulation).mockRejectedValueOnce(new Error('Update failed'));
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'name=Test&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Update failed');
    });

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.updateRegulation).mockRejectedValueOnce(undefined);
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'name=Test&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to update regulation');
    });

    it('includes modal-container OOB swap and toast in response', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'name=WCAG+2.1+Updated&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.body).toContain('modal-container');
      expect(response.body).toContain('hx-swap-oob="true"');
      expect(response.body).toContain('updated successfully');
    });

    it('passes trimmed optional fields to updateRegulation', async () => {
      await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'name=+Test+&jurisdictionId=+EU+&shortName=+T+&enforcementDate=+2024-01-01+&status=+active+&scope=+web+',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(complianceClient.updateRegulation).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        'wcag21',
        expect.objectContaining({
          name: 'Test',
          jurisdictionId: 'EU',
          shortName: 'T',
          enforcementDate: '2024-01-01',
          status: 'active',
          scope: 'web',
        }),
        expect.anything(),
      );
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/regulations/wcag21',
        payload: 'name=Test&jurisdictionId=EU',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(403);
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

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.deleteRegulation).mockRejectedValueOnce(123);
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/regulations/wcag21',
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to delete regulation');
    });
  });
});

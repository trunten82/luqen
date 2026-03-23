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

    it('filters jurisdictions by id via search query', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions?q=eu' });
      const body = response.json() as { data: { jurisdictions: Array<{ id: string }> } };
      expect(body.data.jurisdictions.some((j) => j.id === 'EU')).toBe(true);
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

    it('includes total, hasNext, limit in template data', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });
      const body = response.json() as { data: { total: number; hasNext: boolean; limit: number; q: string } };
      expect(body.data.total).toBe(2);
      expect(body.data.hasNext).toBe(false);
      expect(body.data.limit).toBe(20);
      expect(body.data.q).toBe('');
    });

    it('paginates with offset and limit', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions?offset=0&limit=1' });
      const body = response.json() as { data: { jurisdictions: unknown[]; hasNext: boolean; nextOffset: number; total: number } };
      expect(body.data.jurisdictions).toHaveLength(1);
      expect(body.data.hasNext).toBe(true);
      expect(body.data.nextOffset).toBe(1);
      expect(body.data.total).toBe(2);
    });

    it('includes user and pageTitle in template data', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });
      const body = response.json() as { data: { pageTitle: string; currentPath: string; user: { username: string } } };
      expect(body.data.pageTitle).toBe('Jurisdictions');
      expect(body.data.currentPath).toBe('/admin/jurisdictions');
      expect(body.data.user.username).toBe('admin');
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

    it('renders fallback error when non-Error is thrown', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockRejectedValueOnce('string error');
      ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { error: string } };
      expect(body.data.error).toBe('Failed to load jurisdictions');
    });
  });

  describe('GET /admin/jurisdictions — HTMX request (search)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns HTML table for HTMX request', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions',
        headers: { 'hx-request': 'true' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<table');
      expect(response.body).toContain('jurisdictions-table-body');
    });

    it('returns empty row message when no jurisdictions match HTMX search', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?q=xyznonexistent',
        headers: { 'hx-request': 'true' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('No jurisdictions found');
    });

    it('includes load more button in HTMX response when hasNext', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?offset=0&limit=1',
        headers: { 'hx-request': 'true' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Load more');
    });

    it('excludes load more button in HTMX response when no hasNext', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?offset=0&limit=20',
        headers: { 'hx-request': 'true' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('Load more');
    });

    it('includes jurisdiction rows with View buttons in HTMX table', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions',
        headers: { 'hx-request': 'true' },
      });
      expect(response.body).toContain('jurisdiction-EU');
      expect(response.body).toContain('jurisdiction-US');
      expect(response.body).toContain('View');
    });
  });

  describe('GET /admin/jurisdictions — partial=rows (load more)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns HTML rows for partial=rows request', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?partial=rows&offset=0&limit=1',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('jurisdiction-');
    });

    it('includes counter OOB swap', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?partial=rows&offset=0&limit=1',
      });
      expect(response.body).toContain('jurisdictions-counter');
      expect(response.body).toContain('hx-swap-oob="true"');
      expect(response.body).toContain('Showing 1 of 2');
    });

    it('includes load-more button when hasNext', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?partial=rows&offset=0&limit=1',
      });
      expect(response.body).toContain('load-more-jurisdictions');
      expect(response.body).toContain('Load more');
      expect(response.body).toContain('1 of 2');
    });

    it('removes load-more when no more items', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?partial=rows&offset=0&limit=20',
      });
      expect(response.body).toContain('load-more-jurisdictions');
      // The load-more div should be empty (no button)
      expect(response.body).not.toContain('Load more');
    });

    it('includes q parameter in load-more URL', async () => {
      // Mock returns EU + US; both match 'u' filter, limit=1 → hasNext=true
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?partial=rows&offset=0&limit=1&q=u',
      });
      expect(response.body).toContain('q=u');
    });

    it('displays parentId in rows when present', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([
        { id: 'CA-ON', name: 'Ontario', type: 'province', parentId: 'CA' },
      ]);
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/admin/jurisdictions?partial=rows&offset=0&limit=10',
      });
      expect(response.body).toContain('CA');
    });
  });

  describe('GET /admin/jurisdictions/new', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with jurisdiction-form.hbs template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/new' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { isNew: boolean; jurisdiction: { id: string } } };
      expect(body.template).toBe('admin/jurisdiction-form.hbs');
      expect(body.data.isNew).toBe(true);
      expect(body.data.jurisdiction.id).toBe('');
    });

    it('sets empty defaults for jurisdiction fields', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/new' });
      const body = response.json() as { data: { jurisdiction: { name: string; type: string; parentId: string } } };
      expect(body.data.jurisdiction.name).toBe('');
      expect(body.data.jurisdiction.type).toBe('');
      expect(body.data.jurisdiction.parentId).toBe('');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/new' });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /admin/jurisdictions/:id/view', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with jurisdiction-view.hbs for existing jurisdiction', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/view' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { jurisdiction: { id: string }; regulations: unknown[] } };
      expect(body.template).toBe('admin/jurisdiction-view.hbs');
      expect(body.data.jurisdiction.id).toBe('EU');
      expect(Array.isArray(body.data.regulations)).toBe(true);
    });

    it('passes isSystem=true for system orgId', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([
        { id: 'EU', name: 'European Union', type: 'region', parentId: undefined, orgId: 'system' },
      ]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/view' });
      const body = response.json() as { data: { isSystem: boolean } };
      expect(body.data.isSystem).toBe(true);
    });

    it('passes isSystem=true for undefined orgId', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([
        { id: 'EU', name: 'European Union', type: 'region', parentId: undefined },
      ]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/view' });
      const body = response.json() as { data: { isSystem: boolean } };
      expect(body.data.isSystem).toBe(true);
    });

    it('passes isSystem=false for org-specific jurisdiction', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockResolvedValueOnce([
        { id: 'EU', name: 'European Union', type: 'region', parentId: undefined, orgId: 'my-org' },
      ]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/view' });
      const body = response.json() as { data: { isSystem: boolean } };
      expect(body.data.isSystem).toBe(false);
    });

    it('returns 404 when jurisdiction not found', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/nonexistent/view' });
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain('Jurisdiction not found');
    });

    it('returns 500 when compliance client throws', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockRejectedValueOnce(new Error('API error'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/view' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('API error');
    });

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockRejectedValueOnce(42);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/view' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to load jurisdiction');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/view' });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /admin/jurisdictions/:id/edit', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with jurisdiction-form.hbs for existing jurisdiction', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/edit' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { isNew: boolean; jurisdiction: { id: string } } };
      expect(body.template).toBe('admin/jurisdiction-form.hbs');
      expect(body.data.isNew).toBe(false);
      expect(body.data.jurisdiction.id).toBe('EU');
    });

    it('returns 404 when jurisdiction not found', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/nonexistent/edit' });
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain('Jurisdiction not found');
    });

    it('returns 500 when compliance client throws', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockRejectedValueOnce(new Error('API fail'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/edit' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('API fail');
    });

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.listJurisdictions).mockRejectedValueOnce(null);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/edit' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to load jurisdiction');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/jurisdictions/EU/edit' });
      expect(response.statusCode).toBe(403);
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

    it('returns 400 when id is empty', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=&name=Test&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when name is empty', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when type is empty', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('includes optional parentId when provided', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA-ON&name=Ontario&type=province&parentId=CA',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(complianceClient.createJurisdiction).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        expect.objectContaining({ parentId: 'CA' }),
        expect.anything(),
      );
    });

    it('sends undefined parentId when not provided', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(complianceClient.createJurisdiction).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        expect.objectContaining({ parentId: undefined }),
        expect.anything(),
      );
    });

    it('sends undefined parentId when parentId is empty string', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=country&parentId=',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(complianceClient.createJurisdiction).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        expect.objectContaining({ parentId: undefined }),
        expect.anything(),
      );
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

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.createJurisdiction).mockRejectedValueOnce(42);
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to create jurisdiction');
    });

    it('includes modal-container OOB swap and toast in response', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.body).toContain('modal-container');
      expect(response.body).toContain('hx-swap-oob="true"');
      expect(response.body).toContain('created successfully');
    });

    it('creates row HTML with View button', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/jurisdictions',
        payload: 'id=CA&name=Canada&type=country',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.body).toContain('jurisdiction-CA');
      expect(response.body).toContain('View');
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

    it('returns 400 when name is missing', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=&type=region',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when type is missing', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=EU&type=',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when both name and type are missing', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'parentId=none',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Name and type are required');
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

    it('returns 500 when updateJurisdiction throws', async () => {
      vi.mocked(complianceClient.updateJurisdiction).mockRejectedValueOnce(new Error('Update failed'));
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=EU&type=region',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Update failed');
    });

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.updateJurisdiction).mockRejectedValueOnce(undefined);
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=EU&type=region',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to update jurisdiction');
    });

    it('includes modal-container OOB swap and toast in response', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=European+Union+Updated&type=region',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.body).toContain('modal-container');
      expect(response.body).toContain('hx-swap-oob="true"');
      expect(response.body).toContain('updated successfully');
    });

    it('passes optional parentId when provided', async () => {
      await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=EU&type=region&parentId=WORLD',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(complianceClient.updateJurisdiction).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        'EU',
        expect.objectContaining({ parentId: 'WORLD' }),
        expect.anything(),
      );
    });

    it('sends undefined parentId when empty string', async () => {
      await ctx.server.inject({
        method: 'PATCH',
        url: '/admin/jurisdictions/EU',
        payload: 'name=EU&type=region&parentId=',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(complianceClient.updateJurisdiction).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        'EU',
        expect.objectContaining({ parentId: undefined }),
        expect.anything(),
      );
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

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      vi.mocked(complianceClient.deleteJurisdiction).mockRejectedValueOnce(123);
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/jurisdictions/EU',
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Failed to delete jurisdiction');
    });
  });
});

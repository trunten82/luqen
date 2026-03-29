import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { sourceRoutes } from '../../src/routes/admin/sources.js';

vi.mock('../../src/compliance-client.js', () => ({
  listSources: vi.fn().mockResolvedValue([
    {
      id: 'src-1',
      name: 'W3C RSS Feed',
      url: 'https://www.w3.org/feeds/news.rss',
      type: 'rss',
      schedule: 'daily',
      lastChecked: '2024-06-01T10:00:00Z',
    },
    {
      id: 'src-2',
      name: 'EU Gov Feed',
      url: 'https://example.eu/feed',
      type: 'atom',
      schedule: 'weekly',
      lastChecked: undefined,
    },
  ]),
  createSource: vi.fn().mockResolvedValue({
    id: 'src-3',
    name: 'New Source',
    url: 'https://example.com/rss',
    type: 'rss',
    schedule: 'daily',
    lastChecked: undefined,
  }),
  deleteSource: vi.fn().mockResolvedValue(undefined),
  scanSources: vi.fn().mockResolvedValue({ scanned: 2, proposalsCreated: 1 }),
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

  await sourceRoutes(server, BASE_URL);
  await server.ready();

  const cleanup = (): void => { void server.close(); };
  return { server, cleanup };
}

describe('Source routes', () => {
  let ctx: TestContext;

  afterEach(() => { ctx.cleanup(); });

  describe('GET /admin/sources', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and renders sources template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/sources' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/sources.hbs');
    });

    it('lists mocked sources', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/sources' });
      const body = response.json() as { data: { sources: Array<{ id: string }> } };
      expect(Array.isArray(body.data.sources)).toBe(true);
      expect(body.data.sources.length).toBe(2);
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/sources' });
      expect(response.statusCode).toBe(403);
    });

    it('renders page with error when compliance client throws', async () => {
      vi.mocked(complianceClient.listSources).mockRejectedValueOnce(new Error('Service down'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/sources' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { error: string; sources: unknown[] } };
      expect(body.data.error).toBeTruthy();
      expect(body.data.sources).toHaveLength(0);
    });
  });

  describe('POST /admin/sources (create)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with row HTML on successful create', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/sources',
        payload: 'name=New+Source&url=https%3A%2F%2Fexample.com%2Frss&type=rss&schedule=daily',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('New Source');
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/sources',
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
        url: '/admin/sources',
        payload: 'name=S&url=https%3A%2F%2Fexample.com',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on create', async () => {
      vi.mocked(complianceClient.createSource).mockRejectedValueOnce(new Error('Invalid URL'));
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/sources',
        payload: 'name=Bad+Source&url=https%3A%2F%2Fbad.example&type=rss&schedule=daily',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Invalid URL');
    });
  });

  describe('DELETE /admin/sources/:id (delete)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 toast HTML on successful delete', async () => {
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/sources/src-1',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('removed successfully');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/sources/src-1',
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on delete', async () => {
      vi.mocked(complianceClient.deleteSource).mockRejectedValueOnce(new Error('Not found'));
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/sources/src-1',
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Not found');
    });
  });

  describe('POST /admin/sources/scan (trigger scan)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with scan results HTML', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/sources/scan',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Scan complete');
      expect(response.body).toContain('2');
      expect(response.body).toContain('1');
    });

    it('calls scanSources with the base URL', async () => {
      await ctx.server.inject({ method: 'POST', url: '/admin/sources/scan' });
      expect(complianceClient.scanSources).toHaveBeenCalledWith(BASE_URL, expect.any(String), true);
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/sources/scan' });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when scan fails', async () => {
      vi.mocked(complianceClient.scanSources).mockRejectedValueOnce(new Error('Scan failed'));
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/sources/scan' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Scan failed');
    });
  });
});

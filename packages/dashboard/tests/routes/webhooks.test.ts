import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { webhookRoutes } from '../../src/routes/admin/webhooks.js';

vi.mock('../../src/compliance-client.js', () => ({
  listWebhooks: vi.fn().mockResolvedValue([
    {
      id: 'wh-1',
      url: 'https://example.com/hook',
      events: ['compliance.check', 'scan.complete'],
      active: true,
      createdAt: '2024-06-01T10:00:00Z',
    },
    {
      id: 'wh-2',
      url: 'https://other.example.com/hook',
      events: ['proposal.created'],
      active: false,
      createdAt: '2024-05-01T08:00:00Z',
    },
  ]),
  createWebhook: vi.fn().mockResolvedValue({
    id: 'wh-3',
    url: 'https://new.example.com/hook',
    events: ['scan.complete'],
    active: true,
    createdAt: '2024-07-01T12:00:00Z',
  }),
  deleteWebhook: vi.fn().mockResolvedValue(undefined),
  testWebhook: vi.fn().mockResolvedValue(undefined),
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

  await webhookRoutes(server, BASE_URL);
  await server.ready();

  const cleanup = (): void => { void server.close(); };
  return { server, cleanup };
}

describe('Webhook routes', () => {
  let ctx: TestContext;

  afterEach(() => { ctx.cleanup(); });

  describe('GET /admin/webhooks', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and renders webhooks template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/webhooks' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/webhooks.hbs');
    });

    it('lists mocked webhooks with formatted display fields', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/webhooks' });
      const body = response.json() as {
        data: { webhooks: Array<{ id: string; eventsDisplay: string; createdAtDisplay: string }> };
      };
      expect(body.data.webhooks).toHaveLength(2);
      expect(body.data.webhooks[0]).toHaveProperty('eventsDisplay');
      expect(body.data.webhooks[0]).toHaveProperty('createdAtDisplay');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/webhooks' });
      expect(response.statusCode).toBe(403);
    });

    it('renders page with error when compliance client throws', async () => {
      vi.mocked(complianceClient.listWebhooks).mockRejectedValueOnce(new Error('Connection refused'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/webhooks' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { error: string; webhooks: unknown[] } };
      expect(body.data.error).toBeTruthy();
      expect(body.data.webhooks).toHaveLength(0);
    });
  });

  describe('POST /admin/webhooks (create)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with row HTML on successful create', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/webhooks',
        payload: 'url=https%3A%2F%2Fnew.example.com%2Fhook&events=scan.complete',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('new.example.com');
    });

    it('handles multiple events', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/webhooks',
        payload: 'url=https%3A%2F%2Fnew.example.com%2Fhook&events=scan.complete&events=proposal.created',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(200);
      expect(complianceClient.createWebhook).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        expect.objectContaining({ events: expect.arrayContaining(['scan.complete', 'proposal.created']) }),
        expect.anything(),
      );
    });

    it('returns 400 when URL is missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/webhooks',
        payload: 'events=scan.complete',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/webhooks',
        payload: 'url=https%3A%2F%2Fexample.com%2Fhook',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on create', async () => {
      vi.mocked(complianceClient.createWebhook).mockRejectedValueOnce(new Error('Invalid endpoint'));
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/webhooks',
        payload: 'url=https%3A%2F%2Fbad.example.com%2Fhook&events=scan.complete',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Invalid endpoint');
    });
  });

  describe('POST /admin/webhooks/:id/test (test delivery)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 toast HTML on successful test delivery', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/webhooks/wh-1/test',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Test delivery sent successfully');
    });

    it('calls testWebhook with the correct id', async () => {
      await ctx.server.inject({ method: 'POST', url: '/admin/webhooks/wh-1/test' });
      expect(complianceClient.testWebhook).toHaveBeenCalledWith(BASE_URL, expect.any(String), 'wh-1');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/webhooks/wh-1/test' });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when test delivery fails', async () => {
      vi.mocked(complianceClient.testWebhook).mockRejectedValueOnce(new Error('Endpoint unreachable'));
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/webhooks/wh-1/test' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Endpoint unreachable');
    });
  });

  describe('DELETE /admin/webhooks/:id (delete)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 toast HTML on successful delete', async () => {
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/admin/webhooks/wh-1',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('deleted successfully');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/webhooks/wh-1' });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on delete', async () => {
      vi.mocked(complianceClient.deleteWebhook).mockRejectedValueOnce(new Error('Webhook not found'));
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/webhooks/wh-1' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Webhook not found');
    });
  });
});

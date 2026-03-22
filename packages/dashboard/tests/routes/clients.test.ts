import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { clientRoutes } from '../../src/routes/admin/clients.js';

vi.mock('../../src/compliance-client.js', () => ({
  listClients: vi.fn().mockResolvedValue([
    {
      clientId: 'client-abc',
      name: 'My App',
      scopes: ['compliance:read'],
      grantTypes: ['client_credentials'],
      createdAt: '2024-06-01T10:00:00Z',
    },
    {
      clientId: 'client-xyz',
      name: 'Another App',
      scopes: ['compliance:read', 'compliance:write'],
      grantTypes: ['client_credentials', 'refresh_token'],
      createdAt: '2024-05-01T08:00:00Z',
    },
  ]),
  createClient: vi.fn().mockResolvedValue({
    clientId: 'new-client-id',
    name: 'New Client',
    scopes: ['compliance:read'],
    grantTypes: ['client_credentials'],
    createdAt: '2024-07-01T12:00:00Z',
    secret: 'super-secret-value-123',
  }),
  revokeClient: vi.fn().mockResolvedValue(undefined),
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

  await clientRoutes(server, BASE_URL);
  await server.ready();

  const cleanup = (): void => { void server.close(); };
  return { server, cleanup };
}

describe('OAuth Client routes', () => {
  let ctx: TestContext;

  afterEach(() => { ctx.cleanup(); });

  describe('GET /admin/clients', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and renders clients template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/clients.hbs');
    });

    it('lists mocked OAuth clients with display fields', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/clients' });
      const body = response.json() as {
        data: { clients: Array<{ clientId: string; scopesDisplay: string; grantTypesDisplay: string; createdAtDisplay: string }> };
      };
      expect(body.data.clients).toHaveLength(2);
      expect(body.data.clients[0]).toHaveProperty('scopesDisplay');
      expect(body.data.clients[0]).toHaveProperty('grantTypesDisplay');
      expect(body.data.clients[0]).toHaveProperty('createdAtDisplay');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(response.statusCode).toBe(403);
    });

    it('renders page with error when compliance client throws', async () => {
      vi.mocked(complianceClient.listClients).mockRejectedValueOnce(new Error('Service unavailable'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { error: string; clients: unknown[] } };
      expect(body.data.error).toBeTruthy();
      expect(body.data.clients).toHaveLength(0);
    });
  });

  describe('POST /admin/clients (create)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with row HTML and secret modal on successful create', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/clients',
        payload: 'name=New+Client&scopes=compliance%3Aread&grantTypes=client_credentials',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('New Client');
      // Secret should appear once in the modal
      expect(response.body).toContain('super-secret-value-123');
    });

    it('returns 400 when name is missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/clients',
        payload: 'scopes=compliance%3Aread',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('calls createClient with correct arguments', async () => {
      await ctx.server.inject({
        method: 'POST',
        url: '/admin/clients',
        payload: 'name=Test+Client&scopes=compliance%3Aread&grantTypes=client_credentials',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(complianceClient.createClient).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        expect.objectContaining({
          name: 'Test Client',
          scopes: expect.arrayContaining(['compliance:read']),
          grantTypes: expect.arrayContaining(['client_credentials']),
        }),
        expect.anything(),
      );
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/clients',
        payload: 'name=Client',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on create', async () => {
      vi.mocked(complianceClient.createClient).mockRejectedValueOnce(new Error('Quota exceeded'));
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/clients',
        payload: 'name=New+Client&scopes=compliance%3Aread&grantTypes=client_credentials',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Quota exceeded');
    });
  });

  describe('POST /admin/clients/:id/revoke (revoke)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 toast HTML on successful revoke', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/clients/client-abc/revoke',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('revoked successfully');
    });

    it('calls revokeClient with the correct id', async () => {
      await ctx.server.inject({ method: 'POST', url: '/admin/clients/client-abc/revoke' });
      expect(complianceClient.revokeClient).toHaveBeenCalledWith(BASE_URL, expect.any(String), 'client-abc');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/clients/client-abc/revoke' });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when revoke fails', async () => {
      vi.mocked(complianceClient.revokeClient).mockRejectedValueOnce(new Error('Client not found'));
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/clients/client-abc/revoke' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Client not found');
    });
  });
});

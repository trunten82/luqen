import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { proposalRoutes } from '../../src/routes/admin/proposals.js';

vi.mock('../../src/compliance-client.js', () => ({
  listUpdateProposals: vi.fn().mockResolvedValue([
    {
      id: 'prop-1',
      status: 'pending',
      source: 'w3c-rss',
      type: 'requirement_change',
      summary: 'New criterion added to WCAG 2.2',
      detectedAt: '2024-06-01T10:00:00Z',
    },
    {
      id: 'prop-2',
      status: 'approved',
      source: 'eu-gov-feed',
      type: 'regulation_update',
      summary: 'EN 301 549 updated',
      detectedAt: '2024-05-15T08:30:00Z',
    },
  ]),
  approveProposal: vi.fn().mockResolvedValue({
    id: 'prop-1',
    status: 'approved',
    source: 'w3c-rss',
    type: 'requirement_change',
    summary: 'New criterion added to WCAG 2.2',
    detectedAt: '2024-06-01T10:00:00Z',
  }),
  rejectProposal: vi.fn().mockResolvedValue({
    id: 'prop-1',
    status: 'rejected',
    source: 'w3c-rss',
    type: 'requirement_change',
    summary: 'New criterion added to WCAG 2.2',
    detectedAt: '2024-06-01T10:00:00Z',
  }),
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

  await proposalRoutes(server, BASE_URL);
  await server.ready();

  const cleanup = (): void => { void server.close(); };
  return { server, cleanup };
}

describe('Proposal routes', () => {
  let ctx: TestContext;

  afterEach(() => { ctx.cleanup(); });

  describe('GET /admin/proposals', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and renders proposals template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/proposals' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/proposals.hbs');
    });

    it('lists mocked proposals', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/proposals' });
      const body = response.json() as { data: { proposals: Array<{ id: string }> } };
      expect(Array.isArray(body.data.proposals)).toBe(true);
      expect(body.data.proposals.length).toBeGreaterThan(0);
    });

    it('passes status filter to compliance client when provided', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/proposals?status=pending' });
      expect(response.statusCode).toBe(200);
      expect(complianceClient.listUpdateProposals).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        'pending',
        expect.anything(),
      );
    });

    it('includes detectedAtDisplay and isPending fields on each proposal', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/proposals' });
      const body = response.json() as { data: { proposals: Array<{ isPending: boolean; detectedAtDisplay: string }> } };
      expect(body.data.proposals[0]).toHaveProperty('isPending');
      expect(body.data.proposals[0]).toHaveProperty('detectedAtDisplay');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/proposals' });
      expect(response.statusCode).toBe(403);
    });

    it('renders page with error when compliance client throws', async () => {
      vi.mocked(complianceClient.listUpdateProposals).mockRejectedValueOnce(new Error('Service unavailable'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/proposals' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { error: string; proposals: unknown[] } };
      expect(body.data.error).toBeTruthy();
      expect(body.data.proposals).toHaveLength(0);
    });
  });

  describe('POST /admin/proposals/:id/approve', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and toast on successful approve', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/proposals/prop-1/approve',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Proposal approved');
    });

    it('calls approveProposal with the correct id', async () => {
      await ctx.server.inject({ method: 'POST', url: '/admin/proposals/prop-1/approve' });
      expect(complianceClient.approveProposal).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        'prop-1',
        expect.anything(),
      );
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/proposals/prop-1/approve' });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on approve', async () => {
      vi.mocked(complianceClient.approveProposal).mockRejectedValueOnce(new Error('Cannot approve'));
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/proposals/prop-1/approve' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Cannot approve');
    });
  });

  describe('POST /admin/proposals/:id/reject', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and toast on successful reject', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/proposals/prop-1/reject',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Proposal dismissed');
    });

    it('calls rejectProposal with the correct id', async () => {
      await ctx.server.inject({ method: 'POST', url: '/admin/proposals/prop-1/reject' });
      expect(complianceClient.rejectProposal).toHaveBeenCalledWith(
        BASE_URL,
        expect.any(String),
        'prop-1',
        expect.anything(),
      );
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/proposals/prop-1/reject' });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when compliance client throws on reject', async () => {
      vi.mocked(complianceClient.rejectProposal).mockRejectedValueOnce(new Error('Cannot reject'));
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/proposals/prop-1/reject' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Cannot reject');
    });
  });
});

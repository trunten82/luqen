import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listUpdateProposals,
  approveProposal,
  rejectProposal,
} from '../../compliance-client.js';
import { adminGuard } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';

export async function proposalRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  // GET /admin/proposals — list pending proposals
  server.get(
    '/admin/proposals',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { status?: string };
      const statusFilter = query.status;

      let proposals: Awaited<ReturnType<typeof listUpdateProposals>> = [];
      let error: string | undefined;

      try {
        proposals = await listUpdateProposals(baseUrl, getToken(request), statusFilter, getOrgId(request));
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load proposals';
      }

      const formatted = proposals.map((p) => ({
        ...p,
        detectedAtDisplay: new Date(p.detectedAt).toLocaleString(),
        isPending: p.status === 'pending',
      }));

      return reply.view('admin/proposals.hbs', {
        pageTitle: 'Update Proposals',
        currentPath: '/admin/proposals',
        user: request.user,
        proposals: formatted,
        statusFilter: statusFilter ?? '',
        error,
      });
    },
  );

  // POST /admin/proposals/:id/approve — approve proposal
  server.post(
    '/admin/proposals/:id/approve',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const updated = await approveProposal(baseUrl, getToken(request), id, getOrgId(request));

        const rowHtml = `<tr id="proposal-${updated.id}">
  <td>${updated.source}</td>
  <td>${updated.type}</td>
  <td>${updated.summary}</td>
  <td>${new Date(updated.detectedAt).toLocaleString()}</td>
  <td><span class="badge badge--success">${updated.status}</span></td>
  <td><!-- no actions for approved --></td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${rowHtml}\n${toastHtml('Proposal approved successfully.')}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to approve proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/proposals/:id/reject — reject proposal
  server.post(
    '/admin/proposals/:id/reject',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const updated = await rejectProposal(baseUrl, getToken(request), id, getOrgId(request));

        const rowHtml = `<tr id="proposal-${updated.id}">
  <td>${updated.source}</td>
  <td>${updated.type}</td>
  <td>${updated.summary}</td>
  <td>${new Date(updated.detectedAt).toLocaleString()}</td>
  <td><span class="badge badge--error">${updated.status}</span></td>
  <td><!-- no actions for rejected --></td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${rowHtml}\n${toastHtml('Proposal rejected.')}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reject proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}

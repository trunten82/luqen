import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { parsePagination, paginateArray } from '../pagination.js';
import { proposeUpdate, approveUpdate, rejectUpdate } from '../../engine/proposals.js';
import type { TokenPayload } from '../../auth/oauth.js';
import type { FastifyRequest } from 'fastify';

type AuthRequest = FastifyRequest & { tokenPayload?: TokenPayload };

export async function registerUpdateRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // POST /api/v1/updates/propose
  app.post('/api/v1/updates/propose', {
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof proposeUpdate>[1];
      const proposal = await proposeUpdate(db, body);
      await reply.status(201).send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // GET /api/v1/updates
  app.get('/api/v1/updates', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const statusFilter = query.status ? String(query.status) : undefined;
      const items = await db.listUpdateProposals(statusFilter ? { status: statusFilter } : undefined);
      const pagination = parsePagination(query);
      await reply.send(paginateArray(items, pagination));
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/updates/:id
  app.get('/api/v1/updates/:id', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const proposal = await db.getUpdateProposal(id);
      if (proposal == null) {
        await reply.status(404).send({ error: `UpdateProposal '${id}' not found`, statusCode: 404 });
        return;
      }
      await reply.send(proposal);
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // PATCH /api/v1/updates/:id/approve
  app.patch('/api/v1/updates/:id/approve', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const reviewer = (request as AuthRequest).tokenPayload?.sub ?? 'system';
      const proposal = await approveUpdate(db, id, reviewer);
      await reply.send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });

  // PATCH /api/v1/updates/:id/reject
  app.patch('/api/v1/updates/:id/reject', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const reviewer = (request as AuthRequest).tokenPayload?.sub ?? 'system';
      const proposal = await rejectUpdate(db, id, reviewer);
      await reply.send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });
}

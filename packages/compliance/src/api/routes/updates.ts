import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { parsePagination, paginateArray } from '../pagination.js';
import { proposeUpdate, approveUpdate, rejectUpdate, acknowledgeUpdate, reviewUpdate, dismissUpdate } from '../../engine/proposals.js';
import type { TokenPayload } from '../../auth/oauth.js';
import type { FastifyRequest } from 'fastify';

type AuthRequest = FastifyRequest & { tokenPayload?: TokenPayload };

const UpdateProposal = Type.Object({}, { additionalProperties: true });
const UpdateProposalList = Type.Object(
  {
    data: Type.Array(UpdateProposal),
    total: Type.Optional(Type.Number()),
    page: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);
const UpdateBody = Type.Object({}, { additionalProperties: true });
const UpdateParams = Type.Object({ id: Type.String() });
const UpdateNotesBody = Type.Object({ notes: Type.Optional(Type.String()) }, { additionalProperties: true });
const UpdateQuery = Type.Object(
  {
    status: Type.Optional(Type.String()),
    page: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    limit: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  },
  { additionalProperties: true },
);

export async function registerUpdateRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // POST /api/v1/updates/propose
  app.post('/api/v1/updates/propose', {
    schema: {
      tags: ['updates'],
      summary: 'Propose a regulation update',
      body: UpdateBody,
      response: { 201: UpdateProposal, 400: ErrorEnvelope, 401: ErrorEnvelope },
    },
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof proposeUpdate>[1];
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';
      const proposal = await proposeUpdate(db, { ...body, orgId });
      await reply.status(201).send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // GET /api/v1/updates
  app.get('/api/v1/updates', {
    schema: {
      tags: ['updates'],
      summary: 'List update proposals',
      querystring: UpdateQuery,
      response: { 200: UpdateProposalList, 401: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const statusFilter = query.status ? String(query.status) : undefined;
      const orgId = (request as unknown as { orgId?: string }).orgId;
      const filters: Record<string, string> = {};
      if (statusFilter) filters.status = statusFilter;
      if (orgId != null) filters.orgId = orgId;
      const items = await db.listUpdateProposals(
        Object.keys(filters).length > 0 ? filters : undefined,
      );
      const pagination = parsePagination(query);
      await reply.send(paginateArray(items, pagination));
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/updates/:id
  app.get('/api/v1/updates/:id', {
    schema: {
      tags: ['updates'],
      summary: 'Get update proposal by id',
      params: UpdateParams,
      response: { 200: UpdateProposal, 401: ErrorEnvelope, 404: ErrorEnvelope, 500: ErrorEnvelope },
    },
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
    schema: {
      tags: ['updates'],
      summary: 'Approve update proposal',
      params: UpdateParams,
      response: { 200: UpdateProposal, 400: ErrorEnvelope, 404: ErrorEnvelope },
    },
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
    schema: {
      tags: ['updates'],
      summary: 'Reject update proposal',
      params: UpdateParams,
      response: { 200: UpdateProposal, 400: ErrorEnvelope, 404: ErrorEnvelope },
    },
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

  // PATCH /api/v1/updates/:id/acknowledge
  app.patch('/api/v1/updates/:id/acknowledge', {
    schema: {
      tags: ['updates'],
      summary: 'Acknowledge update proposal',
      params: UpdateParams,
      body: UpdateNotesBody,
      response: { 200: UpdateProposal, 400: ErrorEnvelope, 404: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const reviewer = (request as AuthRequest).tokenPayload?.sub ?? 'system';
      const body = (request.body ?? {}) as { notes?: string };
      const proposal = await acknowledgeUpdate(db, id, reviewer, body.notes);
      await reply.send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });

  // PATCH /api/v1/updates/:id/review
  app.patch('/api/v1/updates/:id/review', {
    schema: {
      tags: ['updates'],
      summary: 'Mark update proposal as reviewed',
      params: UpdateParams,
      body: UpdateNotesBody,
      response: { 200: UpdateProposal, 400: ErrorEnvelope, 404: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const reviewer = (request as AuthRequest).tokenPayload?.sub ?? 'system';
      const body = (request.body ?? {}) as { notes?: string };
      const proposal = await reviewUpdate(db, id, reviewer, body.notes);
      await reply.send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });

  // PATCH /api/v1/updates/:id/dismiss
  app.patch('/api/v1/updates/:id/dismiss', {
    schema: {
      tags: ['updates'],
      summary: 'Dismiss update proposal',
      params: UpdateParams,
      body: UpdateNotesBody,
      response: { 200: UpdateProposal, 400: ErrorEnvelope, 404: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const reviewer = (request as AuthRequest).tokenPayload?.sub ?? 'system';
      const body = (request.body ?? {}) as { notes?: string };
      const proposal = await dismissUpdate(db, id, reviewer, body.notes);
      await reply.send(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });
}

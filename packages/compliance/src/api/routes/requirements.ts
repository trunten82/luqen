import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { parsePagination, paginateArray } from '../pagination.js';
import * as crud from '../../engine/crud.js';

const Requirement = Type.Object({}, { additionalProperties: true });
const RequirementDetail = Type.Object({}, { additionalProperties: true });
const RequirementList = Type.Object(
  {
    data: Type.Array(Requirement),
    total: Type.Optional(Type.Number()),
    page: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);
const RequirementParams = Type.Object({ id: Type.String() });
const RequirementBody = Type.Object({}, { additionalProperties: true });
const RequirementBulkBody = Type.Union([
  Type.Array(Type.Object({}, { additionalProperties: true })),
  Type.Object({ requirements: Type.Array(Type.Object({}, { additionalProperties: true })) }, { additionalProperties: true }),
]);
const RequirementQuery = Type.Object(
  {
    regulationId: Type.Optional(Type.String()),
    wcagCriterion: Type.Optional(Type.String()),
    obligation: Type.Optional(Type.String()),
    page: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    limit: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  },
  { additionalProperties: true },
);

export async function registerRequirementRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/requirements
  app.get('/api/v1/requirements', {
    schema: {
      tags: ['requirements'],
      summary: 'List requirements',
      querystring: RequirementQuery,
      response: { 200: RequirementList, 401: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const filters: Record<string, string> = {};
      if (query.regulationId) filters.regulationId = String(query.regulationId);
      if (query.wcagCriterion) filters.wcagCriterion = String(query.wcagCriterion);
      if (query.obligation) filters.obligation = String(query.obligation);
      const orgId = (request as unknown as { orgId?: string }).orgId;
      if (orgId != null) filters.orgId = orgId;

      const items = await db.listRequirements(
        Object.keys(filters).length > 0 ? filters as Parameters<typeof db.listRequirements>[0] : undefined,
      );
      const pagination = parsePagination(query);
      await reply.send(paginateArray(items, pagination));
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/requirements/:id
  app.get('/api/v1/requirements/:id', {
    schema: {
      tags: ['requirements'],
      summary: 'Get requirement by id',
      params: RequirementParams,
      response: { 200: RequirementDetail, 401: ErrorEnvelope, 404: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const requirement = await db.getRequirement(id);
      if (requirement == null) {
        await reply.status(404).send({ error: `Requirement '${id}' not found`, statusCode: 404 });
        return;
      }
      const regulation = await db.getRegulation(requirement.regulationId);
      await reply.send({ ...requirement, regulation });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/requirements
  app.post('/api/v1/requirements', {
    schema: {
      tags: ['requirements'],
      summary: 'Create requirement',
      body: RequirementBody,
      response: { 201: Requirement, 400: ErrorEnvelope, 401: ErrorEnvelope },
    },
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof crud.createRequirement>[1];
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';
      const requirement = await crud.createRequirement(db, { ...body, orgId });
      await reply.status(201).send(requirement);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // POST /api/v1/requirements/bulk
  app.post('/api/v1/requirements/bulk', {
    schema: {
      tags: ['requirements'],
      summary: 'Bulk create requirements',
      body: RequirementBulkBody,
      response: { 201: Type.Array(Requirement), 400: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const body = request.body as { requirements: Parameters<typeof crud.createRequirement>[1][] };
      const items = Array.isArray(body) ? body : body.requirements;
      if (!Array.isArray(items)) {
        await reply.status(400).send({ error: 'Body must be an array or { requirements: [] }', statusCode: 400 });
        return;
      }
      const results = await db.bulkCreateRequirements(items);
      await reply.status(201).send(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // PATCH /api/v1/requirements/:id
  app.patch('/api/v1/requirements/:id', {
    schema: {
      tags: ['requirements'],
      summary: 'Update requirement',
      params: RequirementParams,
      body: RequirementBody,
      response: { 200: Requirement, 400: ErrorEnvelope, 403: ErrorEnvelope, 404: ErrorEnvelope },
    },
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const requestOrgId = (request as unknown as { orgId?: string }).orgId;
      const recordOrgId = await db.getRequirementOrgId(id);
      if (recordOrgId === 'system' && requestOrgId !== 'system') {
        await reply.status(403).send({ error: 'Cannot modify system data', statusCode: 403 });
        return;
      }
      if (recordOrgId !== null && requestOrgId != null && recordOrgId !== 'system' && recordOrgId !== requestOrgId) {
        await reply.status(403).send({ error: 'Cannot modify data belonging to another organisation', statusCode: 403 });
        return;
      }
      const body = request.body as Partial<Parameters<typeof crud.createRequirement>[1]>;
      const requirement = await crud.updateRequirement(db, id, body);
      await reply.send(requirement);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });

  // DELETE /api/v1/requirements/:id
  app.delete('/api/v1/requirements/:id', {
    schema: {
      tags: ['requirements'],
      summary: 'Delete requirement',
      params: RequirementParams,
      response: { 204: Type.Null(), 403: ErrorEnvelope, 404: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const requestOrgId = (request as unknown as { orgId?: string }).orgId;
      const recordOrgId = await db.getRequirementOrgId(id);
      if (recordOrgId == null) {
        await reply.status(404).send({ error: `Requirement '${id}' not found`, statusCode: 404 });
        return;
      }
      if (recordOrgId === 'system' && requestOrgId !== 'system') {
        await reply.status(403).send({ error: 'Cannot delete system data', statusCode: 403 });
        return;
      }
      if (requestOrgId != null && recordOrgId !== 'system' && recordOrgId !== requestOrgId) {
        await reply.status(403).send({ error: 'Cannot delete data belonging to another organisation', statusCode: 403 });
        return;
      }
      await db.deleteRequirement(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}

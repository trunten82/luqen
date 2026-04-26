import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { parsePagination, paginateArray } from '../pagination.js';
import * as crud from '../../engine/crud.js';

const Jurisdiction = Type.Object(
  {
    id: Type.Optional(Type.String()),
    code: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const JurisdictionList = Type.Object(
  {
    data: Type.Array(Jurisdiction),
    total: Type.Optional(Type.Number()),
    page: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

const JurisdictionDetail = Type.Object(
  {
    id: Type.Optional(Type.String()),
    code: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    regulationsCount: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

const JurisdictionBody = Type.Object({}, { additionalProperties: true });
const JurisdictionParams = Type.Object({ id: Type.String() });
const JurisdictionQuery = Type.Object(
  {
    type: Type.Optional(Type.String()),
    parentId: Type.Optional(Type.String()),
    page: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    limit: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  },
  { additionalProperties: true },
);

export async function registerJurisdictionRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/jurisdictions
  app.get('/api/v1/jurisdictions', {
    schema: {
      tags: ['jurisdictions'],
      summary: 'List jurisdictions',
      querystring: JurisdictionQuery,
      response: {
        200: JurisdictionList,
        401: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const filters: Record<string, string> = {};
      if (query.type) filters.type = String(query.type);
      if (query.parentId) filters.parentId = String(query.parentId);
      const orgId = (request as unknown as { orgId?: string }).orgId;
      if (orgId != null) filters.orgId = orgId;

      const items = await db.listJurisdictions(
        Object.keys(filters).length > 0 ? filters as Parameters<typeof db.listJurisdictions>[0] : undefined,
      );
      const pagination = parsePagination(query);
      await reply.send(paginateArray(items, pagination));
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/jurisdictions/:id
  app.get('/api/v1/jurisdictions/:id', {
    schema: {
      tags: ['jurisdictions'],
      summary: 'Get jurisdiction by id',
      params: JurisdictionParams,
      response: {
        200: JurisdictionDetail,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const jurisdiction = await db.getJurisdiction(id);
      if (jurisdiction == null) {
        await reply.status(404).send({ error: `Jurisdiction '${id}' not found`, statusCode: 404 });
        return;
      }
      // Count regulations
      const regulations = await db.listRegulations({ jurisdictionId: id });
      await reply.send({ ...jurisdiction, regulationsCount: regulations.length });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/jurisdictions
  app.post('/api/v1/jurisdictions', {
    schema: {
      tags: ['jurisdictions'],
      summary: 'Create jurisdiction',
      body: JurisdictionBody,
      response: {
        201: Jurisdiction,
        400: ErrorEnvelope,
        401: ErrorEnvelope,
      },
    },
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof crud.createJurisdiction>[1];
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';
      const jurisdiction = await crud.createJurisdiction(db, { ...body, orgId });
      await reply.status(201).send(jurisdiction);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // PATCH /api/v1/jurisdictions/:id
  app.patch('/api/v1/jurisdictions/:id', {
    schema: {
      tags: ['jurisdictions'],
      summary: 'Update jurisdiction',
      params: JurisdictionParams,
      body: JurisdictionBody,
      response: {
        200: Jurisdiction,
        400: ErrorEnvelope,
        403: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const requestOrgId = (request as unknown as { orgId?: string }).orgId;
      const recordOrgId = await db.getJurisdictionOrgId(id);
      if (recordOrgId === 'system' && requestOrgId !== 'system') {
        await reply.status(403).send({ error: 'Cannot modify system data', statusCode: 403 });
        return;
      }
      if (recordOrgId !== null && requestOrgId != null && recordOrgId !== 'system' && recordOrgId !== requestOrgId) {
        await reply.status(403).send({ error: 'Cannot modify data belonging to another organisation', statusCode: 403 });
        return;
      }
      const body = request.body as Partial<Parameters<typeof crud.createJurisdiction>[1]>;
      const jurisdiction = await crud.updateJurisdiction(db, id, body);
      await reply.send(jurisdiction);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      const statusCode = message.includes('not found') ? 404 : 400;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });

  // DELETE /api/v1/jurisdictions/:id
  app.delete('/api/v1/jurisdictions/:id', {
    schema: {
      tags: ['jurisdictions'],
      summary: 'Delete jurisdiction',
      params: JurisdictionParams,
      response: {
        204: Type.Null(),
        403: ErrorEnvelope,
        404: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const requestOrgId = (request as unknown as { orgId?: string }).orgId;
      const recordOrgId = await db.getJurisdictionOrgId(id);
      if (recordOrgId == null) {
        await reply.status(404).send({ error: `Jurisdiction '${id}' not found`, statusCode: 404 });
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
      await db.deleteJurisdiction(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}

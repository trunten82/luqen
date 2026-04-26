import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { LuqenResponse, ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { CAPABILITY_NAMES, type CapabilityName } from '../../types.js';

const CapabilityAssignment = Type.Object(
  {
    capability: Type.String(),
    modelId: Type.String(),
    priority: Type.Number(),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const CapabilityWithAssignments = Type.Object(
  {
    name: Type.String(),
    assignments: Type.Array(CapabilityAssignment),
  },
  { additionalProperties: true },
);

// Body fields Optional so handlers run their own per-field 400 validation.
const AssignBody = Type.Object(
  {
    modelId: Type.Optional(Type.String()),
    priority: Type.Optional(Type.Number()),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const PriorityBody = Type.Object(
  {
    priority: Type.Optional(Type.Number()),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const NameParams = Type.Object({ name: Type.String() }, { additionalProperties: true });
const NameModelParams = Type.Object(
  { name: Type.String(), modelId: Type.String() },
  { additionalProperties: true },
);
const OrgQuery = Type.Object(
  { orgId: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const PriorityUpdated = Type.Object(
  { updated: Type.Boolean(), priority: Type.Number() },
  { additionalProperties: true },
);

const StatusResponse = Type.Object(
  {
    providers: Type.Number(),
    models: Type.Number(),
    capabilities: Type.Object(
      {
        total: Type.Number(),
        covered: Type.Number(),
        coverage: Type.Number(),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
);

export async function registerCapabilityRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/capabilities — list all capabilities with assignments
  app.get('/api/v1/capabilities', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['capabilities'],
      summary: 'List capabilities with assigned models per capability',
      response: {
        200: LuqenResponse(Type.Array(CapabilityWithAssignments)),
        500: ErrorEnvelope,
      },
    },
  }, async (_request, reply) => {
    try {
      const assignments = await db.listCapabilityAssignments();
      const result = CAPABILITY_NAMES.map(name => ({
        name,
        assignments: assignments.filter(a => a.capability === name),
      }));
      await reply.send(result);
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // PUT /api/v1/capabilities/:name/assign
  app.put('/api/v1/capabilities/:name/assign', {
    preHandler: [requireScope('admin')],
    schema: {
      tags: ['capabilities'],
      summary: 'Assign a model to a capability (creates priority slot)',
      params: NameParams,
      body: AssignBody,
      response: {
        200: LuqenResponse(CapabilityAssignment),
        400: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    try {
      const { name } = request.params as { name: string };

      if (!(CAPABILITY_NAMES as readonly string[]).includes(name)) {
        await reply.status(400).send({
          error: `Invalid capability name. Valid names: ${CAPABILITY_NAMES.join(', ')}`,
          statusCode: 400,
        });
        return;
      }

      const body = request.body as Record<string, unknown>;
      if (!body.modelId) {
        await reply.status(400).send({ error: 'modelId is required', statusCode: 400 });
        return;
      }

      // Verify model exists
      const model = await db.getModel(String(body.modelId));
      if (model == null) {
        await reply.status(400).send({ error: 'Model not found', statusCode: 400 });
        return;
      }

      let priority = body.priority != null ? Number(body.priority) : 0;
      if (priority === 0) {
        const maxPri = await db.getMaxCapabilityPriority(
          name as CapabilityName,
          body.orgId != null ? String(body.orgId) : undefined,
        );
        priority = maxPri + 1;
      }

      const assignment = await db.assignCapability({
        capability: name as CapabilityName,
        modelId: String(body.modelId),
        priority,
        ...(body.orgId != null ? { orgId: String(body.orgId) } : {}),
      });

      await reply.send(assignment);
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // DELETE /api/v1/capabilities/:name/assign/:modelId
  app.delete('/api/v1/capabilities/:name/assign/:modelId', {
    preHandler: [requireScope('admin')],
    schema: {
      tags: ['capabilities'],
      summary: 'Unassign a model from a capability',
      params: NameModelParams,
      querystring: OrgQuery,
      response: {
        204: Type.Null(),
        400: ErrorEnvelope,
        404: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    try {
      const { name, modelId } = request.params as { name: string; modelId: string };
      const query = request.query as Record<string, unknown>;
      const orgId = query.orgId != null ? String(query.orgId) : undefined;

      if (!(CAPABILITY_NAMES as readonly string[]).includes(name)) {
        await reply.status(400).send({
          error: `Invalid capability name. Valid names: ${CAPABILITY_NAMES.join(', ')}`,
          statusCode: 400,
        });
        return;
      }

      const removed = await db.unassignCapability(name as CapabilityName, modelId, orgId);
      if (!removed) {
        await reply.status(404).send({ error: 'Assignment not found', statusCode: 404 });
        return;
      }
      await reply.status(204).send();
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // PATCH /api/v1/capabilities/:name/assign/:modelId — update priority
  app.patch('/api/v1/capabilities/:name/assign/:modelId', {
    preHandler: [requireScope('admin')],
    schema: {
      tags: ['capabilities'],
      summary: 'Update priority of a capability assignment',
      params: NameModelParams,
      body: PriorityBody,
      response: {
        200: LuqenResponse(PriorityUpdated),
        400: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    try {
      const { name, modelId } = request.params as { name: string; modelId: string };
      const body = request.body as Record<string, unknown>;

      if (!(CAPABILITY_NAMES as readonly string[]).includes(name)) {
        await reply.status(400).send({
          error: `Invalid capability name. Valid names: ${CAPABILITY_NAMES.join(', ')}`,
          statusCode: 400,
        });
        return;
      }

      if (body.priority === undefined || typeof body.priority !== 'number') {
        await reply.status(400).send({ error: 'priority is required', statusCode: 400 });
        return;
      }

      const assignment = await db.assignCapability({
        capability: name as CapabilityName,
        modelId,
        priority: body.priority,
        ...(body.orgId != null ? { orgId: String(body.orgId) } : {}),
      });

      await reply.send({ updated: true, priority: assignment.priority });
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/status — system overview
  app.get('/api/v1/status', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['capabilities'],
      summary: 'System overview: provider/model count, capability coverage',
      response: {
        200: LuqenResponse(StatusResponse),
        500: ErrorEnvelope,
      },
    },
  }, async (_request, reply) => {
    try {
      const [providers, models, assignments] = await Promise.all([
        db.listProviders(),
        db.listModels(),
        db.listCapabilityAssignments(),
      ]);

      const assignedCapabilities = new Set(assignments.map(a => a.capability));
      const totalCapabilities = CAPABILITY_NAMES.length;
      const coveredCapabilities = CAPABILITY_NAMES.filter(n => assignedCapabilities.has(n)).length;

      await reply.send({
        providers: providers.length,
        models: models.length,
        capabilities: {
          total: totalCapabilities,
          covered: coveredCapabilities,
          coverage: totalCapabilities > 0
            ? Math.round((coveredCapabilities / totalCapabilities) * 100)
            : 0,
        },
      });
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}

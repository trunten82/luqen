import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { CAPABILITY_NAMES, type CapabilityName } from '../../types.js';

export async function registerCapabilityRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/capabilities — list all 4 capabilities with assignments
  app.get('/api/v1/capabilities', {
    preHandler: [requireScope('read')],
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

      const assignment = await db.assignCapability({
        capability: name as CapabilityName,
        modelId: String(body.modelId),
        ...(body.priority != null ? { priority: Number(body.priority) } : {}),
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

  // GET /api/v1/status — system overview
  app.get('/api/v1/status', {
    preHandler: [requireScope('read')],
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

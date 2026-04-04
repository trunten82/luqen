import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { createAdapter } from '../../providers/registry.js';
import { executeExtractRequirements } from '../../capabilities/extract-requirements.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../../capabilities/types.js';

export async function registerCapabilityExecRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // POST /api/v1/extract-requirements
  app.post('/api/v1/extract-requirements', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    if (!body.content || typeof body.content !== 'string') {
      await reply.status(400).send({ error: 'content is required', statusCode: 400 });
      return;
    }
    if (!body.regulationId || typeof body.regulationId !== 'string') {
      await reply.status(400).send({ error: 'regulationId is required', statusCode: 400 });
      return;
    }
    if (!body.regulationName || typeof body.regulationName !== 'string') {
      await reply.status(400).send({ error: 'regulationName is required', statusCode: 400 });
      return;
    }

    const reqOrgId = (request as unknown as { orgId: string }).orgId;
    const orgId = typeof body.orgId === 'string' && body.orgId.length > 0
      ? body.orgId
      : reqOrgId;

    try {
      const capResult = await executeExtractRequirements(
        db,
        createAdapter,
        {
          content: body.content,
          regulationId: body.regulationId,
          regulationName: body.regulationName,
          ...(typeof body.jurisdictionId === 'string' ? { jurisdictionId: body.jurisdictionId } : {}),
          orgId,
        },
      );

      await reply.send({
        ...capResult.data,
        model: capResult.model,
        provider: capResult.provider,
        attempts: capResult.attempts,
      });
    } catch (err) {
      if (err instanceof CapabilityNotConfiguredError) {
        await reply.status(503).send({ error: err.message, statusCode: 503 });
        return;
      }
      if (err instanceof CapabilityExhaustedError) {
        await reply.status(504).send({ error: err.message, statusCode: 504 });
        return;
      }
      await reply.status(502).send({ error: 'Upstream LLM error', statusCode: 502 });
    }
  });
}

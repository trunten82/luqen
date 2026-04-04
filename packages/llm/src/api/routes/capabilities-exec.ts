import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { createAdapter } from '../../providers/registry.js';
import { executeExtractRequirements } from '../../capabilities/extract-requirements.js';
import { executeGenerateFix } from '../../capabilities/generate-fix.js';
import { executeAnalyseReport } from '../../capabilities/analyse-report.js';
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
        (type: string) => createAdapter(type as import('../../types.js').ProviderType),
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

  // POST /api/v1/generate-fix
  app.post('/api/v1/generate-fix', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    if (!body.wcagCriterion || typeof body.wcagCriterion !== 'string') {
      await reply.status(400).send({ error: 'wcagCriterion is required', statusCode: 400 });
      return;
    }
    if (!body.issueMessage || typeof body.issueMessage !== 'string') {
      await reply.status(400).send({ error: 'issueMessage is required', statusCode: 400 });
      return;
    }
    if (!body.htmlContext || typeof body.htmlContext !== 'string') {
      await reply.status(400).send({ error: 'htmlContext is required', statusCode: 400 });
      return;
    }

    const reqOrgId = (request as unknown as { orgId: string }).orgId;
    const orgId = typeof body.orgId === 'string' && body.orgId.length > 0
      ? body.orgId
      : reqOrgId;

    try {
      const capResult = await executeGenerateFix(
        db,
        (type: string) => createAdapter(type as import('../../types.js').ProviderType),
        {
          wcagCriterion: body.wcagCriterion,
          issueMessage: body.issueMessage,
          htmlContext: body.htmlContext,
          ...(typeof body.cssContext === 'string' ? { cssContext: body.cssContext } : {}),
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

  // POST /api/v1/analyse-report
  app.post('/api/v1/analyse-report', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    if (!body.siteUrl || typeof body.siteUrl !== 'string') {
      await reply.status(400).send({ error: 'siteUrl is required', statusCode: 400 });
      return;
    }
    if (typeof body.totalIssues !== 'number') {
      await reply.status(400).send({ error: 'totalIssues is required and must be a number', statusCode: 400 });
      return;
    }
    if (!Array.isArray(body.issuesList)) {
      await reply.status(400).send({ error: 'issuesList is required and must be an array', statusCode: 400 });
      return;
    }

    const reqOrgId = (request as unknown as { orgId: string }).orgId;
    const orgId = typeof body.orgId === 'string' && body.orgId.length > 0
      ? body.orgId
      : reqOrgId;

    try {
      const capResult = await executeAnalyseReport(
        db,
        (type: string) => createAdapter(type as import('../../types.js').ProviderType),
        {
          siteUrl: body.siteUrl,
          totalIssues: body.totalIssues as number,
          issuesList: body.issuesList as Array<{ criterion: string; message: string; count: number; level: string }>,
          complianceSummary: typeof body.complianceSummary === 'string' ? body.complianceSummary : '',
          recurringPatterns: Array.isArray(body.recurringPatterns)
            ? (body.recurringPatterns as unknown[]).filter((x): x is string => typeof x === 'string')
            : [],
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

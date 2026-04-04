import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { createAdapter } from '../../providers/registry.js';
import { executeExtractRequirements } from '../../capabilities/extract-requirements.js';
import { executeGenerateFix } from '../../capabilities/generate-fix.js';
import { executeAnalyseReport } from '../../capabilities/analyse-report.js';
import { executeDiscoverBranding } from '../../capabilities/discover-branding.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../../capabilities/types.js';

export async function registerCapabilityExecRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // POST /api/v1/extract-requirements
  app.post('/api/v1/extract-requirements', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['Capabilities'],
      summary: 'Extract requirements from a regulation document',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['content', 'regulationId', 'regulationName'],
        properties: {
          content:        { type: 'string', description: 'Full text of the regulation document' },
          regulationId:   { type: 'string', description: 'Unique identifier for the regulation (e.g. "wcag-2.2")' },
          regulationName: { type: 'string', description: 'Human-readable regulation name' },
          jurisdictionId: { type: 'string', description: 'Optional jurisdiction ID' },
          orgId:          { type: 'string', description: 'Optional organisation ID for per-org prompt overrides' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            requirements: { type: 'array', items: { type: 'object' } },
            model:        { type: 'string' },
            provider:     { type: 'string' },
            attempts:     { type: 'number' },
          },
        },
        400: { $ref: '#/components/schemas/ErrorResponse' },
        502: { $ref: '#/components/schemas/ErrorResponse' },
        503: { $ref: '#/components/schemas/ErrorResponse' },
        504: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
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
    schema: {
      tags: ['Capabilities'],
      summary: 'Generate an AI fix suggestion for a WCAG issue',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['wcagCriterion', 'issueMessage', 'htmlContext'],
        properties: {
          wcagCriterion: { type: 'string', description: 'WCAG success criterion (e.g. "1.1.1 Non-text Content")' },
          issueMessage:  { type: 'string', description: 'Accessibility issue description from the scanner' },
          htmlContext:   { type: 'string', description: 'HTML snippet containing the problematic element' },
          cssContext:    { type: 'string', description: 'Optional: relevant CSS for the element' },
          orgId:         { type: 'string', description: 'Optional organisation ID for per-org prompt overrides' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            fixedHtml:   { type: 'string' },
            explanation: { type: 'string' },
            effortLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
            model:       { type: 'string' },
            provider:    { type: 'string' },
            attempts:    { type: 'number' },
          },
        },
        400: { $ref: '#/components/schemas/ErrorResponse' },
        502: { $ref: '#/components/schemas/ErrorResponse' },
        503: { $ref: '#/components/schemas/ErrorResponse' },
        504: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
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
    schema: {
      tags: ['Capabilities'],
      summary: 'Generate an AI executive summary for a scan report',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['siteUrl', 'totalIssues', 'issuesList'],
        properties: {
          siteUrl:           { type: 'string', description: 'URL of the scanned site' },
          totalIssues:       { type: 'number', description: 'Total issue count from the scan' },
          issuesList:        {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                criterion: { type: 'string' },
                message:   { type: 'string' },
                count:     { type: 'number' },
                level:     { type: 'string' },
              },
            },
            description: 'Top issues from the scan',
          },
          complianceSummary: { type: 'string', description: 'Optional: compliance matrix summary text' },
          recurringPatterns: { type: 'array', items: { type: 'string' }, description: 'Optional: recurring criteria from prior scans' },
          orgId:             { type: 'string', description: 'Optional organisation ID for per-org prompt overrides' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            summary:      { type: 'string' },
            keyFindings:  { type: 'array', items: { type: 'string' } },
            priorities:   { type: 'array', items: { type: 'string' } },
            patterns:     { type: 'array', items: { type: 'string' } },
            model:        { type: 'string' },
            provider:     { type: 'string' },
            attempts:     { type: 'number' },
          },
        },
        400: { $ref: '#/components/schemas/ErrorResponse' },
        502: { $ref: '#/components/schemas/ErrorResponse' },
        503: { $ref: '#/components/schemas/ErrorResponse' },
        504: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
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

  // POST /api/v1/discover-branding
  app.post('/api/v1/discover-branding', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['Capabilities'],
      summary: 'Auto-detect brand colors, fonts, and logo from a URL',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url:   { type: 'string', description: 'URL to fetch and analyse for brand signals (http/https)' },
          orgId: { type: 'string', description: 'Optional organisation ID for per-org prompt overrides' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            colors:    { type: 'array', items: { type: 'string' }, description: 'Detected hex color values' },
            fonts:     { type: 'array', items: { type: 'string' }, description: 'Detected font family names' },
            logoUrl:   { type: 'string', description: 'Detected logo URL (if found)' },
            brandName: { type: 'string', description: 'Detected brand name (if found)' },
            model:     { type: 'string' },
            provider:  { type: 'string' },
            attempts:  { type: 'number' },
          },
        },
        400: { $ref: '#/components/schemas/ErrorResponse' },
        502: { $ref: '#/components/schemas/ErrorResponse' },
        503: { $ref: '#/components/schemas/ErrorResponse' },
        504: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    if (!body.url || typeof body.url !== 'string') {
      await reply.status(400).send({ error: 'url is required', statusCode: 400 });
      return;
    }
    if (!body.url.startsWith('http://') && !body.url.startsWith('https://')) {
      await reply.status(400).send({ error: 'url must be a valid http/https URL', statusCode: 400 });
      return;
    }

    const reqOrgId = (request as unknown as { orgId: string }).orgId;
    const orgId = typeof body.orgId === 'string' && body.orgId.length > 0
      ? body.orgId
      : reqOrgId;

    try {
      const capResult = await executeDiscoverBranding(
        db,
        (type: string) => createAdapter(type as import('../../types.js').ProviderType),
        { url: body.url, orgId },
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

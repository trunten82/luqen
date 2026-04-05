import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { CAPABILITY_NAMES, type CapabilityName } from '../../types.js';
import { buildExtractionPrompt } from '../../prompts/extract-requirements.js';
import { buildGenerateFixPrompt } from '../../prompts/generate-fix.js';
import { buildAnalyseReportPrompt } from '../../prompts/analyse-report.js';
import { buildDiscoverBrandingPrompt } from '../../prompts/discover-branding.js';

const EXTRACT_DEFAULT_TEMPLATE = buildExtractionPrompt(
  '{content}',
  { regulationId: '{regulationId}', regulationName: '{regulationName}' },
);

function getDefaultTemplate(capability: CapabilityName): string {
  switch (capability) {
    case 'extract-requirements':
      return EXTRACT_DEFAULT_TEMPLATE;
    case 'generate-fix':
      return buildGenerateFixPrompt({
        wcagCriterion: '{{wcagCriterion}}',
        issueMessage: '{{issueMessage}}',
        htmlContext: '{{htmlContext}}',
        cssContext: '{{cssContext}}',
      });
    case 'analyse-report':
      return buildAnalyseReportPrompt({
        siteUrl: '{{siteUrl}}',
        totalIssues: 0,
        issuesList: [],
        complianceSummary: '{{complianceSummary}}',
        recurringPatterns: [],
      });
    case 'discover-branding':
      return buildDiscoverBrandingPrompt({
        url: '{{url}}',
        htmlContent: '{{htmlContent}}',
        cssContent: '{{cssContent}}',
      });
    default:
      return `Capability: ${capability}\nContent: {content}`;
  }
}

export async function registerPromptRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/prompts — list all overrides
  app.get('/api/v1/prompts', {
    preHandler: [requireScope('read')],
  }, async (_request, reply) => {
    try {
      const overrides = await db.listPromptOverrides();
      await reply.send(overrides);
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // GET /api/v1/prompts/:capability — get override or default
  app.get('/api/v1/prompts/:capability', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    const { capability } = request.params as { capability: string };

    if (!(CAPABILITY_NAMES as readonly string[]).includes(capability)) {
      await reply.status(400).send({
        error: `Invalid capability. Valid names: ${CAPABILITY_NAMES.join(', ')}`,
        statusCode: 400,
      });
      return;
    }

    const capabilityName = capability as CapabilityName;
    const query = request.query as Record<string, unknown>;
    const orgId = typeof query.orgId === 'string' ? query.orgId : undefined;

    try {
      const override = await db.getPromptOverride(capabilityName, orgId);

      if (override != null) {
        await reply.send({
          capability: override.capability,
          orgId: override.orgId,
          template: override.template,
          isOverride: true,
          updatedAt: override.updatedAt,
        });
        return;
      }

      await reply.send({
        capability: capabilityName,
        orgId: orgId ?? 'system',
        template: getDefaultTemplate(capabilityName),
        isOverride: false,
        updatedAt: null,
      });
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // PUT /api/v1/prompts/:capability — set override
  app.put('/api/v1/prompts/:capability', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    const { capability } = request.params as { capability: string };

    if (!(CAPABILITY_NAMES as readonly string[]).includes(capability)) {
      await reply.status(400).send({
        error: `Invalid capability. Valid names: ${CAPABILITY_NAMES.join(', ')}`,
        statusCode: 400,
      });
      return;
    }

    const capabilityName = capability as CapabilityName;
    const body = request.body as Record<string, unknown>;

    if (!body.template || typeof body.template !== 'string') {
      await reply.status(400).send({ error: 'template is required', statusCode: 400 });
      return;
    }

    const orgId = typeof body.orgId === 'string' && body.orgId.length > 0
      ? body.orgId
      : undefined;

    try {
      const override = await db.setPromptOverride(capabilityName, body.template, orgId);
      await reply.send({
        capability: override.capability,
        orgId: override.orgId,
        template: override.template,
        isOverride: true,
        updatedAt: override.updatedAt,
      });
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // DELETE /api/v1/prompts/:capability — delete override
  app.delete('/api/v1/prompts/:capability', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    const { capability } = request.params as { capability: string };

    if (!(CAPABILITY_NAMES as readonly string[]).includes(capability)) {
      await reply.status(400).send({
        error: `Invalid capability. Valid names: ${CAPABILITY_NAMES.join(', ')}`,
        statusCode: 400,
      });
      return;
    }

    const capabilityName = capability as CapabilityName;
    const query = request.query as Record<string, unknown>;
    const orgId = typeof query.orgId === 'string' ? query.orgId : undefined;

    try {
      const deleted = await db.deletePromptOverride(capabilityName, orgId);
      if (!deleted) {
        await reply.status(404).send({ error: 'Prompt override not found', statusCode: 404 });
        return;
      }
      await reply.status(204).send();
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}

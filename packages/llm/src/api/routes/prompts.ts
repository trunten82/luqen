import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { LuqenResponse, ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { CAPABILITY_NAMES, type CapabilityName } from '../../types.js';

const PromptOverride = Type.Object(
  {
    capability: Type.String(),
    orgId: Type.String(),
    template: Type.String(),
    isOverride: Type.Optional(Type.Boolean()),
    updatedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    createdAt: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const SetPromptBody = Type.Object(
  {
    template: Type.Optional(Type.String()),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const CapabilityParams = Type.Object(
  { capability: Type.String() },
  { additionalProperties: true },
);

const OrgQuery = Type.Object(
  { orgId: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const PromptViolations = Type.Object(
  {
    error: Type.String(),
    statusCode: Type.Optional(Type.Number()),
    violations: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: Type.String(),
            reason: Type.String(),
            explanation: Type.Optional(Type.String()),
          },
          { additionalProperties: true },
        ),
      ),
    ),
  },
  { additionalProperties: true },
);
import { buildExtractionPrompt } from '../../prompts/extract-requirements.js';
import { buildGenerateFixPrompt } from '../../prompts/generate-fix.js';
import { buildAnalyseReportPrompt } from '../../prompts/analyse-report.js';
import { buildDiscoverBrandingPrompt } from '../../prompts/discover-branding.js';
import { buildAgentSystemPrompt } from '../../prompts/agent-system.js';
import { validateOverride, LOCKED_SECTION_EXPLANATIONS } from '../../prompts/segments.js';

// Phase 32-02: 'agent-system' is a PROMPT id that is managed by the same
// prompt routes but is NOT a CapabilityName (the capability it backs is
// 'agent-conversation'). Widen the route's accepted-ids list to include it
// without polluting CAPABILITY_NAMES (which gates other surfaces e.g.
// model capability assignment UI). Per D-14 + AI-SPEC §6.1 Guardrail 5 the
// PUT handler also rejects orgId writes for this prompt id.
const AGENT_SYSTEM_PROMPT_ID = 'agent-system' as const;
type PromptId = CapabilityName | typeof AGENT_SYSTEM_PROMPT_ID;
const VALID_PROMPT_IDS: readonly PromptId[] = [
  ...CAPABILITY_NAMES,
  AGENT_SYSTEM_PROMPT_ID,
];

function isValidPromptId(id: string): id is PromptId {
  return (VALID_PROMPT_IDS as readonly string[]).includes(id);
}

const EXTRACT_DEFAULT_TEMPLATE = buildExtractionPrompt(
  '{content}',
  { regulationId: '{regulationId}', regulationName: '{regulationName}' },
);

function getDefaultTemplate(promptId: PromptId): string {
  switch (promptId) {
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
    case 'agent-conversation':
      // agent-conversation capability has no default prompt template — the
      // prompt it consumes is 'agent-system' (see above). Return a stub so
      // prompt-browser UIs don't blow up, but this code path is not the
      // primary surface for agent prompts.
      return 'Capability: agent-conversation (see agent-system prompt for the system template)';
    case AGENT_SYSTEM_PROMPT_ID:
      return buildAgentSystemPrompt();
    default: {
      const _exhaustive: never = promptId;
      return `Prompt: ${String(_exhaustive)}`;
    }
  }
}

export async function registerPromptRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/prompts — list all overrides
  app.get('/api/v1/prompts', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['prompts'],
      summary: 'List all per-org prompt overrides',
      response: {
        200: LuqenResponse(Type.Array(PromptOverride)),
        500: ErrorEnvelope,
      },
    },
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
    schema: {
      tags: ['prompts'],
      summary: 'Get prompt template (override if set, else default)',
      params: CapabilityParams,
      querystring: OrgQuery,
      response: {
        200: LuqenResponse(PromptOverride),
        400: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    const { capability } = request.params as { capability: string };

    if (!isValidPromptId(capability)) {
      await reply.status(400).send({
        error: `Invalid capability. Valid names: ${VALID_PROMPT_IDS.join(', ')}`,
        statusCode: 400,
      });
      return;
    }

    const promptId = capability;
    const query = request.query as Record<string, unknown>;
    const orgId = typeof query.orgId === 'string' ? query.orgId : undefined;

    try {
      const override = await db.getPromptOverride(
        promptId as unknown as CapabilityName,
        orgId,
      );

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
        capability: promptId,
        orgId: orgId ?? 'system',
        template: getDefaultTemplate(promptId),
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
    schema: {
      tags: ['prompts'],
      summary: 'Set per-org prompt override (validates locked sections)',
      params: CapabilityParams,
      body: SetPromptBody,
      response: {
        200: LuqenResponse(PromptOverride),
        400: ErrorEnvelope,
        422: PromptViolations,
        500: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    const { capability } = request.params as { capability: string };

    if (!isValidPromptId(capability)) {
      await reply.status(400).send({
        error: `Invalid capability. Valid names: ${VALID_PROMPT_IDS.join(', ')}`,
        statusCode: 400,
      });
      return;
    }

    const promptId = capability;
    const body = request.body as Record<string, unknown>;

    if (!body.template || typeof body.template !== 'string') {
      await reply.status(400).send({ error: 'template is required', statusCode: 400 });
      return;
    }

    const orgId = typeof body.orgId === 'string' && body.orgId.length > 0
      ? body.orgId
      : undefined;

    // Phase 32-02 (D-14 + AI-SPEC §6.1 Guardrail 5): the `agent-system`
    // prompt has NO per-org override — prompt-injection surface. This is
    // defence-in-depth; Plan 05's UI also hides the org selector for this
    // prompt. Placed AFTER the validity check so invalid ids still report
    // the standard error.
    if (promptId === AGENT_SYSTEM_PROMPT_ID && orgId !== undefined) {
      await reply.status(400).send({
        error: 'agent-system does not support per-org overrides',
        capability: AGENT_SYSTEM_PROMPT_ID,
        statusCode: 400,
      });
      return;
    }

    // Validate that the override preserves all locked sections from the default
    const defaultTemplate = getDefaultTemplate(promptId);
    const validation = validateOverride(body.template, defaultTemplate);
    if (!validation.ok) {
      const enriched = validation.violations.map((v) => ({
        name: v.name,
        reason: v.reason,
        explanation: LOCKED_SECTION_EXPLANATIONS[v.name] ?? '',
      }));
      const firstViolation = enriched[0];
      const message = firstViolation != null
        ? `Cannot save: locked section '${firstViolation.name}' was ${firstViolation.reason}.`
        : 'Cannot save: one or more locked sections were violated.';
      return reply.status(422).send({
        error: message,
        violations: enriched,
        statusCode: 422,
      });
    }

    try {
      const override = await db.setPromptOverride(
        promptId as unknown as CapabilityName,
        body.template,
        orgId,
      );
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
    schema: {
      tags: ['prompts'],
      summary: 'Delete a per-org prompt override',
      params: CapabilityParams,
      querystring: OrgQuery,
      response: {
        204: Type.Null(),
        400: ErrorEnvelope,
        404: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    const { capability } = request.params as { capability: string };

    if (!isValidPromptId(capability)) {
      await reply.status(400).send({
        error: `Invalid capability. Valid names: ${VALID_PROMPT_IDS.join(', ')}`,
        statusCode: 400,
      });
      return;
    }

    const promptId = capability;
    const query = request.query as Record<string, unknown>;
    const orgId = typeof query.orgId === 'string' ? query.orgId : undefined;

    try {
      const deleted = await db.deletePromptOverride(
        promptId as unknown as CapabilityName,
        orgId,
      );
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

import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { LuqenResponse, ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { createAdapter } from '../../providers/registry.js';
import { executeExtractRequirements } from '../../capabilities/extract-requirements.js';
import { executeGenerateFix } from '../../capabilities/generate-fix.js';
import { executeAnalyseReport } from '../../capabilities/analyse-report.js';
import { executeDiscoverBranding } from '../../capabilities/discover-branding.js';
import { executeAgentConversation } from '../../capabilities/agent-conversation.js';
import { executeGenerateNotificationContent } from '../../capabilities/generate-notification-content.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../../capabilities/types.js';

// ----- Bodies -----

// All body fields declared Optional so handlers' own field validation runs
// (existing handlers return per-field 400 messages that tests rely on).
// Schemas still document the expected shape for OpenAPI consumers.
const ExtractRequirementsBody = Type.Object(
  {
    content: Type.Optional(Type.String()),
    regulationId: Type.Optional(Type.String()),
    regulationName: Type.Optional(Type.String()),
    jurisdictionId: Type.Optional(Type.String()),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const GenerateFixBody = Type.Object(
  {
    wcagCriterion: Type.Optional(Type.String()),
    issueMessage: Type.Optional(Type.String()),
    htmlContext: Type.Optional(Type.String()),
    cssContext: Type.Optional(Type.String()),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const AnalyseReportIssue = Type.Object(
  {
    criterion: Type.String(),
    message: Type.String(),
    count: Type.Number(),
    level: Type.String(),
  },
  { additionalProperties: true },
);

const AnalyseReportBody = Type.Object(
  {
    siteUrl: Type.Optional(Type.String()),
    // totalIssues is Any so the handler runs its own typeof-number check (test
    // sends a string and expects the handler's per-field 400 message).
    totalIssues: Type.Optional(Type.Any()),
    issuesList: Type.Optional(Type.Any()),
    complianceSummary: Type.Optional(Type.String()),
    recurringPatterns: Type.Optional(Type.Array(Type.String())),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const DiscoverBrandingBody = Type.Object(
  {
    url: Type.Optional(Type.String()),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const GenerateNotificationBody = Type.Object(
  {
    template: Type.Optional(
      Type.Object(
        {
          subject: Type.Optional(Type.String()),
          body: Type.Optional(Type.String()),
        },
        { additionalProperties: true },
      ),
    ),
    voice: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    signature: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    brandContext: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object(
          {
            name: Type.String(),
            voice: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          },
          { additionalProperties: true },
        ),
      ]),
    ),
    eventData: Type.Optional(Type.Any()),
    channel: Type.Optional(Type.String()),
    outputFormat: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const GenerateNotificationData = Type.Object(
  {
    subject: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    latencyMs: Type.Optional(Type.Number()),
    tokensIn: Type.Optional(Type.Number()),
    tokensOut: Type.Optional(Type.Number()),
    fallback: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

const AgentConversationBody = Type.Object(
  {
    orgId: Type.Optional(Type.String()),
    userId: Type.Optional(Type.String()),
    messages: Type.Optional(Type.Array(Type.Any())),
    tools: Type.Optional(Type.Array(Type.Any())),
    agentDisplayName: Type.Optional(Type.String()),
    contextHintsBlock: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// ----- Response data shapes -----

const ExtractRequirementsData = Type.Object(
  {
    requirements: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.Optional(Type.String()),
            text: Type.Optional(Type.String()),
            jurisdiction: Type.Optional(Type.String()),
          },
          { additionalProperties: true },
        ),
      ),
    ),
    // Capability handlers spread `capResult.data` which can include
    // wcagVersion / criteria / confidence etc. — all flow via
    // additionalProperties: true on the outer object.
    wcagVersion: Type.Optional(Type.String()),
    wcagLevel: Type.Optional(Type.String()),
    criteria: Type.Optional(Type.Array(Type.Any())),
    confidence: Type.Optional(Type.Number()),
    model: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    attempts: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

const GenerateFixData = Type.Object(
  {
    fixedHtml: Type.Optional(Type.String()),
    explanation: Type.Optional(Type.String()),
    effort: Type.Optional(
      Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
    ),
    source: Type.Optional(
      Type.Union([Type.Literal('llm'), Type.Literal('hardcoded'), Type.Literal('cache')]),
    ),
    model: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    attempts: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

const AnalyseReportData = Type.Object(
  {
    summary: Type.Optional(Type.String()),
    keyFindings: Type.Optional(Type.Array(Type.String())),
    priorities: Type.Optional(Type.Array(Type.String())),
    patterns: Type.Optional(Type.Array(Type.String())),
    executiveSummary: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    attempts: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

const DiscoverBrandingData = Type.Object(
  {
    colors: Type.Array(
      Type.Object(
        {
          hex: Type.String(),
          name: Type.Optional(Type.String()),
          usage: Type.Optional(Type.String()),
        },
        { additionalProperties: true },
      ),
    ),
    fonts: Type.Array(
      Type.Object(
        {
          family: Type.String(),
          weights: Type.Optional(Type.Array(Type.String())),
          usage: Type.Optional(Type.String()),
        },
        { additionalProperties: true },
      ),
    ),
    logo: Type.Optional(Type.String()),
    logoUrl: Type.Optional(Type.String()),
    brandName: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    attempts: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

export async function registerCapabilityExecRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // POST /api/v1/extract-requirements
  app.post('/api/v1/extract-requirements', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['capabilities'],
      summary: 'Extract requirements from a regulation document',
      security: [{ bearerAuth: [] }],
      body: ExtractRequirementsBody,
      response: {
        200: LuqenResponse(ExtractRequirementsData),
        400: ErrorEnvelope,
        502: ErrorEnvelope,
        503: ErrorEnvelope,
        504: ErrorEnvelope,
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
      tags: ['capabilities'],
      summary: 'Generate an AI fix suggestion for a WCAG issue',
      security: [{ bearerAuth: [] }],
      body: GenerateFixBody,
      response: {
        200: LuqenResponse(GenerateFixData),
        400: ErrorEnvelope,
        502: ErrorEnvelope,
        503: ErrorEnvelope,
        504: ErrorEnvelope,
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
    const htmlContext = typeof body.htmlContext === 'string' ? body.htmlContext : '';

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
          htmlContext,
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
      tags: ['capabilities'],
      summary: 'Generate an AI executive summary for a scan report',
      security: [{ bearerAuth: [] }],
      body: AnalyseReportBody,
      response: {
        200: LuqenResponse(AnalyseReportData),
        400: ErrorEnvelope,
        502: ErrorEnvelope,
        503: ErrorEnvelope,
        504: ErrorEnvelope,
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
      tags: ['capabilities'],
      summary: 'Auto-detect brand colors, fonts, and logo from a URL',
      security: [{ bearerAuth: [] }],
      body: DiscoverBrandingBody,
      response: {
        200: LuqenResponse(DiscoverBrandingData),
        400: ErrorEnvelope,
        502: ErrorEnvelope,
        503: ErrorEnvelope,
        504: ErrorEnvelope,
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

  // POST /api/v1/generate-notification-content — Phase 50-01
  app.post('/api/v1/generate-notification-content', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['capabilities'],
      summary: 'Rewrite a notification template using configured LLM, with deterministic fallback',
      security: [{ bearerAuth: [] }],
      body: GenerateNotificationBody,
      response: {
        200: LuqenResponse(GenerateNotificationData),
        400: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const template = body['template'] as { subject?: unknown; body?: unknown } | undefined;
    if (!template || typeof template.subject !== 'string' || typeof template.body !== 'string') {
      await reply.status(400).send({ error: 'template.subject and template.body are required strings', statusCode: 400 });
      return;
    }
    const channel = body['channel'];
    if (channel !== 'email' && channel !== 'slack' && channel !== 'teams') {
      await reply.status(400).send({ error: 'channel must be one of email|slack|teams', statusCode: 400 });
      return;
    }
    const outputFormat = body['outputFormat'];
    if (outputFormat !== 'subject' && outputFormat !== 'body' && outputFormat !== 'both') {
      await reply.status(400).send({ error: 'outputFormat must be one of subject|body|both', statusCode: 400 });
      return;
    }
    const eventData = (body['eventData'] && typeof body['eventData'] === 'object')
      ? (body['eventData'] as Record<string, unknown>)
      : {};

    const reqOrgId = (request as unknown as { orgId: string }).orgId;
    const orgId = typeof body['orgId'] === 'string' && (body['orgId'] as string).length > 0
      ? (body['orgId'] as string)
      : reqOrgId;

    const brandContextRaw = body['brandContext'];
    const brandContext = (brandContextRaw && typeof brandContextRaw === 'object')
      ? brandContextRaw as { name: string; voice?: string | null }
      : null;

    const timeoutMsRaw = body['timeoutMs'];
    const timeoutMs = typeof timeoutMsRaw === 'number' && timeoutMsRaw > 0 ? timeoutMsRaw : undefined;

    try {
      const result = await executeGenerateNotificationContent(
        db,
        (type: string) => createAdapter(type as import('../../types.js').ProviderType),
        {
          template: { subject: template.subject as string, body: template.body as string },
          voice: typeof body['voice'] === 'string' ? body['voice'] as string : null,
          signature: typeof body['signature'] === 'string' ? body['signature'] as string : null,
          brandContext,
          eventData,
          channel,
          outputFormat,
          orgId,
        },
        timeoutMs ? { timeoutMs } : undefined,
      );

      if (result === null) {
        await reply.send({ fallback: true });
        return;
      }
      await reply.send({
        subject: result.subject,
        body: result.body,
        model: result.model,
        provider: result.provider,
        latencyMs: result.latencyMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        fallback: false,
      });
    } catch (err) {
      request.log.warn({ err }, 'generate-notification-content unexpected error');
      await reply.send({ fallback: true });
    }
  });

  // POST /api/v1/capabilities/agent-conversation — SSE token-level streaming
  app.post('/api/v1/capabilities/agent-conversation', {
    preHandler: [requireScope('read')],
    schema: {
      tags: ['capabilities'],
      summary: 'Agent conversation streaming endpoint (SSE token frames)',
      description: 'Returns text/event-stream — body is documented; response is hijacked. See AgentService docs.',
      security: [{ bearerAuth: [] }],
      body: AgentConversationBody,
      response: {
        // SSE stream: each frame is JSON-encoded after `data: `. Documented
        // here as a permissive object so OpenAPI clients see the wire shape.
        200: LuqenResponse(Type.Object({}, { additionalProperties: true })),
        400: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const orgId = typeof body['orgId'] === 'string' ? body['orgId'] : '';
    const userId = typeof body['userId'] === 'string' ? body['userId'] : '';
    const messages = Array.isArray(body['messages']) ? body['messages'] : [];
    const tools = Array.isArray(body['tools']) ? body['tools'] : [];
    const agentDisplayName = typeof body['agentDisplayName'] === 'string'
      ? body['agentDisplayName']
      : 'Luqen Assistant';
    const contextHintsBlock = typeof body['contextHintsBlock'] === 'string'
      ? body['contextHintsBlock']
      : '';

    if (orgId.length === 0) {
      await reply.status(400).send({ error: 'orgId is required', statusCode: 400 });
      return;
    }
    if (userId.length === 0) {
      await reply.status(400).send({ error: 'userId is required', statusCode: 400 });
      return;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const write = (frame: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
    };

    let frameCount = 0;
    try {
      const iter = executeAgentConversation(
        db,
        (type) => createAdapter(type as import('../../types.js').ProviderType),
        {
          orgId,
          userId,
          messages: messages as Parameters<typeof executeAgentConversation>[2]['messages'],
          tools: tools as Parameters<typeof executeAgentConversation>[2]['tools'],
          agentDisplayName,
          contextHintsBlock,
        },
      );
      for await (const frame of iter) {
        frameCount++;
        const f = frame as { type?: string; code?: string; message?: string };
        request.log.info({ frameNum: frameCount, frameType: f.type, frameCode: f.code, msg: f.message?.slice?.(0, 200) }, 'agent-conversation frame');
        write(frame);
      }
      request.log.info({ frameCount, orgId, userId }, 'agent-conversation stream ended cleanly');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'upstream_error';
      request.log.error({ err, frameCount, orgId, userId }, 'agent-conversation stream error');
      if (err instanceof CapabilityNotConfiguredError) {
        write({ type: 'error', code: 'not_configured', message: err.message });
      } else if (err instanceof CapabilityExhaustedError) {
        write({ type: 'error', code: 'exhausted', message: err.message });
      } else {
        write({ type: 'error', code: 'internal', message });
      }
    } finally {
      reply.raw.end();
    }
  });
}

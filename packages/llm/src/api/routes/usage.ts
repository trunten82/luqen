import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { CAPABILITY_NAMES } from '../../types.js';
import type { LlmUsageRecord, UsageFilter } from '../../types.js';

/**
 * Phase 72-03 — read API for the llm_usage table written by the
 * capability instrumentation (72-02).
 *
 * GET /api/v1/usage — list rows. Optional filters: orgId, capability,
 * from, to, limit. Plus a small aggregate: totals (calls, tokens) over
 * the same filter set so the dashboard can render a KPI strip without
 * post-processing the row list.
 *
 * No cost calculation here — pricing decisions belong to a follow-up
 * phase. Until then the dashboard renders raw token counts.
 */

const UsageQuery = Type.Object(
  {
    orgId: Type.Optional(Type.String()),
    capability: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10_000 })),
  },
  { additionalProperties: true },
);

const UsageRow = Type.Object(
  {
    id: Type.String(),
    occurredAt: Type.String(),
    orgId: Type.Union([Type.String(), Type.Null()]),
    capability: Type.String(),
    providerId: Type.String(),
    providerType: Type.String(),
    modelId: Type.String(),
    modelName: Type.String(),
    promptTokens: Type.Number(),
    completionTokens: Type.Number(),
    totalTokens: Type.Number(),
    latencyMs: Type.Number(),
    status: Type.String(),
    errorClass: Type.Union([Type.String(), Type.Null()]),
    agentConvId: Type.Union([Type.String(), Type.Null()]),
    agentMsgId: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: true },
);

const UsageTotals = Type.Object(
  {
    callCount: Type.Number(),
    okCount: Type.Number(),
    errorCount: Type.Number(),
    promptTokens: Type.Number(),
    completionTokens: Type.Number(),
    totalTokens: Type.Number(),
    avgLatencyMs: Type.Number(),
  },
  { additionalProperties: true },
);

const UsageResponse = Type.Object(
  {
    rows: Type.Array(UsageRow),
    totals: UsageTotals,
  },
  { additionalProperties: true },
);

function computeTotals(rows: readonly LlmUsageRecord[]): {
  callCount: number;
  okCount: number;
  errorCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
} {
  const callCount = rows.length;
  const okCount = rows.filter((r) => r.status === 'ok').length;
  const errorCount = callCount - okCount;
  const promptTokens = rows.reduce((s, r) => s + r.promptTokens, 0);
  const completionTokens = rows.reduce((s, r) => s + r.completionTokens, 0);
  const totalTokens = promptTokens + completionTokens;
  const avgLatencyMs = callCount === 0
    ? 0
    : Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / callCount);
  return { callCount, okCount, errorCount, promptTokens, completionTokens, totalTokens, avgLatencyMs };
}

export async function registerUsageRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  app.get(
    '/api/v1/usage',
    {
      preHandler: [requireScope('read')],
      schema: {
        querystring: UsageQuery,
        response: {
          200: UsageResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ['usage'],
        summary: 'List LLM usage rows with aggregate totals',
      },
    },
    async (request, reply) => {
      const q = request.query as Record<string, string | number | undefined>;
      if (typeof q['capability'] === 'string'
          && !(CAPABILITY_NAMES as readonly string[]).includes(q['capability'])) {
        return reply.code(400).send({ error: 'invalid_capability', message: `unknown capability '${q['capability']}'` });
      }
      const filter: UsageFilter = {
        ...(typeof q['orgId'] === 'string' ? { orgId: q['orgId'] } : {}),
        ...(typeof q['capability'] === 'string'
          ? { capability: q['capability'] as (typeof CAPABILITY_NAMES)[number] }
          : {}),
        ...(typeof q['from'] === 'string' ? { from: q['from'] } : {}),
        ...(typeof q['to'] === 'string' ? { to: q['to'] } : {}),
        ...(typeof q['limit'] === 'number' ? { limit: q['limit'] } : {}),
      };

      const rows = await db.listUsage(filter);
      return { rows, totals: computeTotals(rows) };
    },
  );
}

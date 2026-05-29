import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { CAPABILITY_NAMES } from '../../types.js';
import type { LlmUsageRecord, UsageFilter } from '../../types.js';

/**
 * Server-side org scoping for /api/v1/usage.
 *
 * Threat: without this check, ANY caller with a valid `read`-scoped
 * token could fetch another tenant's usage by passing `?orgId=victim`,
 * because `requireScope('read')` only verifies the scope and not the
 * subject. We mirror the same rule applied across the rest of the
 * service: the token's bound orgId is the ceiling; only an admin-scoped
 * token bound to the `system` org may query across orgs.
 *
 * Returns either the orgId the caller is permitted to query (string)
 * OR `null` if the caller is a system admin and may run an
 * unfiltered query across all orgs.
 *
 * Throws a typed error so the route can return a 403.
 */
class ForbiddenOrgError extends Error {
  constructor(message: string) { super(message); this.name = 'ForbiddenOrgError'; }
}

interface TokenPayloadShape {
  readonly orgId?: string;
  readonly scopes?: ReadonlyArray<string>;
}

function resolveOrgFilter(request: FastifyRequest, requestedOrgId: string | undefined): string | null {
  const payload = (request as FastifyRequest & { tokenPayload?: TokenPayloadShape }).tokenPayload;
  const tokenOrg = payload?.orgId;
  const tokenScopes = payload?.scopes ?? [];
  const isSystemAdmin = tokenOrg === 'system' && tokenScopes.includes('admin');

  if (isSystemAdmin) {
    // System admin: trust the requested filter (may be undefined for
    // an unfiltered cross-org listing).
    return requestedOrgId ?? null;
  }

  // Non-admin: caller is permanently bound to their token's orgId.
  if (tokenOrg === undefined || tokenOrg === '') {
    throw new ForbiddenOrgError('Token has no orgId binding');
  }
  if (requestedOrgId !== undefined && requestedOrgId !== tokenOrg) {
    throw new ForbiddenOrgError(`Cannot query orgId=${requestedOrgId} — token is bound to ${tokenOrg}`);
  }
  return tokenOrg;
}

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
    inputCostUsd: Type.Union([Type.Number(), Type.Null()]),
    outputCostUsd: Type.Union([Type.Number(), Type.Null()]),
    totalCostUsd: Type.Union([Type.Number(), Type.Null()]),
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
    totalCostUsd: Type.Number(),
    rowsWithKnownPrice: Type.Number(),
    rowsWithUnknownPrice: Type.Number(),
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
  totalCostUsd: number;
  rowsWithKnownPrice: number;
  rowsWithUnknownPrice: number;
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
  // Cost rollup. Rows with NULL cost (unknown model) are excluded from
  // the sum but surfaced as a count so the dashboard can disclose
  // partial coverage.
  let totalCostUsd = 0;
  let rowsWithKnownPrice = 0;
  let rowsWithUnknownPrice = 0;
  for (const r of rows) {
    if (r.totalCostUsd === null) rowsWithUnknownPrice += 1;
    else {
      rowsWithKnownPrice += 1;
      totalCostUsd += r.totalCostUsd;
    }
  }
  return {
    callCount, okCount, errorCount,
    promptTokens, completionTokens, totalTokens,
    avgLatencyMs,
    totalCostUsd,
    rowsWithKnownPrice, rowsWithUnknownPrice,
  };
}

const ALLOWED_GROUPS: ReadonlyArray<string> = ['capability', 'model', 'provider', 'org', 'day'];

const UsageSummaryRowSchema = Type.Object(
  {
    key: Type.String(),
    callCount: Type.Number(),
    okCount: Type.Number(),
    errorCount: Type.Number(),
    promptTokens: Type.Number(),
    completionTokens: Type.Number(),
    totalTokens: Type.Number(),
    totalCostUsd: Type.Number(),
    unpricedRows: Type.Number(),
    avgLatencyMs: Type.Number(),
  },
  { additionalProperties: true },
);

const UsageSummaryResponse = Type.Object(
  {
    groupBy: Type.String(),
    rows: Type.Array(UsageSummaryRowSchema),
  },
  { additionalProperties: true },
);

const UsageSummaryQuery = Type.Object(
  {
    groupBy: Type.String(),
    orgId: Type.Optional(Type.String()),
    capability: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

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
          403: ErrorEnvelope,
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
      let scopedOrg: string | null;
      try {
        scopedOrg = resolveOrgFilter(
          request,
          typeof q['orgId'] === 'string' ? q['orgId'] : undefined,
        );
      } catch (err) {
        if (err instanceof ForbiddenOrgError) {
          return reply.code(403).send({ error: 'forbidden_org', message: err.message });
        }
        throw err;
      }
      const filter: UsageFilter = {
        ...(scopedOrg !== null ? { orgId: scopedOrg } : {}),
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

  // Phase 77 — aggregate view. Same auth + org-scoping as /usage.
  app.get(
    '/api/v1/usage/summary',
    {
      preHandler: [requireScope('read')],
      schema: {
        querystring: UsageSummaryQuery,
        response: {
          200: UsageSummaryResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ['usage'],
        summary: 'Aggregate LLM usage rows by a chosen dimension',
      },
    },
    async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const groupBy = q['groupBy'];
      if (groupBy === undefined || !ALLOWED_GROUPS.includes(groupBy)) {
        return reply.code(400).send({
          error: 'invalid_groupBy',
          message: `groupBy must be one of ${ALLOWED_GROUPS.join(', ')}`,
        });
      }
      if (typeof q['capability'] === 'string'
          && !(CAPABILITY_NAMES as readonly string[]).includes(q['capability'])) {
        return reply.code(400).send({
          error: 'invalid_capability',
          message: `unknown capability '${q['capability']}'`,
        });
      }
      let scopedOrg: string | null;
      try {
        scopedOrg = resolveOrgFilter(
          request,
          typeof q['orgId'] === 'string' ? q['orgId'] : undefined,
        );
      } catch (err) {
        if (err instanceof ForbiddenOrgError) {
          return reply.code(403).send({ error: 'forbidden_org', message: err.message });
        }
        throw err;
      }
      const filter: UsageFilter = {
        ...(scopedOrg !== null ? { orgId: scopedOrg } : {}),
        ...(typeof q['capability'] === 'string'
          ? { capability: q['capability'] as (typeof CAPABILITY_NAMES)[number] }
          : {}),
        ...(typeof q['from'] === 'string' ? { from: q['from'] } : {}),
        ...(typeof q['to'] === 'string' ? { to: q['to'] } : {}),
      };
      const rows = await db.summarizeUsage(filter, groupBy as 'capability' | 'model' | 'provider' | 'org' | 'day');
      return { groupBy, rows };
    },
  );
}

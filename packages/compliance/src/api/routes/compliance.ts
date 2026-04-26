import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { checkCompliance } from '../../engine/checker.js';
import type { ComplianceCheckRequest } from '../../types.js';
import type { ComplianceCache } from '../../cache/redis.js';
import { createHash } from 'node:crypto';

const CheckIssue = Type.Object(
  {
    code: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    selector: Type.Optional(Type.String()),
    impact: Type.Optional(Type.String()),
    ruleId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const CheckBody = Type.Object(
  {
    issues: Type.Array(CheckIssue),
    jurisdictions: Type.Optional(Type.Array(Type.String())),
    regulations: Type.Optional(Type.Array(Type.String())),
    sectors: Type.Optional(Type.Array(Type.String())),
    includeOptional: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

const CheckResponse = Type.Object({}, { additionalProperties: true });

/**
 * Stable cache key derived from the compliance check request payload and org context.
 * Uses SHA-256 so the key is fixed-length regardless of payload size.
 * orgId is included to prevent cross-org cache hits.
 *
 * Phase 07 / D-06: includes `regulations` so requests with the same jurisdictions
 * but different regulation scoping do NOT collide.
 *
 * Exported for unit-testability (tests assert key divergence directly).
 */
export function cacheKey(body: ComplianceCheckRequest, orgId: string | undefined): string {
  const stable = JSON.stringify({
    orgId: orgId ?? null,
    jurisdictions: [...(body.jurisdictions ?? [])].sort(),
    regulations: [...(body.regulations ?? [])].sort(),
    issues: [...body.issues].map((i) => ({
      code: i.code,
      type: i.type,
      selector: i.selector,
    })).sort((a, b) => a.code.localeCompare(b.code)),
    includeOptional: body.includeOptional ?? false,
    sectors: (body.sectors ?? []).slice().sort(),
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function registerComplianceRoutes(
  app: FastifyInstance,
  db: DbAdapter,
  cache?: ComplianceCache,
): Promise<void> {
  // POST /api/v1/compliance/check
  app.post('/api/v1/compliance/check', {
    schema: {
      tags: ['compliance'],
      summary: 'Check accessibility issues against jurisdictions/regulations',
      body: CheckBody,
      // Phase 41-01: response schema omitted — engine output contains
      // dynamic per-jurisdiction matrix keys + nested regulation data
      // that fast-json-stringify can't serialise from a static schema
      // without dropping fields. Tolerant default JSON.stringify.
    },
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const body = request.body as ComplianceCheckRequest;
      const orgId = (request as any).orgId as string | undefined;

      // Phase 07 / D-05a: accept jurisdictions OR regulations (at least one non-empty)
      const hasJurisdictions = Array.isArray(body.jurisdictions) && body.jurisdictions.length > 0;
      const hasRegulations = Array.isArray(body.regulations) && body.regulations.length > 0;
      if (!hasJurisdictions && !hasRegulations) {
        await reply
          .status(400)
          .send({ error: 'jurisdictions or regulations array is required', statusCode: 400 });
        return;
      }
      if (!Array.isArray(body.issues)) {
        await reply.status(400).send({ error: 'issues array is required', statusCode: 400 });
        return;
      }

      // Normalize absent jurisdictions/regulations to [] so downstream code can assume arrays.
      const normalizedBody: ComplianceCheckRequest = {
        ...body,
        jurisdictions: body.jurisdictions ?? [],
        regulations: body.regulations ?? [],
      };

      // ── Cache read ────────────────────────────────────────────────────────
      if (cache !== undefined) {
        const key = cacheKey(normalizedBody, orgId);
        const cached = await cache.getCachedCheck(key);
        if (cached !== null) {
          await reply.header('X-Cache', 'HIT').send(JSON.parse(cached));
          return;
        }

        // ── Compute result ────────────────────────────────────────────────
        const result = await checkCompliance(normalizedBody, db, orgId);

        // ── Cache write (non-blocking) ─────────────────────────────────────
        void cache.setCachedCheck(key, JSON.stringify(result), 300);

        await reply.header('X-Cache', 'MISS').send(result);
        return;
      }

      // No cache — compute directly
      const result = await checkCompliance(normalizedBody, db, orgId);
      await reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });
}

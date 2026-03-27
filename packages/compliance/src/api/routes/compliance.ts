import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { checkCompliance } from '../../engine/checker.js';
import type { ComplianceCheckRequest } from '../../types.js';
import type { ComplianceCache } from '../../cache/redis.js';
import { createHash } from 'node:crypto';

/**
 * Stable cache key derived from the compliance check request payload and org context.
 * Uses SHA-256 so the key is fixed-length regardless of payload size.
 * orgId is included to prevent cross-org cache hits.
 */
function cacheKey(body: ComplianceCheckRequest, orgId: string | undefined): string {
  const stable = JSON.stringify({
    orgId: orgId ?? null,
    jurisdictions: [...body.jurisdictions].sort(),
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
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const body = request.body as ComplianceCheckRequest;
      const orgId = (request as any).orgId as string | undefined;

      if (!Array.isArray(body.jurisdictions) || body.jurisdictions.length === 0) {
        await reply.status(400).send({ error: 'jurisdictions array is required', statusCode: 400 });
        return;
      }
      if (!Array.isArray(body.issues)) {
        await reply.status(400).send({ error: 'issues array is required', statusCode: 400 });
        return;
      }

      // ── Cache read ────────────────────────────────────────────────────────
      if (cache !== undefined) {
        const key = cacheKey(body, orgId);
        const cached = await cache.getCachedCheck(key);
        if (cached !== null) {
          await reply.header('X-Cache', 'HIT').send(JSON.parse(cached));
          return;
        }

        // ── Compute result ────────────────────────────────────────────────
        const result = await checkCompliance(body, db, orgId);

        // ── Cache write (non-blocking) ─────────────────────────────────────
        void cache.setCachedCheck(key, JSON.stringify(result), 300);

        await reply.header('X-Cache', 'MISS').send(result);
        return;
      }

      // No cache — compute directly
      const result = await checkCompliance(body, db, orgId);
      await reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });
}

/**
 * Phase 82-05 — WordPress plugin digest API.
 *
 * GET /api/v1/digest?site=…
 *   Auth: OAuth2 Bearer / API key + X-Org-Id (same chain as /api/v1/fleet).
 *   Scoped to request.user.currentOrgId → 401 when absent.
 *   Returns { digest } where each SiteDelta carries currentExposure with
 *   band/drivers/asOf (NO disclaimer — the WP plugin renders its own) and
 *   delta fields. Conservative framing (D-12): band is always the ordinal
 *   label ('lower'|'moderate'|'elevated'|'high'), never a number.
 *
 * NOTE: digestApiRoutes registration in server.ts is deferred to Plan 05 Task 2.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import { buildDigest } from '../../services/digest-service.js';

// ---------------------------------------------------------------------------
// Schemas (mirrors ExposureSchema in wp-network.ts — disclaimer field OMITTED)
// ---------------------------------------------------------------------------

const DigestQuerySchema = Type.Object(
  {
    site: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  },
  { additionalProperties: false },
);

/**
 * Per-site exposure in the digest API response.
 * Omits disclaimer (WP renders its own localised disclaimer — D-12).
 * Band is the string label, never a numeric score (D-12).
 */
const DigestExposureSchema = Type.Union([
  Type.Null(),
  Type.Object({
    band:    Type.String(),
    drivers: Type.Array(
      Type.Object({
        key:    Type.String(),
        params: Type.Record(Type.String(), Type.String()),
      }),
    ),
    asOf: Type.String(),
  }),
]);

const SiteDeltaSchema = Type.Object({
  siteUrl:          Type.String(),
  hasNewScan:       Type.Boolean(),
  errors:           Type.Integer(),
  warnings:         Type.Integer(),
  notices:          Type.Integer(),
  errorsDelta:      Type.Integer(),
  warningsDelta:    Type.Integer(),
  noticesDelta:     Type.Integer(),
  criteriaChanges:  Type.Array(
    Type.Object({
      criterion:    Type.String(),
      newFindings:  Type.Integer(),
      fixedFindings: Type.Integer(),
    }),
  ),
  currentExposure:  DigestExposureSchema,
  baselineExposure: DigestExposureSchema,
  direction:        Type.Union([
    Type.Literal('worsened'),
    Type.Literal('improved'),
    Type.Literal('unchanged'),
  ]),
});

const DigestResponseSchema = Type.Object({
  digest: Type.Object({
    orgId:       Type.String(),
    siteUrl:     Type.Union([Type.String(), Type.Null()]),
    period:      Type.Object({
      start: Type.String(),
      end:   Type.String(),
    }),
    sites:       Type.Array(SiteDeltaSchema),
    generatedAt: Type.String(),
  }),
});

const ErrorResponse = Type.Object({ error: Type.String() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AuthContext {
  readonly orgId: string;
}

function requireAuthOrSend401(
  request: FastifyRequest,
  reply: FastifyReply,
): AuthContext | null {
  const orgId = request.user?.currentOrgId;
  if (orgId == null || orgId === '') {
    reply.code(401).send({ error: 'authentication required' });
    return null;
  }
  return { orgId };
}

const rateLimitConfig = {
  rateLimit: { max: 120, timeWindow: '1 minute' },
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function digestApiRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {

  // ── GET /api/v1/digest ───────────────────────────────────────────────────
  server.get(
    '/api/v1/digest',
    {
      config: rateLimitConfig,
      schema: {
        querystring: DigestQuerySchema,
        response: {
          200: DigestResponseSchema,
          401: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { site?: string } }>, reply) => {
      const ctx = requireAuthOrSend401(request, reply);
      if (ctx === null) return;

      const { site } = request.query;

      // Latest period: last 30 days → now (baseline window for first call)
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

      const digestData = await buildDigest(
        storage,
        { orgId: ctx.orgId, siteUrl: site ?? null },
        {
          start: periodStart.toISOString(),
          end:   periodEnd.toISOString(),
        },
      );

      // Strip disclaimer from each site's currentExposure and baselineExposure
      // (the WP plugin renders its own localised disclaimer — D-12).
      const sites = digestData.sites.map((s) => ({
        siteUrl:         s.siteUrl,
        hasNewScan:      s.hasNewScan,
        errors:          s.errors,
        warnings:        s.warnings,
        notices:         s.notices,
        errorsDelta:     s.errorsDelta,
        warningsDelta:   s.warningsDelta,
        noticesDelta:    s.noticesDelta,
        criteriaChanges: s.criteriaChanges.map((c) => ({
          criterion:    c.criterion,
          newFindings:  c.newFindings,
          fixedFindings: c.fixedFindings,
        })),
        // Omit disclaimer field; keep band/drivers/asOf only (D-12)
        currentExposure: s.currentExposure !== null
          ? {
              band:    s.currentExposure.band,
              drivers: s.currentExposure.drivers.map((d) => ({ key: d.key, params: d.params })),
              asOf:    s.currentExposure.asOf,
            }
          : null,
        baselineExposure: s.baselineExposure !== null
          ? {
              band:    s.baselineExposure.band,
              drivers: s.baselineExposure.drivers.map((d) => ({ key: d.key, params: d.params })),
              asOf:    s.baselineExposure.asOf,
            }
          : null,
        direction: s.direction,
      }));

      return reply.code(200).send({
        digest: {
          orgId:       digestData.orgId,
          siteUrl:     digestData.siteUrl,
          period:      digestData.period,
          sites,
          generatedAt: digestData.generatedAt,
        },
      });
    },
  );
}

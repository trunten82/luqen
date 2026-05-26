/**
 * Phase 62.3 — Bulk fix dispatch API.
 *
 *   POST /api/v1/bulk-fixes                       body: { criterion, summary?, team_id? }
 *   GET  /api/v1/bulk-fixes/:id/candidates        query: ?skip=site_id,site_id
 *   POST /api/v1/bulk-fixes/:id/dispatch          body: { site_ids: [...] }
 *
 * Permission model: admin.org on the bulk_fix's home org (or admin.system).
 *
 * Candidate resolution: a "site" is the latest completed scan per site_url
 * across the team's effective scope (home org + every linked org via
 * team_org_links). The site is a CANDIDATE if any issue in that scan's
 * jsonReport matches the bulk_fix criterion via either
 *   - issue.wcagCriterion === criterion, OR
 *   - issue.code.startsWith(criterion) — fallback for rules whose code
 *     embeds the criterion (e.g. "WCAG2AA.Principle1.Guideline1_1...").
 *
 * The actual per-site patch is computed by the WordPress plugin's
 * Luqen_File_Patcher at dispatch time; suggested_patch_summary is a
 * human-readable placeholder here.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import { hasPermission } from '../../permissions.js';
import {
  computeBulkFixCandidates,
  type BulkFixCandidate,
} from '../../services/bulk-fix-candidates.js';

const ErrorResponse = Type.Object({ error: Type.String() });

const BulkFixSchema = Type.Object({
  id: Type.String(),
  org_id: Type.String(),
  team_id: Type.Union([Type.String(), Type.Null()]),
  created_by: Type.String(),
  criterion: Type.String(),
  summary: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  coordinated_pr_id: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
});

const CandidateSchema = Type.Object({
  site_id: Type.String(),
  site_url: Type.String(),
  last_seen_at: Type.String(),
  suggested_patch_summary: Type.String(),
});

const CandidatesResponse = Type.Object({
  candidates: Type.Array(CandidateSchema),
});

const CreateBody = Type.Object(
  {
    criterion: Type.String({ minLength: 1, maxLength: 200 }),
    summary: Type.Optional(Type.String({ maxLength: 2000 })),
    team_id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

const DispatchBody = Type.Object(
  {
    site_ids: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
      minItems: 1,
    }),
  },
  { additionalProperties: false },
);

const DispatchResponse = Type.Object({
  coordinated_pr_id: Type.String(),
});

type CreatePayload = Static<typeof CreateBody>;
type DispatchPayload = Static<typeof DispatchBody>;

async function callerOrgAdminFor(
  request: FastifyRequest,
  orgId: string,
): Promise<boolean> {
  if (hasPermission(request, 'admin.system')) return true;
  if (!hasPermission(request, 'admin.org')) return false;
  return (request.user?.currentOrgId ?? '') === orgId;
}

function audit(
  storage: StorageAdapter,
  request: FastifyRequest,
  action: string,
  resourceId: string,
  details: Record<string, unknown>,
  orgId?: string,
): Promise<void> {
  return storage.audit.log({
    actor: request.user?.username ?? request.user?.id ?? 'unknown',
    actorId: request.user?.id,
    action,
    resourceType: 'bulk_fix',
    resourceId,
    details,
    orgId: orgId ?? request.user?.currentOrgId,
    ipAddress: request.ip,
  });
}

function bulkFixToJson(bf: {
  id: string;
  orgId: string;
  teamId: string | null;
  createdBy: string;
  criterion: string;
  summary: string | null;
  status: string;
  coordinatedPrId: string | null;
  createdAt: string;
}): Static<typeof BulkFixSchema> {
  return {
    id: bf.id,
    org_id: bf.orgId,
    team_id: bf.teamId,
    created_by: bf.createdBy,
    criterion: bf.criterion,
    summary: bf.summary,
    status: bf.status,
    coordinated_pr_id: bf.coordinatedPrId,
    created_at: bf.createdAt,
  };
}

// Candidate-resolution logic moved to services/bulk-fix-candidates.ts so
// the Phase 62.4 MCP fleet tool (dashboard_queue_bulk_fix) can reuse it
// without duplicating the team-scope / criterion-match code.
type Candidate = BulkFixCandidate;

export async function bulkFixRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── POST /api/v1/bulk-fixes ─────────────────────────────────────────────
  server.post(
    '/api/v1/bulk-fixes',
    {
      schema: {
        body: CreateBody,
        response: {
          201: BulkFixSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreatePayload }>, reply) => {
      const callerOrgId = request.user?.currentOrgId ?? '';
      let orgId: string;
      let teamId: string | null = null;

      if (request.body.team_id !== undefined && request.body.team_id !== '') {
        const team = await storage.teams.getTeam(request.body.team_id);
        if (team === null) return reply.code(404).send({ error: 'team not found' });
        teamId = team.id;
        orgId = team.orgId;
      } else {
        if (callerOrgId === '') {
          return reply.code(400).send({ error: 'no current org context' });
        }
        orgId = callerOrgId;
      }

      if (!(await callerOrgAdminFor(request, orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const createdBy =
        request.user?.username ?? request.user?.id ?? 'unknown';
      const created = await storage.bulkFixes.create({
        orgId,
        teamId,
        createdBy,
        criterion: request.body.criterion,
        summary: request.body.summary,
      });

      await audit(
        storage,
        request,
        'bulk_fix.created',
        created.id,
        {
          org_id: orgId,
          team_id: teamId,
          criterion: created.criterion,
          summary: created.summary,
        },
        orgId,
      );

      return reply.code(201).send(bulkFixToJson(created));
    },
  );

  // ── GET /api/v1/bulk-fixes/:id/candidates ───────────────────────────────
  server.get(
    '/api/v1/bulk-fixes/:id/candidates',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        querystring: Type.Object({
          skip: Type.Optional(Type.String({ maxLength: 4000 })),
        }),
        response: {
          200: CandidatesResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { skip?: string };
      }>,
      reply,
    ) => {
      const bf = await storage.bulkFixes.getById(request.params.id);
      if (bf === null) {
        return reply.code(404).send({ error: 'bulk_fix not found' });
      }
      if (!(await callerOrgAdminFor(request, bf.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const skipSet = new Set(
        (request.query.skip ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );

      const all = await computeBulkFixCandidates(storage, bf);
      const kept: Candidate[] = [];
      for (const c of all) {
        if (skipSet.has(c.site_id)) {
          await audit(
            storage,
            request,
            'bulk_fix.candidate_skipped',
            bf.id,
            { org_id: bf.orgId, site_id: c.site_id, site_url: c.site_url },
            bf.orgId,
          );
          continue;
        }
        kept.push(c);
      }

      return reply.send({ candidates: kept });
    },
  );

  // ── POST /api/v1/bulk-fixes/:id/dispatch ────────────────────────────────
  server.post(
    '/api/v1/bulk-fixes/:id/dispatch',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: DispatchBody,
        response: {
          200: DispatchResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: DispatchPayload;
      }>,
      reply,
    ) => {
      const bf = await storage.bulkFixes.getById(request.params.id);
      if (bf === null) {
        return reply.code(404).send({ error: 'bulk_fix not found' });
      }
      if (!(await callerOrgAdminFor(request, bf.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const all = await computeBulkFixCandidates(storage, bf);
      const valid = new Set(all.map((c) => c.site_id));
      for (const id of request.body.site_ids) {
        if (!valid.has(id)) {
          return reply
            .code(400)
            .send({ error: `site_id not in candidate set: ${id}` });
        }
      }

      const createdBy =
        request.user?.username ?? request.user?.id ?? 'unknown';
      const cpr = await storage.coordinatedPrs.createCoordinatedPr({
        orgId: bf.orgId,
        teamId: bf.teamId,
        createdBy,
        summary: bf.summary,
        legs: request.body.site_ids.map((s) => ({ siteId: s })),
      });

      await storage.bulkFixes.markDispatched(bf.id, cpr.pr.id);

      await audit(
        storage,
        request,
        'bulk_fix.dispatched',
        bf.id,
        {
          org_id: bf.orgId,
          team_id: bf.teamId,
          coordinated_pr_id: cpr.pr.id,
          site_count: request.body.site_ids.length,
          criterion: bf.criterion,
        },
        bf.orgId,
      );

      return reply.send({ coordinated_pr_id: cpr.pr.id });
    },
  );
}

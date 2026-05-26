/**
 * Phase 62.2 — Coordinated multi-repo PRs API.
 *
 *   POST /api/v1/coordinated-prs                       body: { team_id?, summary?, sites: [{ site_id }] }
 *   GET  /api/v1/coordinated-prs/:id
 *   POST /api/v1/coordinated-prs/:id/rollback
 *   POST /api/v1/coordinated-prs/:id/legs/:legId       body: { host_pr_url?, host_pr_state?, last_error?, leg_status?, approval_status? }
 *
 * Permission model:
 *   - create: admin.org on the team's home org (or admin.system).
 *   - read / rollback / leg update: admin.org on the coordinated PR's org
 *     (or admin.system).
 *
 * The leg-update endpoint is the inbound webhook the plugin's
 * Luqen_Coordinated_Fix_Job uses to report leg progress.
 *
 * TODO (org-wide webhook aggregator): the dashboard's existing webhook
 * subsystem proxies into the compliance service (compliance-client.ts
 * listWebhooks / createWebhook); there is no dashboard-side org_webhooks
 * table to flag aggregator=1, so the audit events emitted here are NOT
 * yet fanned out to aggregator subscriptions. Next step is to either
 * (a) add an `aggregator` field to the compliance service's webhook
 * schema and have the dispatcher select aggregator subscriptions by
 * event_type prefix `coordinated_pr.*`, or (b) introduce a dashboard-side
 * org_webhooks table dedicated to fleet aggregation. See SPEC.md
 * (cross-cutting concerns / Org-wide notifications + webhooks).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import { hasPermission } from '../../permissions.js';

const ErrorResponse = Type.Object({ error: Type.String() });

const LegSchema = Type.Object({
  id: Type.String(),
  coordinated_pr_id: Type.String(),
  site_id: Type.String(),
  host_pr_url: Type.Union([Type.String(), Type.Null()]),
  host_pr_state: Type.Union([Type.String(), Type.Null()]),
  last_error: Type.Union([Type.String(), Type.Null()]),
  leg_status: Type.String(),
  approval_status: Type.String(),
});

const PrSchema = Type.Object({
  id: Type.String(),
  org_id: Type.String(),
  team_id: Type.Union([Type.String(), Type.Null()]),
  created_by: Type.String(),
  status: Type.String(),
  summary: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
});

const CreateBody = Type.Object(
  {
    team_id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    summary: Type.Optional(Type.String({ maxLength: 2000 })),
    sites: Type.Array(
      Type.Object(
        { site_id: Type.String({ minLength: 1, maxLength: 200 }) },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

const LegUpdateBody = Type.Object(
  {
    host_pr_url: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    host_pr_state: Type.Optional(Type.Union([Type.String({ maxLength: 100 }), Type.Null()])),
    last_error: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
    leg_status: Type.Optional(
      Type.Union([
        Type.Literal('queued'),
        Type.Literal('opening'),
        Type.Literal('opened'),
        Type.Literal('failed'),
        Type.Literal('rolled_back'),
      ]),
    ),
    approval_status: Type.Optional(
      Type.Union([
        Type.Literal('pending'),
        Type.Literal('approved'),
        Type.Literal('skipped'),
      ]),
    ),
  },
  { additionalProperties: false },
);

const FullResponse = Type.Object({
  pr: PrSchema,
  legs: Type.Array(LegSchema),
});

type CreatePayload = Static<typeof CreateBody>;
type LegUpdatePayload = Static<typeof LegUpdateBody>;

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
    resourceType: 'coordinated_pr',
    resourceId,
    details,
    orgId: orgId ?? request.user?.currentOrgId,
    ipAddress: request.ip,
  });
}

function prToJson(pr: {
  id: string;
  orgId: string;
  teamId: string | null;
  createdBy: string;
  status: string;
  summary: string | null;
  createdAt: string;
}): Static<typeof PrSchema> {
  return {
    id: pr.id,
    org_id: pr.orgId,
    team_id: pr.teamId,
    created_by: pr.createdBy,
    status: pr.status,
    summary: pr.summary,
    created_at: pr.createdAt,
  };
}

function legToJson(leg: {
  id: string;
  coordinatedPrId: string;
  siteId: string;
  hostPrUrl: string | null;
  hostPrState: string | null;
  lastError: string | null;
  legStatus: string;
  approvalStatus: string;
}): Static<typeof LegSchema> {
  return {
    id: leg.id,
    coordinated_pr_id: leg.coordinatedPrId,
    site_id: leg.siteId,
    host_pr_url: leg.hostPrUrl,
    host_pr_state: leg.hostPrState,
    last_error: leg.lastError,
    leg_status: leg.legStatus,
    approval_status: leg.approvalStatus,
  };
}

export async function coordinatedPrRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── POST /api/v1/coordinated-prs ────────────────────────────────────────
  server.post(
    '/api/v1/coordinated-prs',
    {
      schema: {
        body: CreateBody,
        response: {
          201: FullResponse,
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
      const result = await storage.coordinatedPrs.createCoordinatedPr({
        orgId,
        teamId,
        createdBy,
        summary: request.body.summary,
        legs: request.body.sites.map((s) => ({ siteId: s.site_id })),
      });

      await audit(
        storage,
        request,
        'coordinated_pr.created',
        result.pr.id,
        {
          org_id: orgId,
          team_id: teamId,
          site_count: result.legs.length,
          summary: request.body.summary ?? null,
        },
        orgId,
      );

      return reply.code(201).send({
        pr: prToJson(result.pr),
        legs: result.legs.map(legToJson),
      });
    },
  );

  // ── GET /api/v1/coordinated-prs/:id ─────────────────────────────────────
  server.get(
    '/api/v1/coordinated-prs/:id',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          200: FullResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const existing = await storage.coordinatedPrs.getCoordinatedPr(request.params.id);
      if (existing === null) {
        return reply.code(404).send({ error: 'coordinated PR not found' });
      }
      if (!(await callerOrgAdminFor(request, existing.pr.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return reply.send({
        pr: prToJson(existing.pr),
        legs: existing.legs.map(legToJson),
      });
    },
  );

  // ── POST /api/v1/coordinated-prs/:id/rollback ───────────────────────────
  server.post(
    '/api/v1/coordinated-prs/:id/rollback',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          200: FullResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const existing = await storage.coordinatedPrs.getCoordinatedPr(request.params.id);
      if (existing === null) {
        return reply.code(404).send({ error: 'coordinated PR not found' });
      }
      if (!(await callerOrgAdminFor(request, existing.pr.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await storage.coordinatedPrs.markRolledBack(existing.pr.id);
      await audit(
        storage,
        request,
        'coordinated_pr.rolled_back',
        existing.pr.id,
        { org_id: existing.pr.orgId },
        existing.pr.orgId,
      );
      const after = await storage.coordinatedPrs.getCoordinatedPr(existing.pr.id);
      if (after === null) {
        return reply.code(404).send({ error: 'coordinated PR not found' });
      }
      return reply.send({
        pr: prToJson(after.pr),
        legs: after.legs.map(legToJson),
      });
    },
  );

  // ── POST /api/v1/coordinated-prs/:id/legs/:legId ────────────────────────
  server.post(
    '/api/v1/coordinated-prs/:id/legs/:legId',
    {
      schema: {
        params: Type.Object({ id: Type.String(), legId: Type.String() }),
        body: LegUpdateBody,
        response: {
          200: FullResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string; legId: string };
        Body: LegUpdatePayload;
      }>,
      reply,
    ) => {
      const existing = await storage.coordinatedPrs.getCoordinatedPr(request.params.id);
      if (existing === null) {
        return reply.code(404).send({ error: 'coordinated PR not found' });
      }
      if (!(await callerOrgAdminFor(request, existing.pr.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const targetLeg = existing.legs.find((l) => l.id === request.params.legId);
      if (targetLeg === undefined) {
        return reply.code(404).send({ error: 'leg not found' });
      }

      const updated = await storage.coordinatedPrs.updateLeg(request.params.legId, {
        hostPrUrl: request.body.host_pr_url,
        hostPrState: request.body.host_pr_state,
        lastError: request.body.last_error,
        legStatus: request.body.leg_status,
        approvalStatus: request.body.approval_status,
      });
      if (updated === null) {
        return reply.code(404).send({ error: 'leg not found' });
      }

      // Emit audit on transition to 'opened'.
      if (
        request.body.leg_status === 'opened' &&
        targetLeg.legStatus !== 'opened'
      ) {
        await audit(
          storage,
          request,
          'coordinated_pr.leg.opened',
          existing.pr.id,
          {
            org_id: existing.pr.orgId,
            leg_id: updated.id,
            site_id: updated.siteId,
            host_pr_url: updated.hostPrUrl,
          },
          existing.pr.orgId,
        );
      }

      await storage.coordinatedPrs.recomputeStatus(existing.pr.id);

      const after = await storage.coordinatedPrs.getCoordinatedPr(existing.pr.id);
      if (after === null) {
        return reply.code(404).send({ error: 'coordinated PR not found' });
      }
      return reply.send({
        pr: prToJson(after.pr),
        legs: after.legs.map(legToJson),
      });
    },
  );
}

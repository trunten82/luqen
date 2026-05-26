/**
 * Phase 62.2 — Coordinated multi-repo PRs API.
 *
 *   POST /api/v1/coordinated-prs                       body: { team_id?, summary?, sites: [{ site_id }] }
 *   GET  /api/v1/coordinated-prs/:id
 *   POST /api/v1/coordinated-prs/:id/rollback
 *   POST /api/v1/coordinated-prs/:id/legs/:legId       body: { host_pr_url?, host_pr_state?, last_error?, leg_status?, approval_status? }
 *   GET  /api/v1/coordinated-prs/legs?site_url=&approval_status=pending
 *   POST /api/v1/coordinated-prs/:id/legs/:legId/delegate  body: { user_id }
 *
 * Permission model:
 *   - create: admin.org on the team's home org (or admin.system).
 *   - read / rollback / leg update: admin.org on the coordinated PR's org
 *     (or admin.system).
 *   - pending-legs query: admin.org filters to orgs the caller is admin of;
 *     admin.system sees everything.
 *   - delegate: admin.org on the leg's PR org OR the current delegated_to /
 *     assignee user.
 *
 * The leg-update endpoint is the inbound webhook the plugin's
 * Luqen_Coordinated_Fix_Job uses to report leg progress.
 *
 * Phase 63.1: every audited event is also fanned out to the dashboard's
 * org_aggregator_webhooks subscriptions via deliverAggregatorEvent().
 * Delivery is fire-and-forget — failures never block the audit log.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import { hasPermission } from '../../permissions.js';
import {
  deliverAggregatorEvent,
  type AggregatorEventType,
} from '../../services/aggregator-webhook-delivery.js';

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
  delegated_to: Type.Union([Type.String(), Type.Null()]),
  delegated_by: Type.Union([Type.String(), Type.Null()]),
});

const PendingLegSchema = Type.Object({
  id: Type.String(),
  coordinated_pr_id: Type.String(),
  site_id: Type.String(),
  site_url: Type.Union([Type.String(), Type.Null()]),
  org_id: Type.String(),
  approval_status: Type.String(),
  leg_status: Type.String(),
  delegated_to: Type.Union([Type.String(), Type.Null()]),
});

const PendingLegsResponse = Type.Object({
  legs: Type.Array(PendingLegSchema),
});

const DelegateBody = Type.Object(
  { user_id: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

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
  delegatedTo: string | null;
  delegatedBy: string | null;
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
    delegated_to: leg.delegatedTo,
    delegated_by: leg.delegatedBy,
  };
}

async function fanout(
  storage: StorageAdapter,
  server: FastifyInstance,
  orgId: string,
  eventType: AggregatorEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await deliverAggregatorEvent(storage, orgId, eventType, payload, server.log);
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

      const createdDetails = {
        org_id: orgId,
        team_id: teamId,
        site_count: result.legs.length,
        summary: request.body.summary ?? null,
      };
      await audit(
        storage,
        request,
        'coordinated_pr.created',
        result.pr.id,
        createdDetails,
        orgId,
      );
      await fanout(storage, server, orgId, 'coordinated_pr.created', {
        coordinated_pr_id: result.pr.id,
        ...createdDetails,
      });

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
      await fanout(
        storage,
        server,
        existing.pr.orgId,
        'coordinated_pr.rolled_back',
        { coordinated_pr_id: existing.pr.id, org_id: existing.pr.orgId },
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
        const openedDetails = {
          org_id: existing.pr.orgId,
          leg_id: updated.id,
          site_id: updated.siteId,
          host_pr_url: updated.hostPrUrl,
        };
        await audit(
          storage,
          request,
          'coordinated_pr.leg.opened',
          existing.pr.id,
          openedDetails,
          existing.pr.orgId,
        );
        await fanout(
          storage,
          server,
          existing.pr.orgId,
          'coordinated_pr.leg.opened',
          { coordinated_pr_id: existing.pr.id, ...openedDetails },
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

  // ── GET /api/v1/coordinated-prs/legs ────────────────────────────────────
  // Phase 63.1 — per-site pending-legs lookup for the WordPress plugin's
  // approval banner. admin.org callers see only legs belonging to PRs in an
  // org they admin; admin.system sees everything.
  server.get(
    '/api/v1/coordinated-prs/legs',
    {
      schema: {
        querystring: Type.Object({
          site_url: Type.String({ minLength: 1, maxLength: 2000 }),
          approval_status: Type.Optional(Type.Literal('pending')),
        }),
        response: {
          200: PendingLegsResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: { site_url: string; approval_status?: 'pending' };
      }>,
      reply,
    ) => {
      const isSystemAdmin = hasPermission(request, 'admin.system');
      const isOrgAdmin = hasPermission(request, 'admin.org');
      if (!isSystemAdmin && !isOrgAdmin) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const orgScope = isSystemAdmin
        ? undefined
        : (request.user?.currentOrgId ?? '');
      // admin.org without a currentOrgId can't see anything.
      if (orgScope === '') {
        return reply.send({ legs: [] });
      }
      const legs = await storage.coordinatedPrs.listPendingLegs({
        siteUrl: request.query.site_url,
        orgId: orgScope,
      });
      return reply.send({
        legs: legs.map((l) => ({
          id: l.id,
          coordinated_pr_id: l.coordinatedPrId,
          site_id: l.siteId,
          site_url: l.siteUrl,
          org_id: l.orgId,
          approval_status: l.approvalStatus,
          leg_status: l.legStatus,
          delegated_to: l.delegatedTo,
        })),
      });
    },
  );

  // ── POST /api/v1/coordinated-prs/:id/legs/:legId/delegate ───────────────
  // Phase 63.1 — reassign a leg to a different user. Permitted to admin.org
  // on the leg's PR org, admin.system, or the current delegated_to user.
  server.post(
    '/api/v1/coordinated-prs/:id/legs/:legId/delegate',
    {
      schema: {
        params: Type.Object({ id: Type.String(), legId: Type.String() }),
        body: DelegateBody,
        response: {
          200: FullResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string; legId: string };
        Body: Static<typeof DelegateBody>;
      }>,
      reply,
    ) => {
      const existing = await storage.coordinatedPrs.getCoordinatedPr(
        request.params.id,
      );
      if (existing === null) {
        return reply.code(404).send({ error: 'coordinated PR not found' });
      }
      const targetLeg = existing.legs.find((l) => l.id === request.params.legId);
      if (targetLeg === undefined) {
        return reply.code(404).send({ error: 'leg not found' });
      }

      const callerId = request.user?.id ?? '';
      const isOrgAdmin = await callerOrgAdminFor(request, existing.pr.orgId);
      const isCurrentAssignee =
        targetLeg.delegatedTo !== null && targetLeg.delegatedTo === callerId;
      if (!isOrgAdmin && !isCurrentAssignee) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const targetUser = await storage.users.getUserById(request.body.user_id);
      if (targetUser === null) {
        return reply.code(404).send({ error: 'target user not found' });
      }

      const decidedBy =
        request.user?.username ?? request.user?.id ?? 'unknown';
      const updated = await storage.coordinatedPrs.delegateLeg(
        targetLeg.id,
        request.body.user_id,
        decidedBy,
      );
      if (!updated) {
        return reply.code(404).send({ error: 'leg not found' });
      }

      const delegatedDetails = {
        org_id: existing.pr.orgId,
        leg_id: targetLeg.id,
        site_id: targetLeg.siteId,
        to_user_id: request.body.user_id,
        from_user_id: targetLeg.delegatedTo,
      };
      await audit(
        storage,
        request,
        'coordinated_pr.leg.delegated',
        existing.pr.id,
        delegatedDetails,
        existing.pr.orgId,
      );
      await fanout(
        storage,
        server,
        existing.pr.orgId,
        'coordinated_pr.leg.delegated',
        { coordinated_pr_id: existing.pr.id, ...delegatedDetails },
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
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import {
  listUpdateProposals,
  approveProposal,
  rejectProposal,
  acknowledgeProposal,
  reviewProposal,
  dismissProposal,
} from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

// Phase 41.1-03 — local TypeBox shapes.
const ProposalListQuery = Type.Object(
  {
    status: Type.Optional(Type.String()),
    tab: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const ProposalActionBody = Type.Object(
  { notes: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const BulkActionBody = Type.Object(
  {
    ids: Type.Optional(Type.Array(Type.String())),
    action: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const BulkActionResult = Type.Object(
  {
    succeeded: Type.Array(Type.String()),
    failed: Type.Array(Type.String()),
  },
  { additionalProperties: true },
);

const ProposalIdParams = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

const HtmlPartialResponse = {
  produces: ['text/html'],
  response: {
    200: Type.String(),
    400: ErrorEnvelope,
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    404: ErrorEnvelope,
    500: ErrorEnvelope,
  },
} as const;

export async function proposalRoutes(
  server: FastifyInstance,
  baseUrl: string,
  storage: StorageAdapter,
): Promise<void> {
  // GET /admin/proposals — tabbed view: regulatory updates vs custom proposals
  server.get(
    '/admin/proposals',
    {
      preHandler: requirePermission('admin.system', 'compliance.view'),
      schema: { ...HtmlPageSchema, querystring: ProposalListQuery },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { status?: string; tab?: string };
      const tab = query.tab === 'custom' ? 'custom' : 'updates';
      const statusFilter = query.status;

      let officialProposals: Awaited<ReturnType<typeof listUpdateProposals>> = [];
      let customProposals: Awaited<ReturnType<typeof listUpdateProposals>> = [];
      let error: string | undefined;

      try {
        const allProposals = await listUpdateProposals(baseUrl, getToken(request), statusFilter, getOrgId(request));
        officialProposals = allProposals.filter((p) => !p.orgId || p.orgId === 'system');
        customProposals = allProposals.filter((p) => p.orgId && p.orgId !== 'system');
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load proposals';
      }

      const formatDiffItem = (item: unknown): string => {
        if (typeof item === 'string') return item;
        const obj = item as Record<string, unknown>;
        if (obj.wcagCriterion) {
          return `${obj.wcagCriterion} — ${obj.obligation ?? 'mandatory'}${obj.notes ? ` (${obj.notes})` : ''}`;
        }
        if (obj.wcagCriterion === undefined && obj.oldObligation) {
          return `${obj.wcagCriterion ?? '?'}: ${obj.oldObligation} → ${obj.newObligation}`;
        }
        return JSON.stringify(item);
      };

      const formatProposal = (p: (typeof officialProposals)[0]) => {
        const diff = p.proposedChanges?.after?.diff;
        const hasDiff = diff != null && (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0);
        return {
          ...p,
          detectedAtDisplay: new Date(p.detectedAt).toLocaleString('en-GB'),
          isPending: p.status === 'pending',
          isAcknowledged: p.status === 'acknowledged',
          isReviewed: p.status === 'reviewed',
          isDismissed: p.status === 'dismissed',
          isCertified: p.trustLevel === 'certified',
          isExtracted: p.trustLevel === 'extracted',
          hasDiff,
          diffAdded: (diff?.added ?? []).map(formatDiffItem),
          diffRemoved: (diff?.removed ?? []).map(formatDiffItem),
          diffModified: (diff?.modified ?? []).map(formatDiffItem),
        };
      };

      const officialFormatted = officialProposals.map(formatProposal);
      const customFormatted = customProposals.map(formatProposal);
      const officialPending = officialFormatted.filter((p) => p.isPending);
      const officialResolved = officialFormatted.filter((p) => !p.isPending);
      const customPending = customFormatted.filter((p) => p.isPending);
      const customResolved = customFormatted.filter((p) => !p.isPending);

      return reply.view('admin/proposals.hbs', {
        pageTitle: tab === 'updates' ? 'Regulatory Updates' : 'Custom Proposals',
        currentPath: '/admin/proposals',
        user: request.user,
        tab,
        officialPending,
        officialResolved,
        customPending,
        customResolved,
        officialResolvedCount: officialResolved.length,
        customResolvedCount: customResolved.length,
        officialCount: officialPending.length,
        customCount: customPending.length,
        statusFilter: statusFilter ?? '',
        error,
      });
    },
  );

  // POST /admin/proposals/:id/acknowledge — acknowledge official regulatory change
  server.post(
    '/admin/proposals/:id/acknowledge',
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: { params: ProposalIdParams, body: ProposalActionBody, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { notes?: string };

      try {
        await acknowledgeProposal(baseUrl, getToken(request), id, body.notes, getOrgId(request));

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'proposal.acknowledge',
          resourceType: 'update_proposal',
          resourceId: id,
          details: { notes: body.notes },
          ipAddress: request.ip,
          orgId: getOrgId(request),
        });

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Regulatory change acknowledged — data updated.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to acknowledge';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/proposals/:id/review — review and apply custom proposal
  server.post(
    '/admin/proposals/:id/review',
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: { params: ProposalIdParams, body: ProposalActionBody, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { notes?: string };

      try {
        await reviewProposal(baseUrl, getToken(request), id, body.notes, getOrgId(request));

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'proposal.review',
          resourceType: 'update_proposal',
          resourceId: id,
          details: { notes: body.notes },
          ipAddress: request.ip,
          orgId: getOrgId(request),
        });

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Proposal reviewed — regulatory data updated.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to review proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/proposals/:id/dismiss — dismiss custom proposal without applying
  server.post(
    '/admin/proposals/:id/dismiss',
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: { params: ProposalIdParams, body: ProposalActionBody, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { notes?: string };

      try {
        await dismissProposal(baseUrl, getToken(request), id, body.notes, getOrgId(request));

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'proposal.dismiss',
          resourceType: 'update_proposal',
          resourceId: id,
          details: { notes: body.notes },
          ipAddress: request.ip,
          orgId: getOrgId(request),
        });

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Proposal dismissed.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to dismiss proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/proposals/bulk-action — bulk acknowledge/review/dismiss
  server.post(
    '/admin/proposals/bulk-action',
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: {
        body: BulkActionBody,
        response: {
          200: BulkActionResult,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          500: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { ids?: string[]; action?: string; notes?: string };
      const ids = body.ids ?? [];
      const action = body.action;
      const notes = body.notes;

      if (!Array.isArray(ids) || ids.length === 0 || !action) {
        return reply.code(400).send({ error: 'ids and action required' });
      }

      const actionFn = action === 'acknowledge' ? acknowledgeProposal
        : action === 'review' ? reviewProposal
        : action === 'dismiss' ? dismissProposal
        : null;

      if (actionFn == null) {
        return reply.code(400).send({ error: `Unknown action: ${action}` });
      }

      const succeeded: string[] = [];
      const failed: string[] = [];

      await Promise.all(ids.map(async (id) => {
        try {
          await actionFn(baseUrl, getToken(request), id, notes, getOrgId(request));
          void storage.audit.log({
            actor: request.user?.username ?? 'unknown',
            actorId: request.user?.id,
            action: `proposal.${action}`,
            resourceType: 'update_proposal',
            resourceId: id,
            details: { notes, bulk: true },
            ipAddress: request.ip,
            orgId: getOrgId(request),
          });
          succeeded.push(id);
        } catch {
          failed.push(id);
        }
      }));

      return reply.send({ succeeded, failed });
    },
  );

  // Legacy aliases — keep /approve and /reject working
  server.post(
    '/admin/proposals/:id/approve',
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: { params: ProposalIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        await approveProposal(baseUrl, getToken(request), id, getOrgId(request));
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Proposal approved — regulatory data updated.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to approve proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  server.post(
    '/admin/proposals/:id/reject',
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: { params: ProposalIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        await rejectProposal(baseUrl, getToken(request), id, getOrgId(request));
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Proposal dismissed.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reject proposal';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}

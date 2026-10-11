/**
 * Phase 87 — Issue dismissal ("Mark as false positive") API (FP-01..04, FP-17).
 *
 *   POST /api/v1/scans/:scanId/dismissals      body: { code, selector, reason }
 *   POST /api/v1/dismissals/:id/revoke         body: { comment? }
 *   GET  /api/v1/scans/:scanId/dismissals      active + revoked, with history
 *
 * The API is keyed by SCAN (D-01): the org and the site URL come from the scan
 * record, never from the client; revoke takes the org from the dismissal row.
 * Mark and revoke require `issues.dismiss`, a DARK permission (D-07): only
 * global admins hold it until Phase 89. List requires `reports.view`.
 *
 * Scan access differs from the shared guard (`!bypassesOrgScope && orgId !==
 * scan.orgId && scan.orgId !== 'system'`) in ONE deliberate way: org users get
 * no 'system'-org exception. A dismissal on a 'system' scan would be stored
 * under org 'system', which is a write into another tenant. The global-admin
 * half is the shared `bypassesOrgScope` (PR #102) — never an org-scoped key.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import type { IssueDismissalRepository } from '../../db/interfaces/issue-dismissal-repository.js';
import { requirePermission } from '../../auth/middleware.js';
import { bypassesOrgScope } from '../../permissions.js';
import { toSiteKey } from '../../services/issue-dismissals/site-key.js';
import { applyDismissals } from '../../services/issue-dismissals/apply-dismissals.js';
import { loadReportForScan } from '../../services/issue-dismissals/load-dismissed-report.js';
import { recomputeSiteCounts } from '../../services/issue-dismissals/recompute-site-counts.js';
import {
  validateMarkInput,
  validateRevokeComment,
} from '../../services/issue-dismissals/validate-input.js';
import {
  ErrorResponse,
  ConflictResponse,
  DismissalSchema,
  DismissalMutationResponse,
  ListResponse,
  MarkBody,
  RevokeBody,
  ScanParams,
  IdParams,
  RATE_LIMIT,
  dismissalToJson,
  mutationToJson,
  eventToJson,
  type MarkPayload,
  type RevokePayload,
} from './issue-dismissals-schemas.js';

const NOT_SUPPORTED = 'Dismissals are not supported by this storage adapter';

/** May this caller touch data that belongs to `orgId`? (D-10 at the API.) */
function mayTouchOrg(request: FastifyRequest, orgId: string): boolean {
  if (bypassesOrgScope(request.user)) return true;
  const current = request.user?.currentOrgId ?? '';
  return current !== '' && current === orgId;
}

function actorOf(request: FastifyRequest): { actor: string; actorId?: string } {
  const user = request.user;
  return {
    actor: user?.username ?? user?.id ?? 'unknown',
    ...(user?.id !== undefined ? { actorId: user.id } : {}),
  };
}

export async function issueDismissalRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  const repo = (): IssueDismissalRepository | undefined => storage.issueDismissals;

  // ── POST /api/v1/scans/:scanId/dismissals ───────────────────────────────
  server.post(
    '/api/v1/scans/:scanId/dismissals',
    {
      preHandler: requirePermission('issues.dismiss'),
      config: RATE_LIMIT,
      schema: {
        tags: ['issue-dismissals'],
        params: ScanParams,
        body: MarkBody,
        response: {
          201: DismissalMutationResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ConflictResponse,
          422: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: { scanId: string }; Body: MarkPayload }>, reply) => {
      const dismissals = repo();
      if (dismissals === undefined) return reply.code(503).send({ error: NOT_SUPPORTED });

      const scan = await storage.scans.getScan(request.params.scanId);
      if (scan === null || !mayTouchOrg(request, scan.orgId)) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const input = validateMarkInput(request.body);
      if (!input.ok) return reply.code(400).send({ error: input.error });

      if (scan.status !== 'completed') {
        return reply.code(422).send({ error: 'Scan has no completed report' });
      }
      const loaded = await loadReportForScan(storage, scan);
      if (loaded.kind !== 'ok') {
        // D-21/IN-03: scan id and error NAME only; parser and fs messages quote their input.
        request.log.warn(
          { scanId: scan.id, errorName: loaded.kind === 'error' ? loaded.errorName : 'NoReport' },
          'Dismissal mark: report not readable',
        );
        return reply.code(422).send({ error: 'Report data not available' });
      }
      const report = loaded.report;

      const siteKey = toSiteKey(scan.siteUrl);
      const probe = applyDismissals(
        report,
        [{ id: 'probe', code: input.value.code, selector: input.value.selector, siteKey }],
        siteKey,
      );
      if (probe.dismissed.length === 0) {
        return reply.code(422).send({ error: 'No finding with this rule code and selector in this scan' });
      }

      const result = await dismissals.mark({
        orgId: scan.orgId,
        siteUrl: scan.siteUrl,
        siteKey,
        code: input.value.code,
        selector: input.value.selector,
        reason: input.value.reason,
        ...actorOf(request),
        ipAddress: request.ip,
      });
      if (result.kind === 'conflict') {
        return reply.code(409).send({
          error: 'This finding is already dismissed for this site',
          existing_id: result.existing.id,
        });
      }
      const recomputed = await recomputeSiteCounts(storage, scan.orgId, siteKey, request.log);
      return reply.code(201).send(mutationToJson(result.dismissal, recomputed));
    },
  );

  // ── POST /api/v1/dismissals/:id/revoke ──────────────────────────────────
  server.post(
    '/api/v1/dismissals/:id/revoke',
    {
      preHandler: requirePermission('issues.dismiss'),
      config: RATE_LIMIT,
      schema: {
        tags: ['issue-dismissals'],
        params: IdParams,
        body: RevokeBody,
        response: {
          200: DismissalSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: RevokePayload }>, reply) => {
      const dismissals = repo();
      if (dismissals === undefined) return reply.code(503).send({ error: NOT_SUPPORTED });

      const existing = await dismissals.getById(request.params.id);
      if (existing === null || !mayTouchOrg(request, existing.orgId)) {
        return reply.code(404).send({ error: 'Dismissal not found' });
      }

      const comment = validateRevokeComment(request.body?.comment);
      if (!comment.ok) return reply.code(400).send({ error: comment.error });

      const result = await dismissals.revoke({
        id: existing.id,
        orgId: existing.orgId,
        comment: comment.value,
        ...actorOf(request),
        ipAddress: request.ip,
      });
      if (result.kind === 'already-revoked') {
        return reply.code(409).send({ error: 'This dismissal is already revoked' });
      }
      if (result.kind === 'not-found') return reply.code(404).send({ error: 'Dismissal not found' });
      return reply.code(200).send(dismissalToJson(result.dismissal));
    },
  );

  // ── GET /api/v1/scans/:scanId/dismissals ────────────────────────────────
  server.get(
    '/api/v1/scans/:scanId/dismissals',
    {
      preHandler: requirePermission('reports.view'),
      schema: {
        tags: ['issue-dismissals'],
        params: ScanParams,
        response: {
          200: ListResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: { scanId: string } }>, reply) => {
      const dismissals = repo();
      if (dismissals === undefined) return reply.code(503).send({ error: NOT_SUPPORTED });

      const scan = await storage.scans.getScan(request.params.scanId);
      if (scan === null || !mayTouchOrg(request, scan.orgId)) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const records = await dismissals.listForSite(scan.orgId, toSiteKey(scan.siteUrl));
      const withEvents = await Promise.all(
        records.map(async (record) => ({
          ...dismissalToJson(record),
          events: (await dismissals.listEvents(record.id)).map(eventToJson),
        })),
      );
      return reply.code(200).send({ dismissals: withEvents });
    },
  );
}

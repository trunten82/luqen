/**
 * Phase 87 — Issue dismissal ("Mark as false positive") API (FP-01..04, FP-17).
 *
 *   POST /api/v1/scans/:scanId/dismissals              body: { code, selector, reason }
 *   POST /api/v1/dismissals/:id/revoke                 body: { comment? }
 *   GET  /api/v1/scans/:scanId/dismissals              active + revoked, with history
 *   GET  /api/v1/scans/:scanId/dismissals/preview      ?code=&selector= (Phase 89, read-only)
 *
 * The API is keyed by SCAN (D-01): the org and the site URL come from the scan
 * record, never from the client; revoke takes the org from the dismissal row.
 * Mark, revoke and preview require `issues.dismiss` AND `reports.view` (all-of, HARD-03); list
 * requires `reports.view`.
 *
 * The WRITE side (mark, revoke, preview) gates on `mayTouchDismissalOrg`; the READ side (list)
 * follows the report page's predicate `mayViewScanReport` (HARD-11), so the list returns the rows
 * the page's Dismissed section shows, and withholds from a viewer who may not touch the scan's org
 * what the page withholds. Both predicates live in services/issue-dismissals/scan-access.ts.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import type {
  DismissalKeySnapshot,
  IssueDismissalRepository,
} from '../../db/interfaces/issue-dismissal-repository.js';
import { requirePermission } from '../../auth/middleware.js';
import { mayTouchDismissalOrg, mayViewScanReport } from '../../services/issue-dismissals/scan-access.js';
import { toSiteKey } from '../../services/issue-dismissals/site-key.js';
import { applyDismissals } from '../../services/issue-dismissals/apply-dismissals.js';
import { loadReportForScan } from '../../services/issue-dismissals/load-dismissed-report.js';
import {
  recomputeSiteCounts,
  type RecomputeResult,
} from '../../services/issue-dismissals/recompute-site-counts.js';
import {
  dismissalRefusalReason,
  validateDismissalCode,
  validateMarkInput,
  validateRevokeComment,
} from '../../services/issue-dismissals/validate-input.js';
import {
  ErrorResponse,
  ConflictResponse,
  DismissalMutationResponse,
  ListResponse,
  MarkBody,
  PreviewQuery,
  PreviewResponse,
  RevokeBody,
  ScanParams,
  IdParams,
  RATE_LIMIT,
  MUTATION_CONFIG,
  dismissalToJson,
  mutationToJson,
  eventToJson,
  type MarkPayload,
  type PreviewQueryPayload,
  type RevokePayload,
} from './issue-dismissals-schemas.js';
import { redactDismissalJson } from './issue-dismissals-redaction.js';
import { itemsForViewer, requestMayViewTechnicalDetails } from '../../services/technical-details.js';

const NOT_SUPPORTED = 'Dismissals are not supported by this storage adapter';

/**
 * Recompute the site's stored counts and log ONE summary line (D-13 / I1): how many scans and how
 * long, with no identifiers. The first real mark's line is the measurement of the synchronous bound.
 */
async function recomputeAndLog(
  request: FastifyRequest,
  storage: StorageAdapter,
  orgId: string,
  siteKey: string,
): Promise<RecomputeResult> {
  const result = await recomputeSiteCounts(storage, orgId, siteKey, request.log);
  request.log.info(
    {
      scanCount: result.recomputedScans + result.failedScans,
      recomputedScans: result.recomputedScans,
      failedScans: result.failedScans,
      durationMs: result.durationMs,
    },
    'Dismissal recompute finished',
  );
  return result;
}

/**
 * Who is acting (D-12 / IN-02). A password user is recorded as before. An API key authenticates as
 * the shared user id 'api-key', which would make every key's dismissals one anonymous actor in an
 * append-only history, so a key is recorded as `api-key:<api_keys row id>` (never the secret); a
 * /login session opened before the key id was stored records `api-key:session`.
 */
function actorOf(request: FastifyRequest): { actor: string; actorId?: string } {
  const user = request.user;
  if (user?.id === 'api-key') {
    const named = `api-key:${user.apiKeyId ?? 'session'}`;
    return { actor: named, actorId: named };
  }
  return {
    actor: user?.username ?? user?.id ?? 'unknown',
    ...(user?.id !== undefined ? { actorId: user.id } : {}),
  };
}

/**
 * HARD-08 (D-91-10): the marking API key's label and creation time, kept with the dismissal so the
 * Dismissed section can still name the key after it is deleted. Only for a real key id (not the
 * legacy `api-key:session`) whose row belongs to the scan's own org — the same rule as the report
 * page's live label map. A failed read logs the error NAME only and the mark goes ahead without one.
 */
async function markingKeySnapshot(
  request: FastifyRequest,
  storage: StorageAdapter,
  scanOrgId: string,
): Promise<DismissalKeySnapshot | null> {
  const user = request.user;
  const keyId = user?.id === 'api-key' ? user.apiKeyId : undefined;
  if (keyId === undefined || keyId === '' || keyId === 'session') return null;
  try {
    const key = (await storage.apiKeys.listKeys(scanOrgId)).find(
      (k) => k.id === keyId && k.orgId === scanOrgId,
    );
    return key === undefined ? null : { label: key.label, keyCreatedAt: key.createdAt };
  } catch (err) {
    request.log.warn(
      { errorName: err instanceof Error ? err.name : 'UnknownError' },
      'Dismissal mark: key label not readable',
    );
    return null;
  }
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
      // All-of: requirePermission(a, b) is ANY-of, so two calls in an array.
      preHandler: [requirePermission('issues.dismiss'), requirePermission('reports.view')],
      config: MUTATION_CONFIG,
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
      if (scan === null || !mayTouchDismissalOrg(request.user, scan.orgId)) {
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

      const actorKeySnapshot = await markingKeySnapshot(request, storage, scan.orgId);
      const result = await dismissals.mark({
        orgId: scan.orgId,
        siteUrl: scan.siteUrl,
        siteKey,
        code: input.value.code,
        selector: input.value.selector,
        reason: input.value.reason,
        ...actorOf(request),
        ipAddress: request.ip,
        actorKeySnapshot,
      });
      if (result.kind === 'conflict') {
        return reply.code(409).send({
          error: 'This finding is already dismissed for this site',
          existing_id: result.existing.id,
        });
      }
      const recomputed = await recomputeAndLog(request, storage, scan.orgId, siteKey);
      return reply.code(201).send(mutationToJson(result.dismissal, recomputed));
    },
  );

  // ── POST /api/v1/dismissals/:id/revoke ──────────────────────────────────
  server.post(
    '/api/v1/dismissals/:id/revoke',
    {
      preHandler: [requirePermission('issues.dismiss'), requirePermission('reports.view')],
      config: MUTATION_CONFIG,
      schema: {
        tags: ['issue-dismissals'],
        params: IdParams,
        body: RevokeBody,
        response: {
          200: DismissalMutationResponse,
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
      if (existing === null || !mayTouchDismissalOrg(request.user, existing.orgId)) {
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
      const recomputed = await recomputeAndLog(request, storage, existing.orgId, existing.siteKey);
      return reply.code(200).send(mutationToJson(result.dismissal, recomputed));
    },
  );

  // ── GET /api/v1/scans/:scanId/dismissals/preview ────────────────────────
  // Phase 89 (D-04, FP-14): what would this dismissal cover in THIS scan? Read-only: no
  // repository write, no recompute, no audit row. Counts are over the RAW stored report, so an
  // already-dismissed key previews non-zero and then 409s on confirm; it is flagged alreadyDismissed.
  server.get(
    '/api/v1/scans/:scanId/dismissals/preview',
    {
      preHandler: [requirePermission('issues.dismiss'), requirePermission('reports.view')],
      config: RATE_LIMIT,
      schema: {
        tags: ['issue-dismissals'],
        params: ScanParams,
        querystring: PreviewQuery,
        response: {
          200: PreviewResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          422: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { scanId: string }; Querystring: PreviewQueryPayload }>,
      reply,
    ) => {
      const dismissals = repo();
      if (dismissals === undefined) return reply.code(503).send({ error: NOT_SUPPORTED });

      const scan = await storage.scans.getScan(request.params.scanId);
      if (scan === null || !mayTouchDismissalOrg(request.user, scan.orgId)) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const code = validateDismissalCode(request.query.code);
      if (!code.ok) return reply.code(400).send({ error: code.error });

      // A selector the mark route would refuse can never be dismissed (FP-04, HARD-01): answer
      // before loading the report, with a machine reason only; the UI translates it. 'selector'
      // is a whole-page or missing element, 'selector-too-long' one over the length limit. The
      // selector is classified once (its length first), and an accepted one is used unchanged.
      const refusal = dismissalRefusalReason(request.query.selector, code.value);
      if (refusal !== null) {
        const reason = refusal === 'selector-too-long' ? 'selector-too-long' : 'selector';
        return reply.code(200).send({ occurrences: 0, pages: 0, refused: true, reason });
      }
      const selector = request.query.selector;

      if (scan.status !== 'completed') {
        return reply.code(422).send({ error: 'Scan has no completed report' });
      }
      const loaded = await loadReportForScan(storage, scan);
      if (loaded.kind !== 'ok') {
        request.log.warn(
          { scanId: scan.id, errorName: loaded.kind === 'error' ? loaded.errorName : 'NoReport' },
          'Dismissal preview: report not readable',
        );
        return reply.code(422).send({ error: 'Report data not available' });
      }

      const siteKey = toSiteKey(scan.siteUrl);
      const { dismissed } = applyDismissals(
        loaded.report,
        [{ id: 'preview', code: code.value, selector, siteKey }],
        siteKey,
      );
      // The counts are over the RAW report, so a key that is already dismissed previews non-zero
      // and would 409 on confirm. Say so: the dialog must not offer a count it cannot act on.
      // Same key the mark conflict uses: this org, this site, exact code + selector, active only.
      const active = await dismissals.listActiveForSite(scan.orgId, siteKey);
      const alreadyDismissed = active.some(
        (d) => d.code === code.value && d.selector === selector,
      );
      return reply.code(200).send({
        occurrences: dismissed.length,
        pages: new Set(dismissed.map((o) => o.pageUrl)).size,
        ...(alreadyDismissed ? { alreadyDismissed: true } : {}),
      });
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
      // READ side (HARD-11): the predicate that admits a viewer to the report page, so this list
      // and the page's Dismissed section agree, system scans included. A scan of another org is
      // still a 404.
      if (scan === null || !mayViewScanReport(request.user, scan.orgId)) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const records = await dismissals.listForSite(scan.orgId, toSiteKey(scan.siteUrl));
      const withEvents = await Promise.all(
        records.map(async (record) => ({
          ...dismissalToJson(record),
          events: (await dismissals.listEvents(record.id)).map(eventToJson),
        })),
      );
      // A viewer who may open the report but not touch the scan's org gets what the page gives
      // them: no actor ids, and the generic key name instead of any key's id.
      const visible = mayTouchDismissalOrg(request.user, scan.orgId)
        ? withEvents
        : withEvents.map(redactDismissalJson);
      // Phase 93 (D-08): the element selector only for a caller holding the technical-details permission.
      return reply.code(200).send({
        dismissals: itemsForViewer(visible, requestMayViewTechnicalDetails(request)),
      });
    },
  );
}

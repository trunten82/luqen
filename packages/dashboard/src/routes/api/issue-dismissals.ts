/**
 * Phase 87 — Issue dismissal ("Mark as false positive") API (FP-01..04, FP-17).
 *
 *   POST /api/v1/scans/:scanId/dismissals      body: { code, selector, reason }
 *
 * The API is keyed by SCAN (D-01): the org and the site URL come from the scan
 * record, never from the client. Mark requires `issues.dismiss`, which is a
 * DARK permission (D-07): only global admins hold it until Phase 89.
 *
 * Scan access differs from the shared guard (`!bypassesOrgScope && orgId !==
 * scan.orgId && scan.orgId !== 'system'`) in ONE deliberate way: org users get
 * no 'system'-org exception. A dismissal on a 'system' scan would be stored
 * under org 'system', which is a write into another tenant. The global-admin
 * half is the shared `bypassesOrgScope` (PR #102) — never an org-scoped key.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import type { ScanRecord } from '../../db/types.js';
import type { IssueDismissalRepository } from '../../db/interfaces/issue-dismissal-repository.js';
import { requirePermission } from '../../auth/middleware.js';
import { bypassesOrgScope } from '../../permissions.js';
import { toSiteKey } from '../../services/issue-dismissals/site-key.js';
import { applyDismissals } from '../../services/issue-dismissals/apply-dismissals.js';
import { validateMarkInput } from '../../services/issue-dismissals/validate-input.js';
import {
  ErrorResponse,
  ConflictResponse,
  DismissalSchema,
  MarkBody,
  ScanParams,
  RATE_LIMIT,
  dismissalToJson,
  type MarkPayload,
} from './issue-dismissals-schemas.js';

const NOT_SUPPORTED = 'Dismissals are not supported by this storage adapter';

/** May this caller touch data that belongs to `orgId`? (D-10 at the API.) */
function mayTouchOrg(request: FastifyRequest, orgId: string): boolean {
  if (bypassesOrgScope(request.user)) return true;
  const current = request.user?.currentOrgId ?? '';
  return current !== '' && current === orgId;
}

/** DB report first, then the on-disk file (precedent: api/export.ts). */
async function loadReport(storage: StorageAdapter, scan: ScanRecord): Promise<unknown | null> {
  try {
    const dbReport = await storage.scans.getReport(scan.id);
    if (dbReport !== null) return dbReport;
    if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
      return JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as unknown;
    }
  } catch {
    // Fixed message at the call site: never echo parser or fs error text.
  }
  return null;
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
          201: DismissalSchema,
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
      const report = await loadReport(storage, scan);
      if (report === null) return reply.code(422).send({ error: 'Report data not available' });

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
      return reply.code(201).send(dismissalToJson(result.dismissal));
    },
  );
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../auth/middleware.js';
import { Type } from '@sinclair/typebox';
import { mkdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { StorageAdapter } from '../db/index.js';
import type { ManualTestEvidenceRecord } from '../db/types.js';
import {
  MANUAL_CRITERIA,
  getGroupedCriteria,
  type ManualTestStatus,
} from '../manual-criteria.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';

const pump = promisify(pipeline);

/**
 * Allowed evidence types: a strict MIME→extension allowlist (screenshots +
 * PDF, the legal-evidence norm). SVG is deliberately EXCLUDED — it can carry
 * inline <script> and, served same-origin from /uploads/, would execute as
 * active content when the evidence link is opened (stored XSS). The on-disk
 * extension is derived from the VALIDATED MIME below, never the client-supplied
 * filename, so a mislabelled extension cannot smuggle active content.
 */
const ALLOWED_EVIDENCE_MIME: ReadonlyMap<string, string> = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

/** HTML-escape a string for safe interpolation into fragments. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the per-criterion evidence list fragment (used by the GET page render
 * AND the upload/delete HTMX responses, so the markup stays identical).
 */
function renderEvidenceList(
  scanId: string,
  criterionId: string,
  items: readonly ManualTestEvidenceRecord[],
): string {
  const rows = items
    .map(
      (e) => `<li class="mt-evidence__item" id="mt-ev-${esc(e.id)}">
  <a href="${esc(e.filePath)}" target="_blank" rel="noopener noreferrer">${esc(e.fileName)}</a>
  <button type="button" class="mt-evidence__del" data-action="mtEvidenceDelete" data-scan-id="${esc(scanId)}" data-evidence-id="${esc(e.id)}" data-criterion-id="${esc(criterionId)}" aria-label="Delete evidence">&times;</button>
</li>`,
    )
    .join('');
  return `<ul class="mt-evidence__list" id="mt-ev-list-${esc(criterionId)}" data-count="${items.length}">${rows}</ul>`;
}

const ManualIdParams = Type.Object({ id: Type.String() }, { additionalProperties: true });

/**
 * Verdict-save request body (form-urlencoded). Permissive — all optional with
 * additionalProperties — so the handler's specific 400 messages still apply
 * rather than schema-level rejection.
 */
const ManualSaveBody = Type.Object(
  {
    criterionId: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    comment: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

/** Typed 200 response for the verdict-save route (JSON). */
const ManualSaveResponse = Type.Object(
  {
    criterionId: Type.String(),
    status: Type.String(),
    testedBy: Type.Union([Type.String(), Type.Null()]),
    testedAt: Type.Union([Type.String(), Type.Null()]),
    stats: Type.Object(
      {
        tested: Type.Number(),
        passed: Type.Number(),
        failed: Type.Number(),
        na: Type.Number(),
        untested: Type.Number(),
        percentage: Type.Number(),
      },
      { additionalProperties: true },
    ),
    auditEntry: Type.Union([
      Type.Object(
        {
          fromStatus: Type.String(),
          toStatus: Type.String(),
          comment: Type.Union([Type.String(), Type.Null()]),
          actor: Type.Union([Type.String(), Type.Null()]),
          createdAt: Type.String(),
        },
        { additionalProperties: true },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: true },
);

const VALID_STATUSES = new Set<ManualTestStatus>([
  'untested',
  'pass',
  'fail',
  'na',
]);

interface ManualTestBody {
  criterionId?: string;
  status?: string;
  notes?: string;
  /** Optional reason/comment recorded in the verdict audit trail. */
  comment?: string;
}

/**
 * Compute completion stats for a scan's manual tests.
 */
function computeStats(
  results: ReadonlyArray<{ readonly status: string }>,
  totalCriteria: number,
): {
  readonly tested: number;
  readonly passed: number;
  readonly failed: number;
  readonly na: number;
  readonly untested: number;
  readonly percentage: number;
} {
  let passed = 0;
  let failed = 0;
  let na = 0;

  for (const r of results) {
    if (r.status === 'pass') passed++;
    else if (r.status === 'fail') failed++;
    else if (r.status === 'na') na++;
  }

  const tested = passed + failed + na;
  const untested = totalCriteria - tested;
  const percentage =
    totalCriteria > 0 ? Math.round((tested / totalCriteria) * 100) : 0;

  return { tested, passed, failed, na, untested, percentage };
}

export async function manualTestRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  uploadsDir?: string,
): Promise<void> {
  // GET /reports/:id/manual — render manual testing checklist
  server.get(
    '/reports/:id/manual',
    {
      preHandler: requirePermission('manual_testing'), schema: { ...HtmlPageSchema, tags: ['manual-tests'], params: ManualIdParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Phase 55 task 5 — cross-org guard must mirror reports.ts: admin role
      // sees any org's scans. Without the admin bypass, an admin who opens a
      // report belonging to another org could view the report-detail page but
      // got 404 on the Manual Testing button, even though the link was
      // rendered for them (UAT 2026-05-15).
      const orgId = request.user?.currentOrgId ?? 'system';
      if (
        request.user?.role !== 'admin' &&
        scan.orgId !== orgId &&
        scan.orgId !== 'system'
      ) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Load saved results for this scan
      const savedResults = await storage.manualTests.getManualTests(id);
      const resultMap = new Map(
        savedResults.map((r) => [r.criterionId, r]),
      );

      // Load evidence artifacts (Slice C), grouped per criterion.
      const evidenceRows = await storage.manualTestEvidence.listEvidence(id);
      const evidenceMap = new Map<string, ManualTestEvidenceRecord[]>();
      for (const e of evidenceRows) {
        const list = evidenceMap.get(e.criterionId) ?? [];
        list.push(e);
        evidenceMap.set(e.criterionId, list);
      }

      // Load verdict-change audit history, grouped per criterion (newest first).
      const auditRows = await storage.manualTestAudit.listAudit(id);
      const auditMap = new Map<string, typeof auditRows>();
      for (const a of auditRows) {
        const list = auditMap.get(a.criterionId) ?? [];
        list.push(a);
        auditMap.set(a.criterionId, list);
      }

      const { manual, partial } = getGroupedCriteria();

      // Merge criteria with saved results
      const buildItems = (
        criteria: readonly (typeof MANUAL_CRITERIA)[number][],
      ) =>
        criteria.map((c) => {
          const saved = resultMap.get(c.id);
          const evidence = evidenceMap.get(c.id) ?? [];
          const history = (auditMap.get(c.id) ?? []).map((a) => ({
            fromStatus: a.fromStatus ?? 'untested',
            toStatus: a.toStatus,
            comment: a.comment ?? '',
            actor: a.actor ?? 'unknown',
            at: new Date(a.createdAt).toLocaleString(),
          }));
          return {
            ...c,
            status: saved?.status ?? 'untested',
            notes: saved?.notes ?? '',
            testedBy: saved?.testedBy ?? null,
            testedAt: saved?.testedAt
              ? new Date(saved.testedAt).toLocaleString()
              : null,
            evidence: evidence.map((e) => ({ id: e.id, fileName: e.fileName, filePath: e.filePath })),
            evidenceCount: evidence.length,
            history,
            historyCount: history.length,
          };
        });

      const manualItems = buildItems(manual);
      const partialItems = buildItems(partial);

      const stats = computeStats(
        savedResults,
        MANUAL_CRITERIA.length,
      );

      return reply.view('manual-tests.hbs', {
        pageTitle: `Manual Testing — ${scan.siteUrl}`,
        currentPath: `/reports/${id}/manual`,
        user: request.user,
        scan: {
          ...scan,
          jurisdictions: scan.jurisdictions.join(', '),
          createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        },
        manualItems,
        partialItems,
        stats,
      });
    },
  );

  // POST /reports/:id/manual — save a single manual test result. Returns JSON
  // (status + stats + audit entry); the client updates the criterion in place.
  // NB: deliberately NOT HtmlPageSchema — that pins a 200 string response and
  // would serialize the JSON object away.
  server.post(
    '/reports/:id/manual',
    {
      preHandler: requirePermission('manual_testing'), schema: { tags: ['manual-tests'], params: ManualIdParams, body: ManualSaveBody, response: { 200: ManualSaveResponse } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as ManualTestBody;

      const scan = await storage.scans.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Phase 55 task 5 — cross-org guard must mirror reports.ts: admin role
      // sees any org's scans. Without the admin bypass, an admin who opens a
      // report belonging to another org could view the report-detail page but
      // got 404 on the Manual Testing button, even though the link was
      // rendered for them (UAT 2026-05-15).
      const orgId = request.user?.currentOrgId ?? 'system';
      if (
        request.user?.role !== 'admin' &&
        scan.orgId !== orgId &&
        scan.orgId !== 'system'
      ) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Validate inputs
      const criterionId = (body.criterionId ?? '').trim();
      const status = (body.status ?? '').trim() as ManualTestStatus;
      const notes = (body.notes ?? '').trim();

      if (criterionId === '') {
        return reply.code(400).send({ error: 'criterionId is required' });
      }

      if (!VALID_STATUSES.has(status)) {
        return reply.code(400).send({ error: 'Invalid status value' });
      }

      // Verify criterion exists in our list
      const criterion = MANUAL_CRITERIA.find((c) => c.id === criterionId);
      if (criterion === undefined) {
        return reply.code(400).send({ error: 'Unknown criterion ID' });
      }

      const testedBy = request.user?.username ?? 'unknown';
      const comment = (body.comment ?? '').trim();

      // Capture the prior verdict so the audit row records from → to.
      const prior = (await storage.manualTests.getManualTests(id)).find(
        (r) => r.criterionId === criterionId,
      );
      const fromStatus = prior?.status ?? 'untested';

      const result = await storage.manualTests.upsertManualTest({
        scanId: id,
        criterionId,
        status,
        notes: notes !== '' ? notes : undefined,
        testedBy,
        orgId,
      });

      // Append an audit row for a genuine verdict change OR a commented save.
      // (A no-op re-save of the same status without a comment adds no history.)
      let auditEntry:
        | { fromStatus: string; toStatus: string; comment: string | null; actor: string | null; createdAt: string }
        | null = null;
      if (status !== fromStatus || comment !== '') {
        const rec = await storage.manualTestAudit.appendAudit({
          scanId: id,
          criterionId,
          fromStatus,
          toStatus: status,
          comment: comment !== '' ? comment : undefined,
          actor: testedBy,
          orgId,
        });
        auditEntry = {
          fromStatus: rec.fromStatus ?? 'untested',
          toStatus: rec.toStatus,
          comment: rec.comment,
          actor: rec.actor,
          createdAt: rec.createdAt,
        };
      }

      const allResults = await storage.manualTests.getManualTests(id);
      const stats = computeStats(allResults, MANUAL_CRITERIA.length);

      // JSON response — the client updates the criterion in place (badge,
      // active button, stats, and prepends any new history entry).
      return reply.send({
        criterionId,
        status,
        testedBy: result.testedBy,
        testedAt: result.testedAt,
        stats,
        auditEntry,
      });
    },
  );

  // ── Slice C: manual-test evidence file artifacts ──────────────────────────

  const EvidenceUploadParams = Type.Object(
    { id: Type.String(), criterionId: Type.String() },
    { additionalProperties: true },
  );
  const EvidenceDeleteParams = Type.Object(
    { id: Type.String(), evidenceId: Type.String() },
    { additionalProperties: true },
  );

  /** Shared cross-org guard (mirrors the manual routes above). */
  async function guardScan(
    request: FastifyRequest,
    reply: FastifyReply,
    scanId: string,
  ): Promise<{ orgId: string } | null> {
    const scan = await storage.scans.getScan(scanId);
    if (scan === null) {
      reply.code(404).header('content-type', 'text/html').send('Report not found');
      return null;
    }
    const orgId = request.user?.currentOrgId ?? 'system';
    if (request.user?.role !== 'admin' && scan.orgId !== orgId && scan.orgId !== 'system') {
      reply.code(404).header('content-type', 'text/html').send('Report not found');
      return null;
    }
    return { orgId: scan.orgId ?? orgId };
  }

  // POST /reports/:id/evidence/:criterionId — upload one evidence file (multipart)
  server.post(
    '/reports/:id/evidence/:criterionId',
    {
      preHandler: requirePermission('manual_testing'), schema: { ...HtmlPageSchema, tags: ['manual-tests'], params: EvidenceUploadParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, criterionId } = request.params as { id: string; criterionId: string };

      const guard = await guardScan(request, reply, id);
      if (guard === null) return reply;

      if (MANUAL_CRITERIA.find((c) => c.id === criterionId) === undefined) {
        return reply.code(400).header('content-type', 'text/html').send('Unknown criterion ID');
      }

      const data = await request.file();
      if (data === undefined) {
        return reply.code(400).header('content-type', 'text/html').send('No file uploaded.');
      }
      // Strict allowlist: validate the MIME and DERIVE the extension from it
      // (never the client filename). Rejects SVG and any active-content type.
      const ext = ALLOWED_EVIDENCE_MIME.get(data.mimetype);
      if (ext === undefined) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send('Only PNG, JPEG, GIF, WebP and PDF files are allowed.');
      }

      const critSlug = criterionId.replace(/[^a-z0-9]+/gi, '-');
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const storedName = `${id}-${critSlug}-${unique}.${ext}`;
      const orgId = guard.orgId;
      const dir = join(uploadsDir ?? './uploads', orgId, 'evidence');
      const filepath = join(dir, storedName);

      try {
        await mkdir(dir, { recursive: true });
        await pump(data.file, createWriteStream(filepath));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save evidence';
        return reply.code(500).header('content-type', 'text/html').send(esc(message));
      }

      // @fastify/multipart truncates oversized files (5MB limit) — reject + clean up.
      if (data.file.truncated) {
        await unlink(filepath).catch(() => undefined);
        return reply
          .code(413)
          .header('content-type', 'text/html')
          .send('File too large (max 5MB).');
      }

      // Original display name, sanitised: keep word chars, dot, dash, space.
      const displayName = (data.filename.split(/[\\/]/).pop() ?? 'evidence')
        .replace(/[ -<>"]/g, '')
        .replace(/[^\w.\- ]+/g, '_')
        .slice(0, 200) || 'evidence';

      await storage.manualTestEvidence.addEvidence({
        scanId: id,
        criterionId,
        filePath: `/uploads/${orgId}/evidence/${storedName}`,
        fileName: displayName,
        mimeType: data.mimetype,
        uploadedBy: request.user?.username ?? 'unknown',
        orgId,
      });

      const items = (await storage.manualTestEvidence.listEvidence(id)).filter(
        (e) => e.criterionId === criterionId,
      );
      return reply.type('text/html').send(renderEvidenceList(id, criterionId, items));
    },
  );

  // POST /reports/:id/evidence/:evidenceId/delete — remove one evidence file
  server.post(
    '/reports/:id/evidence/:evidenceId/delete',
    {
      preHandler: requirePermission('manual_testing'), schema: { ...HtmlPageSchema, tags: ['manual-tests'], params: EvidenceDeleteParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, evidenceId } = request.params as { id: string; evidenceId: string };

      const guard = await guardScan(request, reply, id);
      if (guard === null) return reply;

      const record = await storage.manualTestEvidence.getEvidence(evidenceId);
      if (record === null || record.scanId !== id) {
        return reply.code(404).header('content-type', 'text/html').send('Evidence not found');
      }

      // Best-effort: remove the file from disk (path → uploads root).
      const relative = record.filePath.replace(/^\/uploads\//, '');
      await unlink(join(uploadsDir ?? './uploads', relative)).catch(() => undefined);
      await storage.manualTestEvidence.deleteEvidence(evidenceId);

      const items = (await storage.manualTestEvidence.listEvidence(id)).filter(
        (e) => e.criterionId === record.criterionId,
      );
      return reply.type('text/html').send(renderEvidenceList(id, record.criterionId, items));
    },
  );
}

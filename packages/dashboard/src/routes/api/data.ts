import { deleteScanAndFiles, scanDeleteRefusal, SCAN_DELETE_PERMISSION } from '../../services/scan-delete-access.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { StorageAdapter, ScanRecord } from '../../db/index.js';
import { SqliteStorageAdapter } from '../../db/sqlite/index.js';
import { getFixSuggestion } from '../../fix-suggestions.js';
import { ErrorEnvelope } from '../../api/schemas/envelope.js';
import {
  applyActiveDismissals,
  applyLoadedDismissals,
  withDismissalsInRawBlob,
} from '../../services/issue-dismissals/load-dismissed-report.js';
import { toSiteKey } from '../../services/issue-dismissals/site-key.js';
import type { IssueDismissal } from '../../db/interfaces/issue-dismissal-repository.js';
import {
  TECHNICAL_DETAILS_PERMISSION,
  itemsForViewer,
  requestMayViewTechnicalDetails,
} from '../../services/technical-details.js';

// Data API responds with bare JSON ({ data, total } / { data, ... }) — schemas
// mirror that shape directly rather than going through LuqenResponse.
const ScanShape = Type.Object({}, { additionalProperties: true });
// D-10: the element selector is optional in the contract: it is present only for a caller who
// holds the technical-details permission (the same rule the report page applies). A union, so a
// stored null is never coerced to an empty string by the serializer.
const SELECTOR_DESCRIPTION =
  `CSS selector of the flagged element. Present only when the caller holds ${TECHNICAL_DETAILS_PERMISSION}; omitted otherwise.`;
const SelectorProperty = Type.Optional(
  Type.Union([Type.String(), Type.Null()], { description: SELECTOR_DESCRIPTION }),
);
// fast-json-stringify writes declared properties first, in declared order, then the rest. The keys
// that precede `selector` in the emitted row are declared (as unconstrained values, so nothing is
// coerced) to keep the serialised key order, and so the bytes an entitled caller receives, unchanged.
const AnyValue = Type.Optional(Type.Unknown());
const IssueShape = Type.Object(
  { type: AnyValue, code: AnyValue, message: AnyValue, selector: SelectorProperty },
  { additionalProperties: true },
);
const TrendPointShape = Type.Object({}, { additionalProperties: true });
const ComplianceSummaryShape = Type.Object({}, { additionalProperties: true });
const FixShape = Type.Object({}, { additionalProperties: true });
const ConnectedRepoShape = Type.Object({}, { additionalProperties: true });

const ScansListResponseSchema = Type.Object(
  { data: Type.Array(ScanShape), total: Type.Number() },
  { additionalProperties: true },
);
const ScanDetailResponseSchema = Type.Object(
  { data: Type.Object({}, { additionalProperties: true }) },
  { additionalProperties: true },
);
const IssuesResponseSchema = Type.Object(
  { data: Type.Array(IssueShape), total: Type.Number() },
  { additionalProperties: true },
);
const TrendsResponseSchema = Type.Object(
  { data: Type.Array(TrendPointShape) },
  { additionalProperties: true },
);
const ComplianceSummaryResponseSchema = Type.Object(
  { data: Type.Array(ComplianceSummaryShape) },
  { additionalProperties: true },
);
const FixesResponseSchema = Type.Object(
  {
    data: Type.Array(FixShape),
    total: Type.Optional(Type.Number()),
    connectedRepo: Type.Union([ConnectedRepoShape, Type.Null()]),
  },
  { additionalProperties: true },
);
const DeleteScanResponseSchema = Type.Object(
  { success: Type.Boolean() },
  { additionalProperties: true },
);

const ScanIdParamsSchema = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);
const ScansQuerystringSchema = Type.Object(
  {
    siteUrl: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
    offset: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const IssuesQuerystringSchema = Type.Object(
  {
    severity: Type.Optional(Type.String()),
    criterion: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
    offset: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const TrendsQuerystringSchema = Type.Object(
  {
    siteUrl: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const ComplianceSummaryQuerystringSchema = Type.Object(
  { siteUrl: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScansQuery {
  readonly siteUrl?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: string;
  readonly offset?: string;
}

interface ScanParams {
  readonly id: string;
}

interface IssuesQuery {
  readonly severity?: string;
  readonly criterion?: string;
  readonly limit?: string;
  readonly offset?: string;
}

interface TrendsQuery {
  readonly siteUrl: string;
  readonly from?: string;
  readonly to?: string;
}

interface ComplianceSummaryQuery {
  readonly siteUrl?: string;
}

interface ReportIssue {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context?: string;
  readonly wcagCriterion?: string;
  readonly wcagTitle?: string;
  /** Which engine produced the finding (e.g. 'axe-core', 'behavioral', 'vision'). */
  readonly runner?: string;
  readonly regulations?: ReadonlyArray<{
    readonly shortName: string;
    readonly url?: string;
    readonly obligation?: string;
  }>;
}

interface ReportPage {
  readonly url: string;
  readonly issueCount: number;
  readonly issues: readonly ReportIssue[];
}

interface ComplianceMatrixEntry {
  readonly jurisdictionId: string;
  readonly jurisdictionName: string;
  readonly status?: string;
  readonly reviewStatus?: string;
  readonly confirmedViolations?: number;
  readonly mandatoryViolations?: number;
  readonly needsReview?: number;
  readonly regulations?: ReadonlyArray<{
    readonly shortName: string;
    readonly status?: string;
    readonly violations?: ReadonlyArray<{ wcagCriterion: string; obligation: string; issueCount: number }>;
  }>;
}

interface JsonReport {
  readonly summary?: {
    readonly url?: string;
    readonly pagesScanned?: number;
    readonly totalIssues?: number;
    readonly byLevel?: { readonly error: number; readonly warning: number; readonly notice: number };
  };
  readonly pages?: readonly ReportPage[];
  readonly compliance?: {
    readonly summary?: {
      readonly passing?: number;
      readonly failing?: number;
      readonly totalConfirmedViolations?: number;
    };
    readonly matrix?: Record<string, ComplianceMatrixEntry>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

function clampLimit(raw: string | undefined): number {
  const n = raw !== undefined ? parseInt(raw, 10) : DEFAULT_LIMIT;
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseOffset(raw: string | undefined): number {
  const n = raw !== undefined ? parseInt(raw, 10) : 0;
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

function isValidIsoDate(value: string | undefined): boolean {
  if (value === undefined) return false;
  return !Number.isNaN(Date.parse(value));
}

function getOrgId(request: FastifyRequest): string {
  return request.user?.currentOrgId ?? 'system';
}

/** The permission set the auth layer resolved for this request (empty when none was attached). */
function permissionsOf(request: FastifyRequest): ReadonlySet<string> {
  const granted = (request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined;
  return granted ?? new Set<string>();
}

async function readReport(reportPath: string | undefined): Promise<JsonReport | null> {
  if (reportPath === undefined || !existsSync(reportPath)) {
    return null;
  }
  try {
    const raw = await readFile(reportPath, 'utf-8');
    return JSON.parse(raw) as JsonReport;
  } catch {
    return null;
  }
}

/** The scan row's raw `jsonReport` blob, parsed; null when absent or not JSON. */
function parseRowBlob(scan: ScanRecord): JsonReport | null {
  if (scan.jsonReport === undefined) return null;
  try {
    return JSON.parse(scan.jsonReport) as JsonReport;
  } catch {
    return null;
  }
}

/** Strip jsonReportPath and error from a scan record for external consumption. */
function toPublicScan(scan: ScanRecord): Record<string, unknown> {
  const { jsonReportPath: _path, error: _err, createdBy: _cb, ...rest } = scan as ScanRecord & Record<string, unknown>;
  return rest;
}

// ---------------------------------------------------------------------------
// Rate-limit config shared by all data API endpoints
// ---------------------------------------------------------------------------

const rateLimitConfig = {
  rateLimit: {
    max: 60,
    timeWindow: '1 minute',
  },
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function dataApiRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  /** `reportsDir`: the only directory a scan delete removes stored report files from. */
  options: { readonly reportsDir?: string } = {},
): Promise<void> {
  const rawDb = (storage as SqliteStorageAdapter).getRawDatabase();

  // ── GET /api/v1/scans ─────────────────────────────────────────────────
  server.get<{ Querystring: ScansQuery }>(
    '/api/v1/scans',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['data'],
        querystring: ScansQuerystringSchema,
        response: { 200: ScansListResponseSchema, 401: ErrorEnvelope },
      },
    },
    async (request: FastifyRequest<{ Querystring: ScansQuery }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const limit = clampLimit(request.query.limit);
      const offset = parseOffset(request.query.offset);
      const { siteUrl, from, to } = request.query;

      const conditions: string[] = ["status = 'completed'", 'org_id = @orgId'];
      const params: Record<string, unknown> = { orgId, limit, offset };

      if (siteUrl !== undefined && siteUrl !== '') {
        conditions.push('site_url LIKE @siteUrl');
        params['siteUrl'] = `%${siteUrl}%`;
      }
      if (from !== undefined && isValidIsoDate(from)) {
        conditions.push('created_at >= @from');
        params['from'] = from;
      }
      if (to !== undefined && isValidIsoDate(to)) {
        conditions.push('created_at <= @to');
        params['to'] = to;
      }

      const where = `WHERE ${conditions.join(' AND ')}`;

      const countRow = rawDb
        .prepare(`SELECT COUNT(*) as cnt FROM scan_records ${where}`)
        .get(params) as { cnt: number };

      const rows = rawDb
        .prepare(`SELECT * FROM scan_records ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
        .all(params) as Array<Record<string, unknown>>;

      // Convert rows through the ScanRepository interface
      const records = (
        await Promise.all(rows.map((row) => storage.scans.getScan(row['id'] as string)))
      ).filter((record): record is ScanRecord => record !== null);

      // The row's raw jsonReport is part of this response, so it follows the dismissals of the
      // row's own org + site. One lookup per distinct (org, site) on the page; a row's blob is
      // parsed only when its site has an active dismissal (the blobs are multi-MB).
      const activeBySite = new Map<string, Promise<readonly IssueDismissal[]>>();
      const lookupActive = (record: ScanRecord): Promise<readonly IssueDismissal[]> => {
        const repo = storage.issueDismissals;
        if (repo === undefined) return Promise.resolve([]);
        const siteKey = toSiteKey(record.siteUrl);
        const key = `${record.orgId}\u0000${siteKey}`;
        const cached = activeBySite.get(key);
        if (cached !== undefined) return cached;
        const looked = repo.listActiveForSite(record.orgId, siteKey);
        activeBySite.set(key, looked);
        return looked;
      };
      const scans = await Promise.all(
        records.map(async (record) => {
          const active = await lookupActive(record);
          if (active.length === 0) return toPublicScan(record);
          const blob = parseRowBlob(record);
          // IN-01: a blob that cannot be parsed cannot be filtered, so it is not served (fail closed,
          // same as repos.ts); an absent blob has nothing to leak.
          if (blob === null) return toPublicScan({ ...record, jsonReport: undefined });
          return toPublicScan(withDismissalsInRawBlob(record, applyLoadedDismissals(record, active, blob)));
        }),
      );

      return reply.header('content-type', 'application/json').send({
        data: scans,
        total: countRow.cnt,
      });
    },
  );

  // ── GET /api/v1/scans/:id ─────────────────────────────────────────────
  server.get<{ Params: ScanParams }>(
    '/api/v1/scans/:id',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['data'],
        params: ScanIdParamsSchema,
        response: {
          200: ScanDetailResponseSchema,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest<{ Params: ScanParams }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const scan = await storage.scans.getScan(request.params.id);

      if (scan === null || scan.orgId !== orgId) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      // One dismissal lookup per request. The summary comes from the FS report (as before); the
      // row's raw jsonReport blob is part of this response, so it follows the filtered report
      // (or, when there is no FS report, its own filtered copy) whenever a dismissal applied.
      const fsReport = await readReport(scan.jsonReportPath);
      const applied = await applyActiveDismissals(storage, scan, fsReport ?? parseRowBlob(scan));
      const report = fsReport === null ? null : applied.report;
      const publicScan = toPublicScan(withDismissalsInRawBlob(scan, applied));

      return reply.header('content-type', 'application/json').send({
        data: {
          ...publicScan,
          summary: report?.summary ?? null,
        },
      });
    },
  );

  // ── GET /api/v1/scans/:id/issues ──────────────────────────────────────
  server.get<{ Params: ScanParams; Querystring: IssuesQuery }>(
    '/api/v1/scans/:id/issues',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['data'],
        params: ScanIdParamsSchema,
        querystring: IssuesQuerystringSchema,
        response: {
          200: IssuesResponseSchema,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: ScanParams; Querystring: IssuesQuery }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const scan = await storage.scans.getScan(request.params.id);

      if (scan === null || scan.orgId !== orgId) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const rawReport = await readReport(scan.jsonReportPath);
      const report = (await applyActiveDismissals(storage, scan, rawReport)).report;
      if (report === null || report.pages === undefined) {
        return reply.send({ data: [], total: 0 });
      }

      const { severity, criterion } = request.query;
      const limit = clampLimit(request.query.limit);
      const offset = parseOffset(request.query.offset);

      // Flatten all issues across pages, attaching pageUrl
      let allIssues: Array<Record<string, unknown>> = [];
      for (const page of report.pages) {
        for (const issue of page.issues) {
          allIssues.push({
            type: issue.type,
            code: issue.code,
            message: issue.message,
            selector: issue.selector,
            wcagCriterion: issue.wcagCriterion ?? null,
            wcagTitle: issue.wcagTitle ?? null,
            runner: issue.runner ?? null,
            pageUrl: page.url,
            regulations: issue.regulations ?? [],
          });
        }
      }

      // Apply filters
      if (severity !== undefined && severity !== '') {
        allIssues = allIssues.filter((i) => i['type'] === severity);
      }
      if (criterion !== undefined && criterion !== '') {
        allIssues = allIssues.filter((i) =>
          typeof i['wcagCriterion'] === 'string' &&
          (i['wcagCriterion'] as string).includes(criterion),
        );
      }

      const total = allIssues.length;
      // Redaction comes after dismissal filtering and paging: both need the raw selectors.
      const paged = itemsForViewer(
        allIssues.slice(offset, offset + limit),
        requestMayViewTechnicalDetails(request),
      );

      return reply.header('content-type', 'application/json').send({
        data: paged,
        total,
      });
    },
  );

  // ── GET /api/v1/trends ────────────────────────────────────────────────
  server.get<{ Querystring: TrendsQuery }>(
    '/api/v1/trends',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['data'],
        querystring: TrendsQuerystringSchema,
        response: {
          200: TrendsResponseSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: TrendsQuery }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const { siteUrl, from, to } = request.query;

      if (siteUrl === undefined || siteUrl.trim() === '') {
        return reply.code(400).send({ error: 'siteUrl query parameter is required' });
      }

      const conditions: string[] = [
        "status = 'completed'",
        'org_id = @orgId',
        'site_url LIKE @siteUrl',
      ];
      const params: Record<string, unknown> = {
        orgId,
        siteUrl: `%${siteUrl}%`,
      };

      if (from !== undefined && isValidIsoDate(from)) {
        conditions.push('created_at >= @from');
        params['from'] = from;
      }
      if (to !== undefined && isValidIsoDate(to)) {
        conditions.push('created_at <= @to');
        params['to'] = to;
      }

      const where = `WHERE ${conditions.join(' AND ')}`;
      const rows = rawDb
        .prepare(`SELECT * FROM scan_records ${where} ORDER BY created_at ASC`)
        .all(params) as Array<Record<string, unknown>>;

      const trendData = rows.map((row) => ({
        date: row['created_at'],
        pagesScanned: row['pages_scanned'] ?? 0,
        totalIssues: row['total_issues'] ?? 0,
        errors: row['errors'] ?? 0,
        warnings: row['warnings'] ?? 0,
        notices: row['notices'] ?? 0,
        confirmedViolations: row['confirmed_violations'] ?? 0,
      }));

      return reply.header('content-type', 'application/json').send({
        data: trendData,
      });
    },
  );

  // ── GET /api/v1/compliance-summary ────────────────────────────────────
  server.get<{ Querystring: ComplianceSummaryQuery }>(
    '/api/v1/compliance-summary',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['data'],
        querystring: ComplianceSummaryQuerystringSchema,
        response: { 200: ComplianceSummaryResponseSchema, 401: ErrorEnvelope },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: ComplianceSummaryQuery }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const { siteUrl } = request.query;

      // Find latest completed scan(s) — either for a specific site or one per site
      let scans: ScanRecord[];

      if (siteUrl !== undefined && siteUrl.trim() !== '') {
        scans = await storage.scans.listScans({
          status: 'completed',
          orgId,
          siteUrl,
          limit: 1,
        });
      } else {
        // Latest scan per unique site_url
        const rows = rawDb
          .prepare(`
            SELECT s.* FROM scan_records s
            INNER JOIN (
              SELECT site_url, MAX(created_at) as max_created
              FROM scan_records
              WHERE status = 'completed' AND org_id = @orgId
              GROUP BY site_url
            ) latest ON s.site_url = latest.site_url AND s.created_at = latest.max_created
            WHERE s.org_id = @orgId
            ORDER BY s.created_at DESC
          `)
          .all({ orgId }) as Array<Record<string, unknown>>;

        const scanPromises = rows.map((row) => storage.scans.getScan(row['id'] as string));
        const scanResults2 = await Promise.all(scanPromises);
        scans = scanResults2.filter((s): s is ScanRecord => s !== null);
      }

      const summaries: Array<Record<string, unknown>> = [];

      for (const scan of scans) {
        const rawReport = await readReport(scan.jsonReportPath);
        const report = (await applyActiveDismissals(storage, scan, rawReport)).report;
        const matrix = report?.compliance?.matrix;

        const jurisdictions: Array<Record<string, unknown>> = [];
        if (matrix !== undefined) {
          for (const [key, entry] of Object.entries(matrix)) {
            jurisdictions.push({
              jurisdictionId: entry.jurisdictionId ?? key,
              jurisdictionName: entry.jurisdictionName,
              status: entry.status ?? (entry.reviewStatus === 'fail' ? 'fail' : 'pass'),
              confirmedViolations: entry.confirmedViolations ?? 0,
              needsReview: entry.needsReview ?? 0,
            });
          }
        }

        summaries.push({
          scanId: scan.id,
          siteUrl: scan.siteUrl,
          standard: scan.standard,
          scannedAt: scan.completedAt ?? scan.createdAt,
          totalIssues: scan.totalIssues ?? 0,
          errors: scan.errors ?? 0,
          warnings: scan.warnings ?? 0,
          notices: scan.notices ?? 0,
          confirmedViolations: scan.confirmedViolations ?? 0,
          jurisdictions,
        });
      }

      return reply.header('content-type', 'application/json').send({
        data: summaries,
      });
    },
  );

  // ── GET /api/v1/scans/:id/fixes ────────────────────────────────────
  server.get<{ Params: ScanParams }>(
    '/api/v1/scans/:id/fixes',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['data'],
        params: ScanIdParamsSchema,
        response: {
          200: FixesResponseSchema,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: ScanParams }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const scan = await storage.scans.getScan(request.params.id);

      if (scan === null || scan.orgId !== orgId) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const rawReport = await readReport(scan.jsonReportPath);
      const report = (await applyActiveDismissals(storage, scan, rawReport)).report;
      if (report === null || report.pages === undefined) {
        return reply.send({ data: [], total: 0, connectedRepo: null });
      }

      // Find connected repo
      const connectedRepo = await storage.repos.findRepoForUrl(scan.siteUrl, orgId);

      // Collect all issues and generate fix proposals
      const fixes: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();

      for (const page of report.pages) {
        for (const issue of page.issues) {
          const criterion = issue.wcagCriterion ?? '';
          const suggestion = getFixSuggestion(criterion, issue.message);
          if (suggestion === null) continue;

          const fingerprint = `${suggestion.criterion}:${suggestion.issuePattern}:${issue.selector}`;
          if (seen.has(fingerprint)) continue;
          seen.add(fingerprint);

          fixes.push({
            criterion: suggestion.criterion,
            title: suggestion.title,
            description: suggestion.description,
            codeExample: suggestion.codeExample,
            effort: suggestion.effort,
            severity: issue.type,
            message: issue.message,
            selector: issue.selector,
            pageUrl: page.url,
            repoPath: connectedRepo?.repoPath ?? null,
            repoUrl: connectedRepo?.repoUrl ?? null,
            branch: connectedRepo?.branch ?? null,
          });
        }
      }

      return reply.header('content-type', 'application/json').send({
        data: fixes,
        total: fixes.length,
        connectedRepo: connectedRepo !== null
          ? {
              repoUrl: connectedRepo.repoUrl,
              repoPath: connectedRepo.repoPath,
              branch: connectedRepo.branch,
            }
          : null,
        mcpTools: ['luqen_propose_fixes', 'luqen_apply_fix'],
        a2aHint: 'Agents can call GET /api/v1/scans/:id/fixes for fix proposals',
      });
    },
  );

  // ── DELETE /api/v1/scans/:id ──────────────────────────────────────────
  server.delete<{ Params: ScanParams }>(
    '/api/v1/scans/:id',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['data'],
        params: ScanIdParamsSchema,
        response: {
          200: DeleteScanResponseSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest<{ Params: ScanParams }>, reply: FastifyReply) => {
      const scan = await storage.scans.getScan(request.params.id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const refusal = scanDeleteRefusal({ user: request.user, permissions: permissionsOf(request) }, scan);
      if (refusal === 'org') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      if (refusal === 'permission') {
        return reply.code(403).send({ error: `Forbidden: requires ${SCAN_DELETE_PERMISSION}` });
      }

      await deleteScanAndFiles(storage, scan, { reportsDir: options.reportsDir, log: request.log });
      return reply.code(200).send({ success: true });
    },
  );
}

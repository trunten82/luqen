import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ScanDb, ScanRecord } from '../../db/scans.js';
import { getFixSuggestion } from '../../fix-suggestions.js';

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
  db: ScanDb,
): Promise<void> {
  const rawDb = db.getDatabase();

  // ── GET /api/v1/scans ─────────────────────────────────────────────────
  server.get<{ Querystring: ScansQuery }>(
    '/api/v1/scans',
    { config: rateLimitConfig },
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

      // Convert rows through ScanDb's listScans-compatible path
      const scans = rows.map((row) => {
        const record = db.getScan(row['id'] as string);
        return record !== null ? toPublicScan(record) : null;
      }).filter(Boolean);

      return reply.header('content-type', 'application/json').send({
        data: scans,
        total: countRow.cnt,
      });
    },
  );

  // ── GET /api/v1/scans/:id ─────────────────────────────────────────────
  server.get<{ Params: ScanParams }>(
    '/api/v1/scans/:id',
    { config: rateLimitConfig },
    async (request: FastifyRequest<{ Params: ScanParams }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const scan = db.getScan(request.params.id);

      if (scan === null || scan.orgId !== orgId) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const report = await readReport(scan.jsonReportPath);
      const publicScan = toPublicScan(scan);

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
    { config: rateLimitConfig },
    async (
      request: FastifyRequest<{ Params: ScanParams; Querystring: IssuesQuery }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const scan = db.getScan(request.params.id);

      if (scan === null || scan.orgId !== orgId) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const report = await readReport(scan.jsonReportPath);
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
      const paged = allIssues.slice(offset, offset + limit);

      return reply.header('content-type', 'application/json').send({
        data: paged,
        total,
      });
    },
  );

  // ── GET /api/v1/trends ────────────────────────────────────────────────
  server.get<{ Querystring: TrendsQuery }>(
    '/api/v1/trends',
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
    async (
      request: FastifyRequest<{ Querystring: ComplianceSummaryQuery }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const { siteUrl } = request.query;

      // Find latest completed scan(s) — either for a specific site or one per site
      let scans: ScanRecord[];

      if (siteUrl !== undefined && siteUrl.trim() !== '') {
        scans = db.listScans({
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

        scans = rows
          .map((row) => db.getScan(row['id'] as string))
          .filter((s): s is ScanRecord => s !== null);
      }

      const summaries: Array<Record<string, unknown>> = [];

      for (const scan of scans) {
        const report = await readReport(scan.jsonReportPath);
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
    { config: rateLimitConfig },
    async (
      request: FastifyRequest<{ Params: ScanParams }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const scan = db.getScan(request.params.id);

      if (scan === null || scan.orgId !== orgId) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const report = await readReport(scan.jsonReportPath);
      if (report === null || report.pages === undefined) {
        return reply.send({ data: [], total: 0, connectedRepo: null });
      }

      // Find connected repo
      const connectedRepo = db.findRepoForUrl(scan.siteUrl, orgId);

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
}

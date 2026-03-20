import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ScanDb } from '../db/scans.js';

interface ReportsQuery {
  q?: string;
  status?: string;
  offset?: string;
  limit?: string;
}

const PAGE_SIZE = 20;

/** Shape of the JSON report file written by core's generateJsonReport or the orchestrator. */
interface JsonReportFile {
  summary?: {
    url?: string;
    pagesScanned?: number;
    pagesFailed?: number;
    totalIssues?: number;
    byLevel?: { error: number; warning: number; notice: number };
  };
  pages?: Array<{
    url: string;
    issueCount: number;
    issues: Array<{
      type: string;
      code: string;
      message: string;
      selector: string;
      context: string;
      wcagCriterion?: string;
      wcagTitle?: string;
      wcagDescription?: string;
      wcagImpact?: string;
      wcagUrl?: string;
      regulations?: Array<{
        shortName: string;
        url?: string;
        obligation?: string;
        enforcementDate?: string;
      }>;
    }>;
  }>;
  errors?: Array<{ url: string; code: string; message: string }>;
  compliance?: {
    summary?: {
      passing?: number;
      failing?: number;
      totalConfirmedViolations?: number;
      totalNeedsReview?: number;
    };
    matrix?: Record<string, {
      jurisdictionId: string;
      jurisdictionName: string;
      status?: string;
      reviewStatus?: string;
      confirmedViolations?: number;
      needsReview?: number;
      recommendedViolations?: number;
      regulations?: Array<{
        shortName: string;
        url?: string;
        obligation?: string;
        enforcementDate?: string;
      }>;
    }>;
  };
  templateIssues?: Array<{
    type: string;
    code: string;
    message: string;
    selector?: string;
    context?: string;
    wcagCriterion?: string;
    wcagTitle?: string;
    wcagUrl?: string;
    regulations?: Array<{
      shortName: string;
      url?: string;
      obligation?: string;
    }>;
    affectedPages: string[];
    affectedCount: number;
  }>;
  // Flat fields written by the dashboard orchestrator
  siteUrl?: string;
  pagesScanned?: number;
  errors_count?: number;
  warnings?: number;
  notices?: number;
  issues?: Array<{ code: string; type: string; message: string; selector: string; context: string }>;
}

function normalizeReportData(raw: JsonReportFile, scan: { siteUrl: string; pagesScanned?: number; errors?: number; warnings?: number; notices?: number }) {
  // Support both the core JSON report format (has summary/pages) and the
  // dashboard orchestrator's simpler format (flat fields + issues array).
  const summary = raw.summary ?? {
    url: raw.siteUrl ?? scan.siteUrl,
    pagesScanned: raw.pagesScanned ?? scan.pagesScanned ?? 0,
    pagesFailed: 0,
    totalIssues: (scan.errors ?? 0) + (scan.warnings ?? 0) + (scan.notices ?? 0),
    byLevel: {
      error: scan.errors ?? 0,
      warning: scan.warnings ?? 0,
      notice: scan.notices ?? 0,
    },
  };

  // If raw.pages exists use it; otherwise build a synthetic single page from flat issues
  const pages = raw.pages ?? (
    raw.issues && raw.issues.length > 0
      ? [{
          url: raw.siteUrl ?? scan.siteUrl,
          issueCount: raw.issues.length,
          issues: raw.issues,
        }]
      : []
  );

  // Add issueCount helper to each page if missing
  const pagesWithCount = pages.map((p) => ({
    ...p,
    issueCount: p.issueCount ?? p.issues?.length ?? 0,
  }));

  const complianceMatrix = raw.compliance?.matrix
    ? Object.values(raw.compliance.matrix)
    : null;

  const templateIssues = raw.templateIssues && raw.templateIssues.length > 0
    ? raw.templateIssues
    : null;

  const templateIssueCount = templateIssues?.length ?? 0;
  const templateOccurrenceCount = templateIssues
    ? templateIssues.reduce((sum, ti) => sum + (ti.affectedCount ?? 0), 0)
    : 0;

  return {
    summary,
    pages: pagesWithCount,
    errors: raw.errors ?? [],
    compliance: raw.compliance ?? null,
    complianceMatrix,
    templateIssues,
    templateIssueCount,
    templateOccurrenceCount,
  };
}

export async function reportRoutes(
  server: FastifyInstance,
  db: ScanDb,
): Promise<void> {
  // GET /reports — list with pagination and search
  server.get(
    '/reports',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as ReportsQuery;
      const offset = query.offset !== undefined ? parseInt(query.offset, 10) : 0;
      const limit = query.limit !== undefined ? parseInt(query.limit, 10) : PAGE_SIZE;
      const q = query.q?.trim();
      const status = query.status;

      const scans = db.listScans({
        ...(q !== undefined && q !== '' ? { siteUrl: q } : {}),
        ...(status !== undefined && status !== '' && status !== 'all'
          ? { status: status as 'queued' | 'running' | 'completed' | 'failed' }
          : {}),
        offset,
        limit: limit + 1, // fetch one extra to detect if there's a next page
      });

      const hasNext = scans.length > limit;
      const page = hasNext ? scans.slice(0, limit) : scans;
      const hasPrev = offset > 0;
      const currentPage = Math.floor(offset / limit) + 1;

      const formatted = page.map((s) => ({
        ...s,
        jurisdictions: s.jurisdictions.join(', '),
        createdAtDisplay: new Date(s.createdAt).toLocaleString(),
        completedAtDisplay: s.completedAt
          ? new Date(s.completedAt).toLocaleString()
          : '',
      }));

      // HTMX partial request — return table fragment only
      const isHtmx = request.headers['hx-request'] === 'true';
      if (isHtmx) {
        return reply.view('partials/reports-table.hbs', {
          scans: formatted,
          user: request.user,
          hasPrev,
          hasNext,
          prevOffset: Math.max(0, offset - limit),
          nextOffset: offset + limit,
          limit,
          currentPage,
          q,
          status,
        });
      }

      return reply.view('reports-list.hbs', {
        pageTitle: 'Reports',
        currentPath: '/reports',
        user: request.user,
        scans: formatted,
        hasPrev,
        hasNext,
        prevOffset: Math.max(0, offset - limit),
        nextOffset: offset + limit,
        limit,
        currentPage,
        q,
        status,
      });
    },
  );

  // GET /reports/:id — read JSON report and render rich report-detail template
  server.get(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const scanMeta = {
        ...scan,
        jurisdictions: scan.jurisdictions.join(', '),
        createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        completedAtDisplay: scan.completedAt
          ? new Date(scan.completedAt).toLocaleString()
          : '',
      };

      // If scan is not completed or no JSON file, render a status-only view
      if (
        scan.status !== 'completed' ||
        scan.jsonReportPath === undefined ||
        !existsSync(scan.jsonReportPath)
      ) {
        return reply.view('report-detail.hbs', {
          pageTitle: `Report — ${scan.siteUrl}`,
          currentPath: `/reports/${id}`,
          user: request.user,
          scan: scanMeta,
          reportData: null,
        });
      }

      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const raw = JSON.parse(
          await readFile(scan.jsonReportPath, 'utf-8'),
        ) as JsonReportFile;
        reportData = normalizeReportData(raw, scan);
      } catch {
        // Render without report data — template handles the missing case
      }

      return reply.view('report-detail.hbs', {
        pageTitle: `Report — ${scan.siteUrl}`,
        currentPath: `/reports/${id}`,
        user: request.user,
        scan: scanMeta,
        reportData,
      });
    },
  );

  // DELETE /reports/:id — delete scan record and files
  server.delete(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Only the creator or admin can delete
      const user = request.user;
      if (
        user?.role !== 'admin' &&
        scan.createdBy !== user?.username
      ) {
        return reply.code(403).send({ error: 'You can only delete your own reports' });
      }

      // Delete report files
      if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
        await unlink(scan.jsonReportPath).catch(() => undefined);
      }

      db.deleteScan(id);

      // HTMX request — return empty fragment for swap
      if (request.headers['hx-request'] === 'true') {
        return reply.code(200).send('');
      }

      await reply.redirect('/reports');
    },
  );
}

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { StorageAdapter } from '../db/index.js';
import { diffReports, type NormalizedReport, type DiffIssue } from '../compare/diff.js';
import { extractCriterion, getWcagDescription } from './wcag-enrichment.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';

interface CompareQuery {
  a?: string;
  b?: string;
}

/** Shape of the JSON report file — mirrors the interface in reports.ts. */
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
      wcagUrl?: string;
    }>;
  }>;
  errors?: Array<{ url: string; code: string; message: string }>;
  siteUrl?: string;
  pagesScanned?: number;
  errors_count?: number;
  warnings?: number;
  notices?: number;
  issues?: Array<{ code: string; type: string; message: string; selector: string; context: string }>;
}

interface EnrichedDiffIssue extends DiffIssue {
  readonly regulationTags?: readonly string[];
}

/** Enrich a diff issue with WCAG criterion info if not already present. */
function enrichIssueWithWcag(issue: DiffIssue): EnrichedDiffIssue {
  const criterion = issue.wcagCriterion ?? extractCriterion(issue.code);
  if (criterion !== null) {
    const info = getWcagDescription(criterion);
    return {
      ...issue,
      wcagCriterion: criterion,
      wcagTitle: issue.wcagTitle ?? info?.title ?? undefined,
      wcagUrl: issue.wcagUrl ?? info?.url ?? undefined,
    };
  }
  return { ...issue };
}

function normalizeForDiff(
  raw: JsonReportFile,
  scan: { siteUrl: string; errors?: number; warnings?: number; notices?: number },
): NormalizedReport {
  const byLevel = raw.summary?.byLevel ?? {
    error: scan.errors ?? 0,
    warning: scan.warnings ?? 0,
    notice: scan.notices ?? 0,
  };

  const pages = raw.pages ?? (
    raw.issues && raw.issues.length > 0
      ? [{
          url: raw.siteUrl ?? scan.siteUrl,
          issueCount: raw.issues.length,
          issues: raw.issues,
        }]
      : []
  );

  return {
    summary: { byLevel },
    pages,
  };
}

function formatScanMeta(scan: {
  id: string;
  siteUrl: string;
  standard: string;
  createdAt: string;
  completedAt?: string;
  errors?: number;
  warnings?: number;
  notices?: number;
  totalIssues?: number;
}) {
  return {
    ...scan,
    totalIssues: scan.totalIssues ?? ((scan.errors ?? 0) + (scan.warnings ?? 0) + (scan.notices ?? 0)),
    createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
    completedAtDisplay: scan.completedAt
      ? new Date(scan.completedAt).toLocaleString()
      : '',
  };
}

export async function compareRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/reports/compare',
    { schema: { ...HtmlPageSchema, tags: ['compare'] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as CompareQuery;
      const idA = query.a?.trim();
      const idB = query.b?.trim();

      if (idA === undefined || idA === '' || idB === undefined || idB === '') {
        return reply.code(400).send({ error: 'Both query parameters "a" and "b" are required.' });
      }

      const scanA = await storage.scans.getScan(idA);
      const scanB = await storage.scans.getScan(idB);

      if (scanA === null) {
        return reply.code(404).send({ error: `Scan A not found: ${idA}` });
      }
      if (scanB === null) {
        return reply.code(404).send({ error: `Scan B not found: ${idB}` });
      }

      // Both scans must be completed with JSON reports
      if (
        scanA.status !== 'completed' ||
        scanA.jsonReportPath === undefined ||
        !existsSync(scanA.jsonReportPath)
      ) {
        return reply.code(400).send({ error: 'Scan A does not have a completed report.' });
      }
      if (
        scanB.status !== 'completed' ||
        scanB.jsonReportPath === undefined ||
        !existsSync(scanB.jsonReportPath)
      ) {
        return reply.code(400).send({ error: 'Scan B does not have a completed report.' });
      }

      let rawA: JsonReportFile;
      let rawB: JsonReportFile;
      try {
        rawA = JSON.parse(await readFile(scanA.jsonReportPath, 'utf-8')) as JsonReportFile;
        rawB = JSON.parse(await readFile(scanB.jsonReportPath, 'utf-8')) as JsonReportFile;
      } catch {
        return reply.code(500).send({ error: 'Failed to read one or both report files.' });
      }

      const normalA = normalizeForDiff(rawA, scanA);
      const normalB = normalizeForDiff(rawB, scanB);
      const diff = diffReports(normalA, normalB);

      // Enrich all diff issues with WCAG criterion info
      const enrichedAdded = diff.added.map(enrichIssueWithWcag);
      const enrichedRemoved = diff.removed.map(enrichIssueWithWcag);
      const enrichedUnchanged = diff.unchanged.map(enrichIssueWithWcag);

      // Check if any issues have regulation tags
      const allIssues = [...enrichedAdded, ...enrichedRemoved, ...enrichedUnchanged];
      const hasRegulations = allIssues.some((i) => i.regulationTags !== undefined && i.regulationTags.length > 0);

      return reply.view('report-compare.hbs', {
        pageTitle: 'Compare Reports',
        currentPath: '/reports/compare',
        user: request.user,
        scanA: formatScanMeta(scanA),
        scanB: formatScanMeta(scanB),
        diff: {
          added: enrichedAdded,
          removed: enrichedRemoved,
          unchanged: enrichedUnchanged,
          addedCount: diff.added.length,
          removedCount: diff.removed.length,
          unchangedCount: diff.unchanged.length,
          summaryDelta: diff.summaryDelta,
          hasRegulations,
        },
      });
    },
  );
}

/**
 * registerDataTools — Dashboard MCP data tools (Phase 30, MCPT-01 + MCPT-02
 * brand-score retrieval half).
 *
 * Six org-scoped tools wrapping the dashboard's scan / report / issue
 * repositories and brand-score repository. Every handler reads orgId from
 * getCurrentToolContext() — NEVER from args (D-17). Every handler carries
 * an explicit "orgId: ctx.orgId (org-scoped — <rationale>)" inline
 * classification comment (kept on the line immediately above each
 * async handler so the Task 2 classification-coverage regex lands on
 * exactly six matches — see the six handlers below).
 * dashboard_scan_site is the only destructive tool in this plan
 * (D-03) and is the async entry point that kicks off the scan orchestrator
 * and returns immediately so MCP clients can poll dashboard_get_report
 * without timing out (D-02).
 *
 * Status-enum note: the dashboard persists scan status as
 * `'queued' | 'running' | 'completed' | 'failed'` (see ScanRecord in
 * ../../db/types.js). Plan 30-02 used the shorter `'complete'` literal in
 * its draft; that would have been an unconditional miss against stored
 * rows. The tool surface below uses the real enum value `'completed'`
 * everywhere (Rule 1 bug fix recorded in 30-02-SUMMARY.md).
 *
 * Coercion note: all numeric inputSchema fields use z.coerce.number() so
 * that LLM-produced string numerics (e.g. "10" from mcp-remote bridges)
 * are accepted without a type-validation error (fix: mcp-limit-string-coercion).
 */

import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StorageAdapter } from '../../db/index.js';
import type { ScanService } from '../../services/scan-service.js';

export const DATA_TOOL_NAMES = [
  'dashboard_scan_site',
  'dashboard_list_reports',
  'dashboard_get_report',
  'dashboard_query_issues',
  'dashboard_list_brand_scores',
  'dashboard_get_brand_score',
] as const;

export interface RegisterDataToolsOptions {
  readonly storage: StorageAdapter;
  readonly scanService: ScanService;
}

function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}

function errorEnvelope(msg: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
    isError: true,
  };
}

export function registerDataTools(server: McpServer, opts: RegisterDataToolsOptions): void {
  const { storage, scanService } = opts;

  // ---- dashboard_scan_site (destructive, async) ----
  server.registerTool(
    'dashboard_scan_site',
    {
      description:
        'Trigger an accessibility scan for a URL. Runs async — returns {scanId, status: "queued", url} immediately. Poll dashboard_get_report with the scanId for status. WARNING: this runs a real scan against the URL and may take minutes; downstream LLM quota is consumed by analyse/fix follow-ups.',
      inputSchema: z.object({
        siteUrl: z
          .string()
          .url()
          .describe('The website URL to scan (http:// or https://)'),
        standard: z
          .enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA'])
          .optional()
          .describe('WCAG level; defaults to WCAG2AA'),
      }),
      annotations: { destructiveHint: true, readOnlyHint: false },
    },
    // orgId: ctx.orgId (org-scoped — scan is recorded against caller's org via ScanService.initiateScan)
    async (args) => {
      const ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const result = await scanService.initiateScan(
        { siteUrl: args.siteUrl, standard: args.standard ?? 'WCAG2AA' },
        { orgId, username: ctx?.userId ?? 'system', complianceToken: '' },
      );
      if (result.ok === false) {
        return errorEnvelope(result.error);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { scanId: result.scanId, status: 'queued', url: args.siteUrl },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---- dashboard_list_reports ----
  server.registerTool(
    'dashboard_list_reports',
    {
      description:
        'List recent scan reports for the current org, ordered newest first. Use when the user asks "what did we scan recently" or before calling dashboard_get_report.',
      inputSchema: z.object({
        status: z
          .enum(['queued', 'running', 'completed', 'failed'])
          .optional()
          .describe('Filter by scan status'),
        limit: z
          .coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Page size (default 50)'),
        offset: z
          .coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Pagination offset'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — storage.scans.listScans filters by orgId at the SQL layer)
    async (args) => {
      const orgId = resolveOrgId();
      const rows = await storage.scans.listScans({
        orgId,
        ...(args.status !== undefined ? { status: args.status } : {}),
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ data: rows, meta: { count: rows.length } }, null, 2),
          },
        ],
      };
    },
  );

  // ---- dashboard_get_report ----
  server.registerTool(
    'dashboard_get_report',
    {
      description:
        'Get a scan report by scanId. Returns {status} plus the report when status=="completed". LLMs should call this repeatedly (polling) to track async scans started by dashboard_scan_site.',
      inputSchema: z.object({
        scanId: z.string().describe('Scan ID'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — scanService.getScanForOrg applies the cross-org guard)
    async (args) => {
      const orgId = resolveOrgId();
      const lookup = await scanService.getScanForOrg(args.scanId, orgId);
      if (lookup.ok === false) {
        return errorEnvelope(lookup.error);
      }
      if (lookup.scan.status !== 'completed') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { status: lookup.scan.status, scanId: args.scanId },
                null,
                2,
              ),
            },
          ],
        };
      }
      const report = await storage.scans.getReport(args.scanId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'completed',
                scanId: args.scanId,
                scan: lookup.scan,
                report,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---- dashboard_query_issues ----
  server.registerTool(
    'dashboard_query_issues',
    {
      description:
        'Query pa11y issues from a scan report by severity, WCAG standard, or rule code. Returns at most 500 issues.',
      inputSchema: z.object({
        scanId: z.string().describe('Scan ID'),
        type: z
          .enum(['error', 'warning', 'notice'])
          .optional()
          .describe('Issue severity'),
        codePrefix: z
          .string()
          .optional()
          .describe('Filter by pa11y code prefix, e.g. WCAG2AA.Principle1'),
        limit: z
          .coerce
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Max issues returned (default 100)'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — cross-org guard on scanId via scanService.getScanForOrg)
    async (args) => {
      const orgId = resolveOrgId();
      const lookup = await scanService.getScanForOrg(args.scanId, orgId);
      if (lookup.ok === false) {
        return errorEnvelope(lookup.error);
      }
      const report = await storage.scans.getReport(args.scanId);
      if (report === null) {
        return errorEnvelope('Report not available');
      }
      // Report shape from pa11y/orchestrator: either { issues: [...] } or
      // { results: [{ issues: [...] }] } (one-page vs multi-page scan).
      // Flatten defensively; corresponding test exercises both shapes.
      const rawIssues: Array<Record<string, unknown>> = Array.isArray(
        (report as Record<string, unknown>)['issues'],
      )
        ? ((report as Record<string, unknown>)['issues'] as Array<Record<string, unknown>>)
        : Array.isArray((report as Record<string, unknown>)['results'])
          ? (
              (report as Record<string, unknown>)[
                'results'
              ] as Array<{ issues?: Array<Record<string, unknown>> }>
            ).flatMap((r) => r.issues ?? [])
          : [];
      const filtered = rawIssues.filter((issue) => {
        if (args.type !== undefined && issue['type'] !== args.type) return false;
        if (args.codePrefix !== undefined) {
          const code = typeof issue['code'] === 'string' ? (issue['code'] as string) : '';
          if (!code.startsWith(args.codePrefix)) return false;
        }
        return true;
      });
      const limited = filtered.slice(0, args.limit ?? 100);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                data: limited,
                meta: { total: filtered.length, returned: limited.length },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---- dashboard_list_brand_scores ----
  server.registerTool(
    'dashboard_list_brand_scores',
    {
      description:
        'List the most recent brand score for every site assigned in the current org. Use before dashboard_get_brand_score when the user asks "show me our brand scores".',
      inputSchema: z.object({
        limit: z
          .coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Max entries (default 50)'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — storage.scans.getLatestPerSite + brandScores.getLatestForScan both keyed on caller's org)
    async (args) => {
      const orgId = resolveOrgId();
      const latestScans = await storage.scans.getLatestPerSite(orgId);
      const entries: Array<{
        scanId: string;
        siteUrl: string;
        computedAt: string | undefined;
        score: unknown;
      }> = [];
      const cap = args.limit ?? 50;
      for (const scan of latestScans) {
        const score = await storage.brandScores.getLatestForScan(scan.id);
        if (score === null) continue;
        entries.push({
          scanId: scan.id,
          siteUrl: scan.siteUrl,
          computedAt: scan.completedAt ?? undefined,
          score,
        });
        if (entries.length >= cap) break;
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { data: entries, meta: { count: entries.length } },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---- dashboard_get_brand_score ----
  server.registerTool(
    'dashboard_get_brand_score',
    {
      description:
        'Get the most recent brand score for a scan or site. Provide exactly one of scanId or siteUrl. Secrets are never returned.',
      inputSchema: z.object({
        scanId: z
          .string()
          .optional()
          .describe('Scan ID (mutually exclusive with siteUrl)'),
        siteUrl: z
          .string()
          .optional()
          .describe('Site URL (mutually exclusive with scanId)'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — cross-org guard on scanId; siteUrl path uses getHistoryForSite with caller's orgId)
    async (args) => {
      const orgId = resolveOrgId();
      const hasScanId = args.scanId !== undefined && args.scanId !== '';
      const hasSiteUrl = args.siteUrl !== undefined && args.siteUrl !== '';
      if (hasScanId === hasSiteUrl) {
        return errorEnvelope('Provide exactly one of scanId or siteUrl');
      }
      if (hasScanId) {
        const scanId = args.scanId as string;
        const lookup = await scanService.getScanForOrg(scanId, orgId);
        if (lookup.ok === false) {
          return errorEnvelope(lookup.error);
        }
        const score = await storage.brandScores.getLatestForScan(scanId);
        if (score === null) {
          return errorEnvelope('No brand score recorded for this scan');
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ scanId, score }, null, 2),
            },
          ],
        };
      }
      // siteUrl branch
      const siteUrl = args.siteUrl as string;
      const history = await storage.brandScores.getHistoryForSite(orgId, siteUrl, 1);
      if (history.length === 0) {
        return errorEnvelope('No brand score recorded for this site in the current org');
      }
      const entry = history[0];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                siteUrl,
                computedAt: entry?.computedAt,
                score: entry?.result,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

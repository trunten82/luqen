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
import type { ScanRecord } from '../../db/types.js';
import type { ScanService } from '../../services/scan-service.js';

/**
 * Slim projection of ScanRecord for list responses. Explicitly OMITS the
 * fields that blow the 1MB MCP tool-result cap when several rows are
 * returned:
 *
 *   - `jsonReport`       — stringified pa11y result, ~200KB per scan with
 *                          200+ issues. Belongs in dashboard_get_report.
 *   - `jsonReportPath`   — server filesystem path; MCP clients cannot
 *                          consume it and it leaks infrastructure detail.
 *   - `brandScore`       — ScanRecord type permits this field, but
 *                          listScans() never populates it (see
 *                          db/types.ts:60-77 — only getTrendData joins
 *                          brand_scores). Drop defensively.
 *
 * Everything else needed to pick a report is retained (id, siteUrl,
 * status, standard, createdAt, completedAt, counts). Discovered during
 * Phase 30 live Claude Desktop walkthrough.
 */
interface SlimScanReport {
  readonly id: string;
  readonly siteUrl: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly standard: string;
  readonly jurisdictions: string[];
  readonly regulations: string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly pagesScanned?: number;
  readonly totalIssues?: number;
  readonly errors?: number;
  readonly warnings?: number;
  readonly notices?: number;
  readonly confirmedViolations?: number;
  readonly orgId: string;
  readonly brandingGuidelineId?: string;
  readonly brandingGuidelineVersion?: number;
  readonly brandRelatedCount?: number;
}

function toSlimScanReport(scan: ScanRecord): SlimScanReport {
  // Immutable projection — build a fresh object, never mutate `scan`.
  // Spread then drop would still carry hidden fields through JSON.stringify
  // (e.g. `jsonReport` as enumerable string). Allowlist explicitly.
  const slim: SlimScanReport = {
    id: scan.id,
    siteUrl: scan.siteUrl,
    status: scan.status,
    standard: scan.standard,
    jurisdictions: scan.jurisdictions,
    regulations: scan.regulations,
    createdBy: scan.createdBy,
    createdAt: scan.createdAt,
    orgId: scan.orgId,
    ...(scan.completedAt !== undefined ? { completedAt: scan.completedAt } : {}),
    ...(scan.pagesScanned !== undefined ? { pagesScanned: scan.pagesScanned } : {}),
    ...(scan.totalIssues !== undefined ? { totalIssues: scan.totalIssues } : {}),
    ...(scan.errors !== undefined ? { errors: scan.errors } : {}),
    ...(scan.warnings !== undefined ? { warnings: scan.warnings } : {}),
    ...(scan.notices !== undefined ? { notices: scan.notices } : {}),
    ...(scan.confirmedViolations !== undefined
      ? { confirmedViolations: scan.confirmedViolations }
      : {}),
    ...(scan.brandingGuidelineId !== undefined
      ? { brandingGuidelineId: scan.brandingGuidelineId }
      : {}),
    ...(scan.brandingGuidelineVersion !== undefined
      ? { brandingGuidelineVersion: scan.brandingGuidelineVersion }
      : {}),
    ...(scan.brandRelatedCount !== undefined
      ? { brandRelatedCount: scan.brandRelatedCount }
      : {}),
  };
  return slim;
}

export const DATA_TOOL_NAMES = [
  'dashboard_scan_site',
  'dashboard_list_reports',
  'dashboard_get_report',
  'dashboard_query_issues',
  'dashboard_list_brand_scores',
  'dashboard_get_brand_score',
] as const;

/**
 * Per-call compliance token access. Resolved lazily so that the MCP-side
 * dashboard_scan_site can pass a real bearer through to scanService for
 * regulation tagging + incremental hashing. Returns null when no compliance
 * connection is configured (the scan still runs, regulation/jurisdiction
 * filtering is best-effort, matching dashboard UI behaviour when the
 * compliance service is offline).
 */
export type ComplianceAccess = () => Promise<{
  readonly baseUrl: string;
  readonly token: string;
} | null>;

export interface RegisterDataToolsOptions {
  readonly storage: StorageAdapter;
  readonly scanService: ScanService;
  /** Optional — when omitted, scans run with an empty compliance token (same as today). */
  readonly complianceAccess?: ComplianceAccess;
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
  const { storage, scanService, complianceAccess } = opts;

  // ---- dashboard_scan_site (destructive, async) ----
  // 1:1 surface parity with the dashboard scan form (07-P02 InitiateScanInput).
  // Power users can drive every scan knob the UI exposes — scanMode, regulation
  // tagging, jurisdictions, runner choice, incremental hashing, max-pages cap,
  // concurrency, custom headers, pa11y actions, and warning/notice inclusion.
  // The agent should always call dashboard_list_regulations / _list_jurisdictions
  // first to resolve real IDs — never fabricate names like "ADA" or "EAA"
  // as ids; the platform stores them as kebab-case slugs.
  server.registerTool(
    'dashboard_scan_site',
    {
      description:
        [
          'Trigger an accessibility scan for a URL. Runs async — returns {scanId, status: "queued", url} immediately. Poll dashboard_get_report with the scanId for status. WARNING: this runs a real scan against the URL and may take minutes; downstream LLM quota is consumed by analyse/fix follow-ups.',
          '',
          'Discovery first: before passing regulations[] or jurisdictions[], call dashboard_list_regulations and dashboard_list_jurisdictions to obtain valid IDs. Passing a name (e.g. "ADA") rather than an ID will silently produce a scan with no regulation tags.',
          '',
          'Standard: only WCAG 2.0 levels are accepted (WCAG2A/WCAG2AA/WCAG2AAA). The platform does not run WCAG 2.1 or 2.2 scans today; never claim a scan is using a newer version than what the runner supports.',
        ].join('\n'),
      inputSchema: z.object({
        siteUrl: z
          .string()
          .url()
          .describe('The website URL to scan (http:// or https://)'),
        standard: z
          .enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA'])
          .optional()
          .describe('WCAG level; defaults to WCAG2AA'),
        scanMode: z
          .enum(['single', 'site'])
          .optional()
          .describe(
            'single = scan only the given URL; site = crawl + scan up to maxPages (default site).',
          ),
        jurisdictions: z
          .array(z.string())
          .max(50)
          .optional()
          .describe(
            'Jurisdiction IDs to tag this scan with (max 50). Resolve via dashboard_list_jurisdictions.',
          ),
        regulations: z
          .array(z.string())
          .max(50)
          .optional()
          .describe(
            'Regulation IDs to tag this scan with (max 50). Resolve via dashboard_list_regulations. The compliance engine emits a regulation_matrix per regulation when scan completes.',
          ),
        concurrency: z
          .coerce
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Parallel page workers (1–10). Defaults to dashboard config.'),
        maxPages: z
          .coerce
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Crawl cap when scanMode=site (1–1000). Defaults to dashboard config.'),
        runner: z
          .enum(['htmlcs', 'axe'])
          .optional()
          .describe('Audit engine. htmlcs = HTML_CodeSniffer (default), axe = axe-core.'),
        incremental: z
          .boolean()
          .optional()
          .describe(
            'When true, skip pages whose content hash matches the previous scan. Requires a configured compliance connection.',
          ),
        includeWarnings: z
          .boolean()
          .optional()
          .describe('Include WCAG warnings in the result set (default true).'),
        includeNotices: z
          .boolean()
          .optional()
          .describe('Include WCAG notices in the result set (default true).'),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Custom HTTP headers to send on every request (e.g. {"Authorization":"Bearer xxx"} for protected sites).',
          ),
        actions: z
          .array(z.string())
          .optional()
          .describe(
            'Pa11y actions executed before scoring (e.g. ["click element #consent-accept","wait for path to be /home"]).',
          ),
      }),
      annotations: { destructiveHint: true, readOnlyHint: false },
    },
    // orgId: ctx.orgId (org-scoped — scan is recorded against caller's org via ScanService.initiateScan)
    async (args) => {
      const ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      // Resolve a service compliance token when the registry is wired in.
      // Failure is non-fatal — we still pass complianceToken: '' so the scan
      // record is created (regulation tagging and incremental hashing become
      // best-effort; same behaviour as the dashboard UI when compliance is
      // offline).
      let complianceToken = '';
      if (complianceAccess !== undefined) {
        try {
          const access = await complianceAccess();
          if (access !== null) complianceToken = access.token;
        } catch {
          // Swallow — handler still proceeds with empty token.
        }
      }
      const initiateInput: Parameters<typeof scanService.initiateScan>[0] = {
        siteUrl: args.siteUrl,
        standard: args.standard ?? 'WCAG2AA',
        ...(args.scanMode !== undefined ? { scanMode: args.scanMode } : {}),
        ...(args.jurisdictions !== undefined ? { jurisdictions: [...args.jurisdictions] } : {}),
        ...(args.regulations !== undefined ? { regulations: [...args.regulations] } : {}),
        ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
        ...(args.maxPages !== undefined ? { maxPages: args.maxPages } : {}),
        ...(args.runner !== undefined ? { runner: args.runner } : {}),
        ...(args.incremental !== undefined ? { incremental: args.incremental } : {}),
        ...(args.includeWarnings !== undefined ? { includeWarnings: args.includeWarnings } : {}),
        ...(args.includeNotices !== undefined ? { includeNotices: args.includeNotices } : {}),
        ...(args.headers !== undefined ? { headers: { ...args.headers } } : {}),
        ...(args.actions !== undefined ? { actions: [...args.actions] } : {}),
      };
      const result = await scanService.initiateScan(initiateInput, {
        orgId,
        username: ctx?.userId ?? 'system',
        complianceToken,
      });
      if (result.ok === false) {
        return errorEnvelope(result.error);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                scanId: result.scanId,
                status: 'queued',
                url: args.siteUrl,
                standard: args.standard ?? 'WCAG2AA',
                scanMode: args.scanMode ?? 'site',
                regulations: args.regulations ?? [],
                jurisdictions: args.jurisdictions ?? [],
              },
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
      const data = rows.map(toSlimScanReport);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ data, meta: { count: data.length } }, null, 2),
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

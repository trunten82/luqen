/**
 * registerFleetTools — Phase 62.4 cross-site MCP tools.
 *
 * Four tools for fleet-aware agentic workflows:
 *   - dashboard_list_fleet                 (reports.view)
 *   - dashboard_scan_summary_for_fleet     (reports.view)
 *   - dashboard_queue_bulk_fix             (admin.org, destructive)
 *   - dashboard_coordinated_pr_status      (reports.view)
 *
 * Each handler grabs ctx via getCurrentToolContext(); orgId defaults from
 * ctx.orgId. Cross-org scope (org_id override) is only honoured when the
 * caller's permission set includes admin.system — mirroring the
 * dual-permission branching in tools/admin.ts.
 *
 * dashboard_queue_bulk_fix reuses computeBulkFixCandidates() from
 * services/bulk-fix-candidates.ts so the dispatch logic stays in lockstep
 * with the /api/v1/bulk-fixes HTTP routes. Both audit events
 * (bulk_fix.created + bulk_fix.dispatched) fire on success, matching the
 * HTTP-route shape one-for-one (62.4 audit-coverage requirement).
 *
 * Phase 31.2 D-09 drift guard: every entry in DASHBOARD_FLEET_TOOL_METADATA
 * MUST declare a valid requiredPermission. Enforced by
 * tests/mcp/tool-metadata-drift.test.ts.
 */

import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { StorageAdapter } from '../../db/index.js';
import { computeBulkFixCandidates } from '../../services/bulk-fix-candidates.js';

export const FLEET_TOOL_NAMES = [
  'dashboard_list_fleet',
  'dashboard_scan_summary_for_fleet',
  'dashboard_queue_bulk_fix',
  'dashboard_coordinated_pr_status',
] as const;

export const DASHBOARD_FLEET_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'dashboard_list_fleet', requiredPermission: 'reports.view' },
  { name: 'dashboard_scan_summary_for_fleet', requiredPermission: 'reports.view' },
  {
    name: 'dashboard_queue_bulk_fix',
    requiredPermission: 'admin.org',
    destructive: true,
    // Mirrors dashboard_scan_site's confirmationTemplate (APER-02 dialog).
    // Kept ≤ 80 chars; criterion + scope are the load-bearing fields.
    confirmationTemplate: (args) => {
      const crit =
        typeof args['criterion'] === 'string' ? args['criterion'].trim() : '';
      const groupId =
        typeof args['group_id'] === 'string' ? args['group_id'].trim() : '';
      const teamId =
        typeof args['team_id'] === 'string' ? args['team_id'].trim() : '';
      const scope =
        teamId.length > 0
          ? ` for team ${teamId}`
          : groupId.length > 0
            ? ` for group ${groupId}`
            : '';
      return crit.length > 0
        ? `Queue + dispatch bulk fix for ${crit}${scope}`
        : 'Queue + dispatch bulk fix across the fleet';
    },
  },
  { name: 'dashboard_coordinated_pr_status', requiredPermission: 'reports.view' },
];

export interface RegisterFleetToolsOptions {
  readonly storage: StorageAdapter;
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

function okEnvelope(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function resolveOrgScope(args: {
  org_id?: string;
}): { orgId: string; ok: true } | { ok: false; error: string } {
  const ctx = getCurrentToolContext();
  const callerOrg = ctx?.orgId ?? '';
  const perms = ctx?.permissions ?? new Set<string>();
  if (args.org_id !== undefined && args.org_id !== '') {
    if (!perms.has('admin.system') && args.org_id !== callerOrg) {
      return {
        ok: false,
        error:
          'Forbidden: only admin.system callers may target a different org_id',
      };
    }
    return { ok: true, orgId: args.org_id };
  }
  if (callerOrg === '' || callerOrg === 'system') {
    return {
      ok: false,
      error: 'No caller org context — pass org_id (requires admin.system)',
    };
  }
  return { ok: true, orgId: callerOrg };
}

export function registerFleetTools(
  server: McpServer,
  opts: RegisterFleetToolsOptions,
): void {
  const { storage } = opts;

  // ======================================================================
  // dashboard_list_fleet (reports.view)
  // ======================================================================

  server.registerTool(
    'dashboard_list_fleet',
    {
      description:
        "List WordPress sites in the caller's org scope. org_id defaults to the caller's current org; admin.system holders may target any org. group_id (team_id) filters to sites whose latest scan belongs to that team's effective org scope. status filters wp_sites.status ('active' | 'stale' | 'all', default 'active').",
      inputSchema: z.object({
        org_id: z
          .string()
          .optional()
          .describe(
            "Target org (defaults to caller's). admin.system only when not the caller's own org.",
          ),
        group_id: z
          .string()
          .optional()
          .describe('Team id — filters the fleet to that team scope'),
        status: z
          .enum(['active', 'stale', 'all'])
          .optional()
          .describe("wp_sites.status filter (default 'active')"),
      }),
    },
    // orgId: ctx.orgId (org-scoped — admin.system may pass cross-org org_id; otherwise constrained to caller's org)
    async (args) => {
      const scope = resolveOrgScope(args);
      if (!scope.ok) return errorEnvelope(scope.error);
      const sites = await storage.wpSites.list({
        orgId: scope.orgId,
        status: args.status ?? 'active',
      });
      // Phase 62.4 — default group_id from the agent's per-conversation
      // group selection when the LLM omits it. Empty string / undefined
      // ctx.groupId means no default filter.
      const ctxGroupId = getCurrentToolContext()?.groupId;
      const effectiveGroupId =
        args.group_id !== undefined && args.group_id !== ''
          ? args.group_id
          : ctxGroupId !== undefined && ctxGroupId !== ''
            ? ctxGroupId
            : undefined;
      // Optional team-scope filter: include only sites whose URL is registered
      // under the team's effective org scope. We approximate "team scope" by
      // listing wp_sites for each of the team's linked orgs (home + linked
      // via team_org_links) and intersecting on site id.
      let filtered = sites;
      if (effectiveGroupId !== undefined && effectiveGroupId !== '') {
        const team = await storage.teams.getTeam(effectiveGroupId);
        if (team === null) return errorEnvelope(`Team "${effectiveGroupId}" not found`);
        const links = await storage.teamOrgLinks.listLinksForTeam(team.id);
        const scopeOrgIds = new Set<string>([
          team.orgId,
          ...links.map((l) => l.orgId),
        ]);
        const allowedIds = new Set<string>();
        for (const oid of scopeOrgIds) {
          const rows = await storage.wpSites.list({
            orgId: oid,
            status: args.status ?? 'active',
          });
          for (const s of rows) allowedIds.add(s.id);
        }
        filtered = sites.filter((s) => allowedIds.has(s.id));
      }
      return okEnvelope({
        data: filtered.map((s) => ({
          id: s.id,
          url: s.url,
          wp_version: s.wpVersion,
          plugin_version: s.pluginVersion,
          status: s.status,
          last_seen: s.lastSeenAt,
          org_id: s.orgId,
        })),
        meta: {
          count: filtered.length,
          orgId: scope.orgId,
          groupId: effectiveGroupId ?? null,
          statusFilter: args.status ?? 'active',
        },
      });
    },
  );

  // ======================================================================
  // dashboard_scan_summary_for_fleet (reports.view)
  // ======================================================================

  server.registerTool(
    'dashboard_scan_summary_for_fleet',
    {
      description:
        "For each site in the caller's org, return the count of issues in the latest completed scan matching the given criterion at-or-after `since`. Match rule: issue.wcagCriterion === criterion OR issue.code.startsWith(criterion). Sites with no matching issues are omitted.",
      inputSchema: z.object({
        criterion: z
          .string()
          .min(1)
          .describe('WCAG criterion id (e.g. "1.4.3") or code prefix'),
        since: z
          .string()
          .describe('ISO-8601 cutoff — only scans completed at-or-after this'),
        org_id: z
          .string()
          .optional()
          .describe('Override caller org (admin.system only)'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — admin.system may cross orgs; otherwise locked to caller's org)
    async (args) => {
      const scope = resolveOrgScope(args);
      if (!scope.ok) return errorEnvelope(scope.error);

      const sinceMs = Date.parse(args.since);
      if (Number.isNaN(sinceMs)) {
        return errorEnvelope(`Invalid "since" timestamp: ${args.since}`);
      }

      const latest = await storage.scans.getLatestPerSite(scope.orgId);
      interface Row {
        readonly site_id: string;
        readonly site_url: string;
        readonly last_seen_at: string;
        readonly count: number;
      }
      const rows: Row[] = [];
      for (const scan of latest) {
        const lastSeen = scan.completedAt ?? scan.createdAt;
        const lastSeenMs = Date.parse(lastSeen);
        if (Number.isNaN(lastSeenMs) || lastSeenMs < sinceMs) continue;
        const report = (await storage.scans.getReport(scan.id)) as {
          pages?: ReadonlyArray<{
            issues?: ReadonlyArray<{ code?: string; wcagCriterion?: string }>;
          }>;
        } | null;
        if (report === null || !Array.isArray(report.pages)) continue;
        let count = 0;
        for (const page of report.pages) {
          if (!Array.isArray(page.issues)) continue;
          for (const issue of page.issues) {
            if (issue.wcagCriterion === args.criterion) {
              count += 1;
              continue;
            }
            if (
              typeof issue.code === 'string' &&
              issue.code.startsWith(args.criterion)
            ) {
              count += 1;
            }
          }
        }
        if (count === 0) continue;
        rows.push({
          site_id: scan.id,
          site_url: scan.siteUrl,
          last_seen_at: lastSeen,
          count,
        });
      }
      return okEnvelope({
        data: rows,
        meta: {
          count: rows.length,
          orgId: scope.orgId,
          criterion: args.criterion,
          since: args.since,
        },
      });
    },
  );

  // ======================================================================
  // dashboard_queue_bulk_fix (admin.org — destructive)
  // ======================================================================

  server.registerTool(
    'dashboard_queue_bulk_fix',
    {
      description:
        "Create a bulk_fix for the given criterion and immediately dispatch it: every site matching the criterion in the caller's scope becomes a coordinated_pr leg. Returns { bulk_fix_id, coordinated_pr_id }. DESTRUCTIVE — opens PRs on every candidate site.",
      inputSchema: z.object({
        criterion: z
          .string()
          .min(1)
          .describe('WCAG criterion id (e.g. "1.4.3")'),
        group_id: z
          .string()
          .optional()
          .describe('Team id — bulk_fix scoped to this team'),
        team_id: z
          .string()
          .optional()
          .describe('Alias for group_id (preferred name in newer callers)'),
        summary: z
          .string()
          .max(2000)
          .optional()
          .describe('Optional human-readable summary'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — caller must hold admin.org on the resolved org; admin.system bypasses ownership check)
    async (args) => {
      const ctx = getCurrentToolContext();
      const perms = ctx?.permissions ?? new Set<string>();
      const callerOrg = ctx?.orgId ?? '';
      // Phase 62.4 — default team_id/group_id from the agent's per-conversation
      // group selection when the LLM omits both. ctx.groupId === '' means
      // user explicitly cleared the filter — treat as no default.
      const ctxGroupId = ctx?.groupId;
      const teamId =
        args.team_id ??
        args.group_id ??
        (ctxGroupId !== undefined && ctxGroupId !== '' ? ctxGroupId : null);

      let orgId: string;
      if (teamId !== null && teamId !== '') {
        const team = await storage.teams.getTeam(teamId);
        if (team === null) return errorEnvelope(`Team "${teamId}" not found`);
        orgId = team.orgId;
      } else {
        if (callerOrg === '' || callerOrg === 'system') {
          return errorEnvelope(
            'No caller org context — pass team_id or call with org context',
          );
        }
        orgId = callerOrg;
      }

      if (!perms.has('admin.system')) {
        if (!perms.has('admin.org')) {
          return errorEnvelope('Forbidden: admin.org required');
        }
        if (orgId !== callerOrg) {
          return errorEnvelope(
            "Forbidden: admin.org callers may only target their own org's teams",
          );
        }
      }

      const createdBy = ctx?.userId ?? 'mcp';
      const created = await storage.bulkFixes.create({
        orgId,
        teamId,
        createdBy,
        criterion: args.criterion,
        summary: args.summary,
      });

      await storage.audit.log({
        actor: createdBy,
        actorId: ctx?.userId,
        action: 'bulk_fix.created',
        resourceType: 'bulk_fix',
        resourceId: created.id,
        details: {
          org_id: orgId,
          team_id: teamId,
          criterion: created.criterion,
          summary: created.summary,
          via: 'mcp',
        },
        orgId,
      });

      const candidates = await computeBulkFixCandidates(storage, {
        id: created.id,
        orgId,
        teamId,
        criterion: args.criterion,
      });

      if (candidates.length === 0) {
        return errorEnvelope(
          'No matching sites found for the given criterion in scope — bulk_fix created but not dispatched',
        );
      }

      const cpr = await storage.coordinatedPrs.createCoordinatedPr({
        orgId,
        teamId,
        createdBy,
        summary: created.summary,
        legs: candidates.map((c) => ({ siteId: c.site_id })),
      });

      await storage.bulkFixes.markDispatched(created.id, cpr.pr.id);

      await storage.audit.log({
        actor: createdBy,
        actorId: ctx?.userId,
        action: 'bulk_fix.dispatched',
        resourceType: 'bulk_fix',
        resourceId: created.id,
        details: {
          org_id: orgId,
          team_id: teamId,
          coordinated_pr_id: cpr.pr.id,
          site_count: candidates.length,
          criterion: created.criterion,
          via: 'mcp',
        },
        orgId,
      });

      return okEnvelope({
        bulk_fix_id: created.id,
        coordinated_pr_id: cpr.pr.id,
        site_count: candidates.length,
      });
    },
  );

  // ======================================================================
  // dashboard_coordinated_pr_status (reports.view)
  // ======================================================================

  server.registerTool(
    'dashboard_coordinated_pr_status',
    {
      description:
        'Read a coordinated PR by id; returns { pr, legs }. Callers without admin.system can only read coordinated PRs that belong to their current org.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Coordinated PR id'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — admin.system reads any; others must own the coordinated_pr.orgId)
    async (args) => {
      const ctx = getCurrentToolContext();
      const perms = ctx?.permissions ?? new Set<string>();
      const callerOrg = ctx?.orgId ?? '';
      const found = await storage.coordinatedPrs.getCoordinatedPr(args.id);
      if (found === null) {
        return errorEnvelope(`coordinated_pr "${args.id}" not found`);
      }
      if (!perms.has('admin.system') && found.pr.orgId !== callerOrg) {
        return errorEnvelope(
          'Forbidden: caller may only read coordinated_prs in their own org',
        );
      }
      return okEnvelope({
        pr: found.pr,
        legs: found.legs,
      });
    },
  );
}

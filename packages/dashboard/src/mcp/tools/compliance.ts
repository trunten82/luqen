/**
 * registerComplianceTools — MCP discovery tools that proxy the compliance
 * service's reference-data endpoints.
 *
 * The agent + power-user MCP clients need parity with the dashboard UI, which
 * already lets users pick regulations and jurisdictions via lookup tables.
 * Without these tools, agents fabricate IDs (e.g. claiming "ADA" is a valid
 * regulation id) → scans run with empty regulations[] → scan record carries
 * no regulation tags → user sees "I scanned for ADA" but the report shows
 * none of the regulation matrix entries that would have been emitted. These
 * four tools close that gap.
 *
 * All four are read-only (no destructive side effects), gated by the
 * compliance.view permission, and execute via a complianceAccess() callback
 * resolved per-call so admin token rotation is picked up without restart.
 *
 * Implementation note: requirements (per-WCAG-criterion obligation rows) are
 * surfaced under the name dashboard_list_wcag_criteria because that is the
 * concept the agent reasons about — "what success criteria does regulation X
 * map to?". The compliance API endpoint is /api/v1/wcag-criteria and is
 * distinct from the per-regulation requirements list, but for an agent the
 * filter shape (regulationId → list of {wcagCriterion, level, obligation}) is
 * what matters. We expose this via listRequirements() in compliance-client.ts
 * with a regulationId filter.
 */

import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  listJurisdictions,
  listRegulations,
  listRequirements,
} from '../../compliance-client.js';

export const COMPLIANCE_TOOL_NAMES = [
  'dashboard_list_jurisdictions',
  'dashboard_list_regulations',
  'dashboard_get_regulation',
  'dashboard_list_wcag_criteria',
] as const;

/**
 * Per-call compliance access. Mirrors the type defined in tools/data.ts so
 * registerDataTools and registerComplianceTools share a single contract; both
 * obtain the live service token via ServiceClientRegistry at call time so
 * admin client-secret rotations are picked up without a server restart.
 */
export type ComplianceAccess = () => Promise<{
  readonly baseUrl: string;
  readonly token: string;
} | null>;

export interface RegisterComplianceToolsOptions {
  readonly complianceAccess: ComplianceAccess;
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

function okEnvelope(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

async function resolveAccess(
  complianceAccess: ComplianceAccess,
): Promise<{ baseUrl: string; token: string } | { error: string }> {
  try {
    const access = await complianceAccess();
    if (access === null) {
      return {
        error:
          'Compliance service is not configured. Ask an admin to set the compliance connection in dashboard service-connections.',
      };
    }
    return { baseUrl: access.baseUrl, token: access.token };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Compliance service unavailable: ${msg}` };
  }
}

export function registerComplianceTools(
  server: McpServer,
  opts: RegisterComplianceToolsOptions,
): void {
  const { complianceAccess } = opts;

  // ---- dashboard_list_jurisdictions ----
  server.registerTool(
    'dashboard_list_jurisdictions',
    {
      description:
        'List jurisdictions (e.g. US-CA, EU, GB) recognised by the compliance service. Use this BEFORE dashboard_scan_site when the user asks to tag a scan with a jurisdiction — pass the resolved id (not name) into scan_site jurisdictions[]. Includes both system seed data and any org-specific jurisdictions defined under the current org.',
      inputSchema: z.object({}),
    },
    // orgId: ctx.orgId (org-scoped — compliance API filters by X-Org-Id; system seed rows are always returned)
    async () => {
      const orgId = resolveOrgId();
      const access = await resolveAccess(complianceAccess);
      if ('error' in access) return errorEnvelope(access.error);
      try {
        const rows = await listJurisdictions(access.baseUrl, access.token, orgId);
        return okEnvelope({ data: rows, meta: { count: rows.length } });
      } catch (err) {
        return errorEnvelope(err instanceof Error ? err.message : 'Unknown error');
      }
    },
  );

  // ---- dashboard_list_regulations ----
  server.registerTool(
    'dashboard_list_regulations',
    {
      description:
        'List accessibility regulations (e.g. eaa-2025, us-ada-title-iii) tracked by the compliance service. Use this BEFORE dashboard_scan_site to obtain real regulation ids — never pass display names like "ADA" or "EAA". Optional jurisdictionId narrows results to a single jurisdiction; q matches against names. The returned id is what scan_site regulations[] expects.',
      inputSchema: z.object({
        jurisdictionId: z
          .string()
          .optional()
          .describe('Filter to a single jurisdiction id (resolve via dashboard_list_jurisdictions).'),
        q: z
          .string()
          .optional()
          .describe('Free-text name filter (case-insensitive substring).'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — compliance API filters by X-Org-Id; system seed rows are always returned)
    async (args) => {
      const orgId = resolveOrgId();
      const access = await resolveAccess(complianceAccess);
      if ('error' in access) return errorEnvelope(access.error);
      const filters: Record<string, string> = {};
      if (args.jurisdictionId !== undefined) filters['jurisdictionId'] = args.jurisdictionId;
      if (args.q !== undefined) filters['q'] = args.q;
      try {
        const rows = await listRegulations(
          access.baseUrl,
          access.token,
          Object.keys(filters).length > 0 ? filters : undefined,
          orgId,
        );
        return okEnvelope({ data: rows, meta: { count: rows.length } });
      } catch (err) {
        return errorEnvelope(err instanceof Error ? err.message : 'Unknown error');
      }
    },
  );

  // ---- dashboard_get_regulation ----
  server.registerTool(
    'dashboard_get_regulation',
    {
      description:
        'Get a single regulation by id, including scope, enforcement date, and jurisdiction. Use this to answer "what does regulation X cover?" before recommending a scan. Implemented as a filtered list on top of /api/v1/regulations, returning the matched row.',
      inputSchema: z.object({
        regulationId: z.string().describe('Regulation id (e.g. eaa-2025). Resolve via dashboard_list_regulations.'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — compliance API filters by X-Org-Id; system seed rows are always returned)
    async (args) => {
      const orgId = resolveOrgId();
      const access = await resolveAccess(complianceAccess);
      if ('error' in access) return errorEnvelope(access.error);
      try {
        // listRegulations supports an `id` filter on the compliance API; if the
        // server ignores unknown filters we still post-filter client-side.
        const rows = await listRegulations(
          access.baseUrl,
          access.token,
          { id: args.regulationId },
          orgId,
        );
        const match = rows.find((r) => r.id === args.regulationId);
        if (match === undefined) {
          return errorEnvelope(`Regulation "${args.regulationId}" not found`);
        }
        return okEnvelope(match);
      } catch (err) {
        return errorEnvelope(err instanceof Error ? err.message : 'Unknown error');
      }
    },
  );

  // ---- dashboard_list_wcag_criteria ----
  server.registerTool(
    'dashboard_list_wcag_criteria',
    {
      description:
        'List WCAG success criteria (requirements) — optionally filtered by regulationId — including obligation level (mandatory/recommended/optional) and the WCAG version + level the criterion belongs to. Use this to ground claims like "regulation X requires SC 1.4.3 at AA" with real platform data, and to answer "which criteria fail under regulation X" by cross-referencing with dashboard_query_issues codes.',
      inputSchema: z.object({
        regulationId: z
          .string()
          .optional()
          .describe('Filter to a single regulation. Resolve via dashboard_list_regulations.'),
        wcagLevel: z
          .enum(['A', 'AA', 'AAA'])
          .optional()
          .describe('Filter to a single conformance level.'),
        wcagVersion: z
          .string()
          .optional()
          .describe('Filter to a WCAG version string (e.g. "2.0", "2.1", "2.2"). Note: dashboard_scan_site only runs WCAG 2.0 — do not claim the agent can scan for newer versions even when criteria for 2.1/2.2 are listed here.'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — compliance API filters by X-Org-Id; system seed rows are always returned)
    async (args) => {
      const orgId = resolveOrgId();
      const access = await resolveAccess(complianceAccess);
      if ('error' in access) return errorEnvelope(access.error);
      const filters: Record<string, string> = {};
      if (args.regulationId !== undefined) filters['regulationId'] = args.regulationId;
      if (args.wcagLevel !== undefined) filters['wcagLevel'] = args.wcagLevel;
      if (args.wcagVersion !== undefined) filters['wcagVersion'] = args.wcagVersion;
      try {
        const rows = await listRequirements(
          access.baseUrl,
          access.token,
          Object.keys(filters).length > 0 ? filters : undefined,
          orgId,
        );
        return okEnvelope({ data: rows, meta: { count: rows.length } });
      } catch (err) {
        return errorEnvelope(err instanceof Error ? err.message : 'Unknown error');
      }
    },
  );
}

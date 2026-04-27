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
  // Server-side filter contract (compliance /api/v1/regulations): jurisdictionId,
  // status, scope. The `q` (name substring) and `id` filters are post-filtered
  // client-side here because the compliance API silently ignores unknown query
  // params (Fastify route schema is additionalProperties:true). Tool description
  // must reflect REAL behaviour — never advertise a filter the API does not
  // honour, otherwise the LLM trusts the response and may fabricate plausible
  // ids when the unfiltered payload (currently 73 system regulations) is too
  // noisy to summarise (regulations-fake-and-stuck-queue debug session).
  server.registerTool(
    'dashboard_list_regulations',
    {
      description:
        [
          'List accessibility regulations (e.g. EU-EAA, US-ADA, US-508) tracked by the compliance service.',
          'Use this BEFORE dashboard_scan_site to obtain REAL regulation ids — never pass display names like "ADA" or "EAA" to scan_site, and never invent kebab-case ids like "eaa-2025" or "euaa-2016". The platform stores ids exactly as returned here.',
          'Filters: jurisdictionId narrows by jurisdiction (resolve via dashboard_list_jurisdictions; e.g. "EU" returns only EU-EAA + EU-WAD). q is a case-insensitive substring match against name + shortName + id, applied client-side after the API call. When the user asks about a region (e.g. "EU regs"), prefer jurisdictionId over q for tight, deterministic results.',
        ].join(' '),
      inputSchema: z.object({
        jurisdictionId: z
          .string()
          .optional()
          .describe('Filter to a single jurisdiction id (resolve via dashboard_list_jurisdictions).'),
        q: z
          .string()
          .optional()
          .describe('Case-insensitive substring match on name, shortName, or id. Applied client-side.'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — compliance API filters by X-Org-Id; system seed rows are always returned)
    async (args) => {
      const orgId = resolveOrgId();
      const access = await resolveAccess(complianceAccess);
      if ('error' in access) return errorEnvelope(access.error);
      // Only forward server-supported filters; q is post-filtered below.
      const serverFilters: Record<string, string> = {};
      if (args.jurisdictionId !== undefined) serverFilters['jurisdictionId'] = args.jurisdictionId;
      try {
        const rows = await listRegulations(
          access.baseUrl,
          access.token,
          Object.keys(serverFilters).length > 0 ? serverFilters : undefined,
          orgId,
        );
        const filtered = args.q !== undefined
          ? (() => {
              const needle = args.q.toLowerCase();
              return rows.filter((r) => {
                const name = (r.name ?? '').toLowerCase();
                const shortName = (r.shortName ?? '').toLowerCase();
                const id = (r.id ?? '').toLowerCase();
                return name.includes(needle) || shortName.includes(needle) || id.includes(needle);
              });
            })()
          : rows;
        return okEnvelope({ data: filtered, meta: { count: filtered.length } });
      } catch (err) {
        return errorEnvelope(err instanceof Error ? err.message : 'Unknown error');
      }
    },
  );

  // ---- dashboard_get_regulation ----
  // Implemented as list-then-find because compliance /api/v1/regulations/:id
  // returns 404 for org-scoped clients on system rows under some configurations.
  // The list+find pattern uniformly returns system seed rows + org overrides.
  server.registerTool(
    'dashboard_get_regulation',
    {
      description:
        'Get a single regulation by id (case-sensitive), including scope, enforcement date, and jurisdiction. Use this to answer "what does regulation X cover?" before recommending a scan. Implemented as a filtered list + find — returns 404-style error if the id does not exist.',
      inputSchema: z.object({
        regulationId: z.string().describe('Regulation id (case-sensitive, e.g. EU-EAA, US-ADA). Resolve via dashboard_list_regulations.'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — compliance API filters by X-Org-Id; system seed rows are always returned)
    async (args) => {
      const orgId = resolveOrgId();
      const access = await resolveAccess(complianceAccess);
      if ('error' in access) return errorEnvelope(access.error);
      try {
        // No `id` filter on the compliance API — fetch the full set and find.
        const rows = await listRegulations(
          access.baseUrl,
          access.token,
          undefined,
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
  // Server-side filter contract (compliance /api/v1/requirements): regulationId,
  // wcagCriterion, obligation. wcagLevel and wcagVersion are post-filtered
  // client-side here — the compliance API silently ignores them (same root
  // cause as the regulations route).
  server.registerTool(
    'dashboard_list_wcag_criteria',
    {
      description:
        'List WCAG success criteria (requirements) — optionally filtered by regulationId — including obligation level (mandatory/recommended/optional) and the WCAG version + level the criterion belongs to. Use this to ground claims like "regulation X requires SC 1.4.3 at AA" with real platform data. wcagLevel + wcagVersion are post-filtered client-side after the API call.',
      inputSchema: z.object({
        regulationId: z
          .string()
          .optional()
          .describe('Filter to a single regulation. Resolve via dashboard_list_regulations.'),
        wcagLevel: z
          .enum(['A', 'AA', 'AAA'])
          .optional()
          .describe('Filter to a single conformance level. Applied client-side.'),
        wcagVersion: z
          .string()
          .optional()
          .describe('Filter to a WCAG version string (e.g. "2.0", "2.1", "2.2"). Applied client-side. Note: dashboard_scan_site only runs WCAG 2.0 — do not claim the agent can scan for newer versions even when criteria for 2.1/2.2 are listed here.'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — compliance API filters by X-Org-Id; system seed rows are always returned)
    async (args) => {
      const orgId = resolveOrgId();
      const access = await resolveAccess(complianceAccess);
      if ('error' in access) return errorEnvelope(access.error);
      // Only forward server-supported filters; wcagLevel + wcagVersion are post-filtered.
      const serverFilters: Record<string, string> = {};
      if (args.regulationId !== undefined) serverFilters['regulationId'] = args.regulationId;
      try {
        const rows = await listRequirements(
          access.baseUrl,
          access.token,
          Object.keys(serverFilters).length > 0 ? serverFilters : undefined,
          orgId,
        );
        const filtered = rows.filter((r) => {
          if (args.wcagLevel !== undefined && r.wcagLevel !== args.wcagLevel) return false;
          if (args.wcagVersion !== undefined && r.wcagVersion !== args.wcagVersion) return false;
          return true;
        });
        return okEnvelope({ data: filtered, meta: { count: filtered.length } });
      } catch (err) {
        return errorEnvelope(err instanceof Error ? err.message : 'Unknown error');
      }
    },
  );
}

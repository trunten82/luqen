/**
 * createBrandingMcpServer — MCP tool registry for the branding service.
 *
 * Phase 29 (MCPT-02 partial) populates this stub with 4 org-scoped tools
 * wrapping the existing REST guideline + match endpoints. Every tool reads
 * orgId from getCurrentToolContext() — NEVER from args (D-13). Every handler
 * carries an explicit org-scoped classification comment (see the inline
 * `orgId: ctx.orgId` comments above each async handler below). No TODO
 * deferrals.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { SqliteAdapter } from '../db/sqlite-adapter.js';
import { BrandingMatcher } from '../matcher/index.js';
import type { MatchableIssue } from '../types.js';
import { VERSION } from '../version.js';
import { BRANDING_TOOL_METADATA } from './metadata.js';

export { BRANDING_TOOL_METADATA } from './metadata.js';

const TOOL_NAMES = [
  'branding_list_guidelines',
  'branding_get_guideline',
  'branding_list_sites',
  'branding_match',
] as const;

// ---- Classification (MCPI-04 — no cross-org data leakage) ----
//
// All 4 branding tools are ORG-SCOPED. The SqliteAdapter persists guidelines,
// site assignments, and colors/fonts/selectors with an org_id column, and
// listGuidelines/getGuidelineForSite filter by org at the DB layer. Single-
// record lookups (getGuideline / getSiteAssignments via guideline lookup)
// enforce a cross-org guard in the tool handler: `guideline.orgId !== ctx.orgId`
// is treated as "not found".
//
// D-13 invariant: NO handler accepts `orgId` from `args`. Every orgId source
// is `getCurrentToolContext().orgId`. Runtime iteration test in the http
// integration suite proves this.

function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}

export interface BrandingMcpServerOptions {
  readonly db: SqliteAdapter;
}

export async function createBrandingMcpServer(
  options: BrandingMcpServerOptions,
): Promise<{
  server: McpServer;
  toolNames: readonly string[];
  metadata: typeof BRANDING_TOOL_METADATA;
}> {
  const { db } = options;

  const server = new McpServer(
    { name: 'luqen-branding', version: VERSION },
    { capabilities: { tools: {} } },
  );

  // ---- branding_list_guidelines ----
  server.registerTool(
    'branding_list_guidelines',
    {
      description: 'List all brand guidelines for the current org. Use when the user asks about brand setup or before calling branding_match.',
      inputSchema: z.object({}),
    },
    // orgId: ctx.orgId (org-scoped — returns caller-org guidelines via db.listGuidelines(orgId))
    async () => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const items = db.listGuidelines(orgId);
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    },
  );

  // ---- branding_get_guideline ----
  server.registerTool(
    'branding_get_guideline',
    {
      description: 'Get a single brand guideline by ID, including its colors, fonts, and selectors.',
      inputSchema: z.object({
        id: z.string().describe('Guideline ID'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — cross-org guard: guideline.orgId must match caller)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const guideline = db.getGuideline(args.id);
      if (guideline == null || guideline.orgId !== orgId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Guideline "${args.id}" not found` }) }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(guideline, null, 2) }] };
    },
  );

  // ---- branding_list_sites ----
  server.registerTool(
    'branding_list_sites',
    {
      description: 'List site URLs assigned to a brand guideline.',
      inputSchema: z.object({
        id: z.string().describe('Guideline ID'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — guards guideline.orgId before listing site assignments)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const guideline = db.getGuideline(args.id);
      if (guideline == null || guideline.orgId !== orgId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Guideline "${args.id}" not found` }) }],
          isError: true,
        };
      }
      const sites = db.getSiteAssignments(args.id);
      return { content: [{ type: 'text', text: JSON.stringify(sites, null, 2) }] };
    },
  );

  // ---- branding_match ----
  server.registerTool(
    'branding_match',
    {
      description: 'Match pa11y issues against a brand guideline. Returns per-issue brand correlations. This does not persist anything — run dashboard_scan_site (Phase 30) to persist.',
      inputSchema: z.object({
        issues: z.array(
          z.object({
            code: z.string(),
            type: z.enum(['error', 'warning', 'notice']),
            message: z.string(),
            selector: z.string(),
            context: z.string(),
          }),
        ).describe('Pa11y issues to match against the guideline'),
        siteUrl: z.string().optional().describe('Resolve guideline via site assignment if guidelineId not provided'),
        guidelineId: z.string().optional().describe('Explicit guideline ID (wins over siteUrl)'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — cross-org guard on explicit guidelineId; site lookup filtered by caller org)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();

      let guideline = args.guidelineId != null ? db.getGuideline(args.guidelineId) : null;
      // Cross-org guard: explicit ID resolving to another org is treated as null.
      if (guideline != null && guideline.orgId !== orgId) {
        guideline = null;
      }
      if (guideline == null && args.siteUrl != null) {
        guideline = db.getGuidelineForSite(args.siteUrl, orgId);
      }

      if (guideline == null || !guideline.active) {
        const payload = {
          data: args.issues.map((issue: MatchableIssue) => ({ issue, brandMatch: { matched: false } })),
          meta: { matched: 0, total: args.issues.length, guidelineId: null },
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      }

      const matcher = new BrandingMatcher();
      const branded = matcher.match(args.issues, guideline);
      const payload = {
        data: branded,
        meta: {
          matched: branded.filter((b) => b.brandMatch.matched).length,
          total: args.issues.length,
          guidelineId: guideline.id,
          guidelineName: guideline.name,
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    },
  );

  return { server, toolNames: [...TOOL_NAMES], metadata: BRANDING_TOOL_METADATA };
}

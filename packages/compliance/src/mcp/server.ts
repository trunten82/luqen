import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import { SqliteAdapter } from '../db/sqlite-adapter.js';
import { checkCompliance } from '../engine/checker.js';
import { proposeUpdate, approveUpdate } from '../engine/proposals.js';
import { seedBaseline } from '../seed/loader.js';
import type { DbAdapter } from '../db/adapter.js';
import { COMPLIANCE_TOOL_METADATA } from './metadata.js';

// Re-export metadata so api/routes/mcp.ts can import it directly from here.
export { COMPLIANCE_TOOL_METADATA } from './metadata.js';

// ---- Tool name constants ----

const TOOL_NAMES = [
  'compliance_check',
  'compliance_list_jurisdictions',
  'compliance_list_regulations',
  'compliance_list_requirements',
  'compliance_get_regulation',
  'compliance_propose_update',
  'compliance_get_pending',
  'compliance_approve_update',
  'compliance_list_sources',
  'compliance_add_source',
  'compliance_seed',
] as const;

// ---- Classification (MCPI-04 — no cross-org data leakage) ----
//
// IMPORTANT CLASSIFICATION NOTE (D-05, D-06):
// The compliance DbAdapter and its tables (jurisdictions, regulations,
// requirements, update_proposals, monitored_sources) all carry an `org_id`
// column. System-level (shared) records are stored with org_id='system';
// orgs may also add their own private records. The standard filter pattern
// across REST routes is: when a request carries an orgId, return
// `system + that org's records`, never other orgs' records.
//
// Therefore 8 of the 11 tools are ORG-SCOPED (inject ctx.orgId into filters)
// and 3 are GLOBAL (single-record lookup by ID, or a system-wide op):
//   ORG-SCOPED: compliance_check, compliance_list_jurisdictions,
//               compliance_list_regulations, compliance_list_requirements,
//               compliance_propose_update, compliance_get_pending,
//               compliance_list_sources, compliance_add_source
//   GLOBAL:     compliance_get_regulation (by ID — record's own org_id),
//               compliance_approve_update (by proposal ID),
//               compliance_seed (system-wide baseline seed)
//
// Every handler below carries an explicit classification comment. None defer
// to a future phase.
//
// D-05 invariant: NO handler accepts `orgId` from `args`. Every orgId source
// is `context.orgId` read via getCurrentToolContext(). When called over
// stdio (existing CLI), getCurrentToolContext() returns undefined and we
// fall back to 'system' — matching the pre-Phase-28 behaviour exactly.

function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}

// ---- Options ----

export interface McpServerOptions {
  readonly dbPath?: string;
  readonly db?: DbAdapter;
}

// ---- Factory ----

export async function createComplianceMcpServer(
  options: McpServerOptions = {},
): Promise<{
  server: McpServer;
  toolNames: readonly string[];
  metadata: typeof COMPLIANCE_TOOL_METADATA;
}> {
  // Initialize the DB adapter
  let db: DbAdapter;
  if (options.db != null) {
    db = options.db;
  } else {
    const dbPath = options.dbPath ?? process.env.COMPLIANCE_DB_PATH ?? './compliance.db';
    db = new SqliteAdapter(dbPath);
  }
  await db.initialize();

  const server = new McpServer({
    name: 'luqen-compliance',
    version: '1.0.0',
  });

  // ---- compliance_check ----
  server.registerTool(
    'compliance_check',
    {
      description: 'Check pa11y accessibility issues against jurisdiction legal requirements',
      inputSchema: z.object({
        jurisdictions: z.array(z.string()).describe('List of jurisdiction IDs to check (e.g. ["EU", "US"])'),
        issues: z.array(
          z.object({
            code: z.string(),
            type: z.string(),
            message: z.string(),
            selector: z.string(),
            context: z.string(),
            url: z.string().optional(),
          }),
        ).describe('Pa11y issues to check'),
        includeOptional: z.boolean().optional().describe('Include optional requirements (default: false)'),
        sectors: z.array(z.string()).optional().describe('Filter regulations by sector'),
      }),
    },
    // orgId: ctx.orgId (org-scoped — filters requirements by org + system records)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const result = await checkCompliance(
        {
          jurisdictions: args.jurisdictions,
          issues: args.issues,
          includeOptional: args.includeOptional,
          sectors: args.sectors,
        },
        db,
        orgId,
      );
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ---- compliance_list_jurisdictions ----
  server.registerTool(
    'compliance_list_jurisdictions',
    {
      description: 'List all jurisdictions with optional filters',
      inputSchema: z.object({
        type: z.enum(['supranational', 'country', 'state']).optional(),
        parentId: z.string().optional(),
      }),
    },
    // orgId: ctx.orgId (org-scoped — returns system + caller-org jurisdictions)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const items = await db.listJurisdictions({ ...args, orgId });
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    },
  );

  // ---- compliance_list_regulations ----
  server.registerTool(
    'compliance_list_regulations',
    {
      description: 'List regulations with optional filters',
      inputSchema: z.object({
        jurisdictionId: z.string().optional(),
        status: z.enum(['active', 'draft', 'repealed']).optional(),
        scope: z.enum(['public', 'private', 'all']).optional(),
      }),
    },
    // orgId: ctx.orgId (org-scoped — returns system + caller-org regulations)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const items = await db.listRegulations({ ...args, orgId });
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    },
  );

  // ---- compliance_list_requirements ----
  server.registerTool(
    'compliance_list_requirements',
    {
      description: 'List requirements with optional filters',
      inputSchema: z.object({
        regulationId: z.string().optional(),
        wcagCriterion: z.string().optional(),
        obligation: z.enum(['mandatory', 'recommended', 'optional']).optional(),
      }),
    },
    // orgId: ctx.orgId (org-scoped — returns system + caller-org requirements)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const items = await db.listRequirements({ ...args, orgId });
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    },
  );

  // ---- compliance_get_regulation ----
  server.registerTool(
    'compliance_get_regulation',
    {
      description: 'Get a single regulation by ID, including its requirements',
      inputSchema: z.object({
        id: z.string().describe('Regulation ID (e.g. "eu-eaa")'),
      }),
    },
    // orgId: N/A (global — single-record lookup by ID; enforcement check below)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const regulation = await db.getRegulation(args.id);
      if (regulation == null) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Regulation "${args.id}" not found` }) }],
          isError: true,
        };
      }
      // Cross-org leakage guard (MCPI-04): regulation must be system or match caller's org.
      if (regulation.orgId !== 'system' && regulation.orgId !== orgId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Regulation "${args.id}" not found` }) }],
          isError: true,
        };
      }
      const requirements = await db.listRequirements({ regulationId: args.id, orgId });
      const result = { ...regulation, requirements };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ---- compliance_propose_update ----
  server.registerTool(
    'compliance_propose_update',
    {
      description: 'Submit a proposed change to the compliance rule database',
      inputSchema: z.object({
        source: z.string().describe('URL or description of where the change was detected'),
        type: z.enum(['new_regulation', 'amendment', 'repeal', 'new_requirement', 'new_jurisdiction']),
        summary: z.string().describe('Human-readable description of the change'),
        proposedChanges: z.object({
          action: z.enum(['create', 'update', 'delete']),
          entityType: z.enum(['jurisdiction', 'regulation', 'requirement']),
          entityId: z.string().optional(),
          before: z.record(z.string(), z.unknown()).optional(),
          after: z.record(z.string(), z.unknown()).optional(),
        }),
        affectedRegulationId: z.string().optional(),
        affectedJurisdictionId: z.string().optional(),
      }),
    },
    // orgId: ctx.orgId (org-scoped — proposal is stamped with caller's org)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const proposal = await proposeUpdate(db, {
        source: args.source,
        type: args.type,
        summary: args.summary,
        proposedChanges: args.proposedChanges,
        affectedRegulationId: args.affectedRegulationId,
        affectedJurisdictionId: args.affectedJurisdictionId,
        orgId,
      });
      return { content: [{ type: 'text', text: JSON.stringify(proposal, null, 2) }] };
    },
  );

  // ---- compliance_get_pending ----
  server.registerTool(
    'compliance_get_pending',
    {
      description: 'List pending update proposals',
      inputSchema: z.object({}),
    },
    // orgId: ctx.orgId (org-scoped — returns system + caller-org proposals)
    async () => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const proposals = await db.listUpdateProposals({ status: 'pending', orgId });
      return { content: [{ type: 'text', text: JSON.stringify(proposals, null, 2) }] };
    },
  );

  // ---- compliance_approve_update ----
  server.registerTool(
    'compliance_approve_update',
    {
      description: 'Approve a pending update proposal and apply the proposed changes',
      inputSchema: z.object({
        id: z.string().describe('Proposal ID to approve'),
        reviewedBy: z.string().optional().describe('Reviewer identifier'),
      }),
    },
    // orgId: N/A (global — looked up by proposal ID; caller must already hold compliance.manage)
    async (args) => {
      const _ctx = getCurrentToolContext();
      // Approval is gated by compliance.manage permission at the tools/list
      // filter layer (COMPLIANCE_TOOL_METADATA). The proposal record itself
      // does not expose org_id on its public type; approval is effectively a
      // privileged operation on shared reference-data proposals.
      const existing = await db.getUpdateProposal(args.id);
      if (existing == null) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Proposal "${args.id}" not found` }) }],
          isError: true,
        };
      }
      const result = await approveUpdate(db, args.id, args.reviewedBy ?? 'mcp');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ---- compliance_list_sources ----
  server.registerTool(
    'compliance_list_sources',
    {
      description: 'List monitored legal sources',
      inputSchema: z.object({}),
    },
    // orgId: ctx.orgId (org-scoped — returns system + caller-org sources)
    async () => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const sources = await db.listSources({ orgId });
      return { content: [{ type: 'text', text: JSON.stringify(sources, null, 2) }] };
    },
  );

  // ---- compliance_add_source ----
  server.registerTool(
    'compliance_add_source',
    {
      description: 'Add a monitored legal source URL',
      inputSchema: z.object({
        name: z.string().describe('Display name for the source'),
        url: z.string().describe('URL to monitor'),
        type: z.enum(['html', 'rss', 'api']),
        schedule: z.enum(['daily', 'weekly', 'monthly']),
      }),
    },
    // orgId: ctx.orgId (org-scoped — new source is stamped with caller's org)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const source = await db.createSource({ ...args, orgId });
      return { content: [{ type: 'text', text: JSON.stringify(source, null, 2) }] };
    },
  );

  // ---- compliance_seed ----
  server.registerTool(
    'compliance_seed',
    {
      description: 'Load the baseline compliance dataset (idempotent)',
      inputSchema: z.object({}),
    },
    // orgId: N/A (global — system-wide baseline; inserts with org_id='system')
    async () => {
      const _ctx = getCurrentToolContext();
      await seedBaseline(db);
      const [jurisdictions, regulations, requirements] = await Promise.all([
        db.listJurisdictions(),
        db.listRegulations(),
        db.listRequirements(),
      ]);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              counts: {
                jurisdictions: jurisdictions.length,
                regulations: regulations.length,
                requirements: requirements.length,
              },
            }, null, 2),
          },
        ],
      };
    },
  );

  return { server, toolNames: [...TOOL_NAMES], metadata: COMPLIANCE_TOOL_METADATA };
}

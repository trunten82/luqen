import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SqliteAdapter } from '../db/sqlite-adapter.js';
import { checkCompliance } from '../engine/checker.js';
import { proposeUpdate, approveUpdate } from '../engine/proposals.js';
import { seedBaseline } from '../seed/loader.js';
import type { DbAdapter } from '../db/adapter.js';

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

// ---- Options ----

export interface McpServerOptions {
  readonly dbPath?: string;
  readonly db?: DbAdapter;
}

// ---- Factory ----

export async function createComplianceMcpServer(
  options: McpServerOptions = {},
): Promise<{ server: McpServer; toolNames: readonly string[] }> {
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
    name: 'pally-compliance',
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
    async (args) => {
      const result = await checkCompliance(
        {
          jurisdictions: args.jurisdictions,
          issues: args.issues,
          includeOptional: args.includeOptional,
          sectors: args.sectors,
        },
        db,
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
    async (args) => {
      const items = await db.listJurisdictions(args);
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
    async (args) => {
      const items = await db.listRegulations(args);
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
    async (args) => {
      const items = await db.listRequirements(args);
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
    async (args) => {
      const regulation = await db.getRegulation(args.id);
      if (regulation == null) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Regulation "${args.id}" not found` }) }],
          isError: true,
        };
      }
      const requirements = await db.listRequirements({ regulationId: args.id });
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
          before: z.record(z.unknown()).optional(),
          after: z.record(z.unknown()).optional(),
        }),
        affectedRegulationId: z.string().optional(),
        affectedJurisdictionId: z.string().optional(),
      }),
    },
    async (args) => {
      const proposal = await proposeUpdate(db, {
        source: args.source,
        type: args.type,
        summary: args.summary,
        proposedChanges: args.proposedChanges,
        affectedRegulationId: args.affectedRegulationId,
        affectedJurisdictionId: args.affectedJurisdictionId,
        detectedAt: new Date().toISOString(),
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
    async () => {
      const proposals = await db.listUpdateProposals({ status: 'pending' });
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
    async (args) => {
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
    async () => {
      const sources = await db.listSources();
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
    async (args) => {
      const source = await db.createSource(args);
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
    async () => {
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

  return { server, toolNames: [...TOOL_NAMES] };
}

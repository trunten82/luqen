/**
 * createLlmMcpServer — MCP tool registry for the LLM service.
 *
 * Phase 29 (MCPT-03) populates this stub with 4 global tools wrapping the
 * existing capability executors (generate-fix, analyse-report,
 * discover-branding, extract-requirements). Every tool is a thin protocol
 * adapter — no new fallback logic, no new validation, no new error
 * envelopes (D-09). Every handler carries an explicit one-line
 * classification marker immediately above the async handler body stating
 * the orgId disposition for that tool (all 4 are GLOBAL — see the block
 * comment below the imports for the full rationale).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { DbAdapter } from '../db/adapter.js';
import type { ProviderType } from '../types.js';
import { createAdapter } from '../providers/registry.js';
import { executeExtractRequirements } from '../capabilities/extract-requirements.js';
import { executeGenerateFix } from '../capabilities/generate-fix.js';
import { executeAnalyseReport } from '../capabilities/analyse-report.js';
import { executeDiscoverBranding } from '../capabilities/discover-branding.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../capabilities/types.js';
import { VERSION } from '../version.js';
import { LLM_TOOL_METADATA } from './metadata.js';

export { LLM_TOOL_METADATA } from './metadata.js';

const TOOL_NAMES = [
  'llm_generate_fix',
  'llm_analyse_report',
  'llm_discover_branding',
  'llm_extract_requirements',
] as const;

// ---- Classification (MCPI-04 — no cross-org data leakage) ----
//
// All 4 LLM tools are GLOBAL. The LLM service has no org-scoped tables
// whose rows could leak across orgs — the DB is a provider/model/prompt
// registry. Tool inputs are supplied by the caller; outputs are derived
// from the LLM provider response. orgId is resolved via
// getCurrentToolContext() and passed to the capability executor only so
// per-org prompt overrides (if any) apply — NOT as a data-filtering
// parameter.
//
// D-13 invariant: NO handler accepts `orgId` from `args`. Every orgId
// source is `getCurrentToolContext().orgId`. Runtime iteration test in the
// http integration suite proves this.

function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}

function mapCapabilityError(err: unknown): string {
  if (err instanceof CapabilityNotConfiguredError) return err.message;
  if (err instanceof CapabilityExhaustedError) return err.message;
  return 'Upstream LLM error';
}

export interface LlmMcpServerOptions {
  readonly db: DbAdapter;
}

export async function createLlmMcpServer(
  options: LlmMcpServerOptions,
): Promise<{
  server: McpServer;
  toolNames: readonly string[];
  metadata: typeof LLM_TOOL_METADATA;
}> {
  const { db } = options;
  const adapterFactory = (type: string) => createAdapter(type as ProviderType);

  const server = new McpServer(
    { name: 'luqen-llm', version: VERSION },
    { capabilities: { tools: {} } },
  );

  // ---- llm_generate_fix ----
  server.registerTool(
    'llm_generate_fix',
    {
      description: 'Generate an AI fix suggestion for a WCAG accessibility issue. Returns fixed HTML, explanation, and effort estimate. Falls back to 50 hardcoded patterns when the LLM provider is unavailable (D-09).',
      inputSchema: z.object({
        wcagCriterion: z.string().describe('WCAG success criterion (e.g. "1.1.1 Non-text Content")'),
        issueMessage: z.string().describe('Accessibility issue description from the scanner'),
        htmlContext: z.string().describe('HTML snippet containing the problematic element'),
        cssContext: z.string().optional().describe('Optional: relevant CSS for the element'),
      }),
    },
    // orgId: N/A (global — inputs supplied by caller; orgId used only for per-org prompt overrides)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      try {
        const capResult = await executeGenerateFix(db, adapterFactory, {
          wcagCriterion: args.wcagCriterion,
          issueMessage: args.issueMessage,
          htmlContext: args.htmlContext,
          ...(args.cssContext != null ? { cssContext: args.cssContext } : {}),
          orgId,
        });
        const payload = {
          ...capResult.data,
          model: capResult.model,
          provider: capResult.provider,
          attempts: capResult.attempts,
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: mapCapabilityError(err) }) }],
          isError: true,
        };
      }
    },
  );

  // ---- llm_analyse_report ----
  server.registerTool(
    'llm_analyse_report',
    {
      description: 'Generate an AI executive summary for a scan report. Returns summary, key findings, priorities, and recurring patterns.',
      inputSchema: z.object({
        siteUrl: z.string().describe('URL of the scanned site'),
        totalIssues: z.number().describe('Total issue count from the scan'),
        issuesList: z.array(
          z.object({
            criterion: z.string(),
            message: z.string(),
            count: z.number(),
            level: z.string(),
          }),
        ).describe('Top issues from the scan'),
        complianceSummary: z.string().optional().describe('Optional: compliance matrix summary text'),
        recurringPatterns: z.array(z.string()).optional().describe('Optional: recurring criteria from prior scans'),
      }),
    },
    // orgId: N/A (global — inputs supplied by caller; orgId used only for per-org prompt overrides)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      try {
        const capResult = await executeAnalyseReport(db, adapterFactory, {
          siteUrl: args.siteUrl,
          totalIssues: args.totalIssues,
          issuesList: args.issuesList,
          complianceSummary: args.complianceSummary ?? '',
          recurringPatterns: args.recurringPatterns ?? [],
          orgId,
        });
        const payload = {
          ...capResult.data,
          model: capResult.model,
          provider: capResult.provider,
          attempts: capResult.attempts,
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: mapCapabilityError(err) }) }],
          isError: true,
        };
      }
    },
  );

  // ---- llm_discover_branding ----
  server.registerTool(
    'llm_discover_branding',
    {
      description: 'Auto-detect brand colors, fonts, and logo from a URL. Runs via the LLM service (D-08 — not branding MCP). Returns colors, fonts, logoUrl, brandName, and description.',
      inputSchema: z.object({
        url: z.string().describe('URL to fetch and analyse for brand signals (http/https)'),
      }),
    },
    // orgId: N/A (global — inputs supplied by caller; orgId used only for per-org prompt overrides)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      if (!args.url.startsWith('http://') && !args.url.startsWith('https://')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'url must be a valid http/https URL' }) }],
          isError: true,
        };
      }
      try {
        const capResult = await executeDiscoverBranding(db, adapterFactory, {
          url: args.url,
          orgId,
        });
        const payload = {
          ...capResult.data,
          model: capResult.model,
          provider: capResult.provider,
          attempts: capResult.attempts,
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: mapCapabilityError(err) }) }],
          isError: true,
        };
      }
    },
  );

  // ---- llm_extract_requirements ----
  server.registerTool(
    'llm_extract_requirements',
    {
      description: 'Extract structured requirements from a regulation document. Returns an array of requirement objects (Phase 2 capability).',
      inputSchema: z.object({
        content: z.string().describe('Full text of the regulation document'),
        regulationId: z.string().describe('Unique identifier for the regulation (e.g. "wcag-2.2")'),
        regulationName: z.string().describe('Human-readable regulation name'),
        jurisdictionId: z.string().optional().describe('Optional jurisdiction ID'),
      }),
    },
    // orgId: N/A (global — inputs supplied by caller; orgId used only for per-org prompt overrides)
    async (args) => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      try {
        const capResult = await executeExtractRequirements(db, adapterFactory, {
          content: args.content,
          regulationId: args.regulationId,
          regulationName: args.regulationName,
          ...(args.jurisdictionId != null ? { jurisdictionId: args.jurisdictionId } : {}),
          orgId,
        });
        const payload = {
          ...capResult.data,
          model: capResult.model,
          provider: capResult.provider,
          attempts: capResult.attempts,
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: mapCapabilityError(err) }) }],
          isError: true,
        };
      }
    },
  );

  return { server, toolNames: [...TOOL_NAMES], metadata: LLM_TOOL_METADATA };
}

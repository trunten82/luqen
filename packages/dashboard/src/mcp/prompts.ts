/**
 * registerPrompts — Dashboard MCP Prompts (Phase 30 plan 30-05, MCPI-06).
 *
 * Three chat-message template prompts locked by 29-CONTEXT.md D-12 and
 * 30-CONTEXT.md D-13 through D-15:
 *
 *   /scan    — ask the LLM to scan a site and summarise top issues
 *   /report  — ask the LLM to summarise an existing scan report
 *   /fix     — ask the LLM to generate a code-fix for a specific WCAG issue
 *
 * Each prompt returns ONE user message whose text begins with a tool-aware
 * system preamble ("System: ...\n\nUser: ..."). The MCP 1.27.1 SDK's
 * PromptMessageSchema does NOT include a 'system' role — so we embed the
 * preamble in the user message text instead. Behaviour matches D-15 (tool-
 * aware, not tool-prescriptive) — the LLM, not the prompt, picks which
 * tools to invoke and in what order.
 *
 * D-17 invariant: NO argsSchema on any prompt contains an org-id field.
 * orgId is sourced from the JWT via the ToolContext ALS at tool-invocation
 * time — never from caller-supplied prompt arguments.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const DASHBOARD_PROMPT_NAMES = ['scan', 'report', 'fix'] as const;

/**
 * Tool-aware system preamble embedded at the start of each prompt's user
 * message. Enumerates cross-service tools but does NOT prescribe sequencing
 * (D-15). Listing tools here does NOT imply the caller is authorised to
 * invoke them — permission enforcement happens at tool-invocation via
 * resolveEffectivePermissions (Phase 28 D-03).
 */
const SYSTEM_PREAMBLE =
  'You are a WCAG compliance assistant in the Luqen dashboard. Available tools across services:\n' +
  '  - dashboard_scan_site (trigger new accessibility scan)\n' +
  '  - dashboard_list_reports, dashboard_get_report, dashboard_query_issues (read scan results)\n' +
  '  - dashboard_list_brand_scores, dashboard_get_brand_score (read brand scores)\n' +
  '  - llm_analyse_report (LLM summary of a report)\n' +
  '  - llm_generate_fix (LLM code-fix for a specific WCAG issue)\n' +
  '  - branding_match, branding_list_guidelines, branding_get_guideline (brand guideline lookups)\n' +
  'Pick appropriate tools when the user asks a question; you are not required to follow any specific sequence. Permission enforcement happens at tool-invocation time.';

function renderUserMessage(userTask: string): {
  role: 'user';
  content: { type: 'text'; text: string };
} {
  return {
    role: 'user',
    content: {
      type: 'text',
      text: `System: ${SYSTEM_PREAMBLE}\n\nUser: ${userTask}`,
    },
  };
}

export function registerPrompts(server: McpServer): void {
  // ------------------------------------------------------------------
  // /scan  —  trigger an accessibility scan + summary
  // ------------------------------------------------------------------
  server.registerPrompt(
    'scan',
    {
      title: 'Scan a site',
      description: 'Scan a website for WCAG compliance and summarize the top issues.',
      argsSchema: {
        siteUrl: z.string().describe('The website URL to scan'),
        standard: z
          .enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA'])
          .optional()
          .describe('WCAG level: WCAG2A, WCAG2AA, or WCAG2AAA — defaults to WCAG2AA'),
      },
    },
    // orgId: N/A (global — prompt templates are client-facing; tool calls triggered by the prompt source orgId from JWT via ToolContext ALS at invocation time)
    (args) => {
      const standard = args.standard ?? 'WCAG2AA';
      const userTask = `Scan ${args.siteUrl} for WCAG ${standard} compliance and summarize the top 5 issues.`;
      return { messages: [renderUserMessage(userTask)] };
    },
  );

  // ------------------------------------------------------------------
  // /report  —  summarise an existing scan report
  // ------------------------------------------------------------------
  server.registerPrompt(
    'report',
    {
      title: 'Summarize a scan report',
      description:
        'Summarize a scan report with executive-level findings grouped by WCAG principle and severity.',
      argsSchema: {
        scanId: z
          .string()
          .describe('Scan ID returned from dashboard_scan_site or dashboard_list_reports'),
      },
    },
    // orgId: N/A (global — prompt templates are client-facing; tool calls triggered by the prompt source orgId from JWT via ToolContext ALS at invocation time)
    (args) => {
      const userTask = `Retrieve the scan report for ${args.scanId} and summarise findings grouped by WCAG principle and severity.`;
      return { messages: [renderUserMessage(userTask)] };
    },
  );

  // ------------------------------------------------------------------
  // /fix  —  generate a code-fix suggestion for a WCAG issue
  // ------------------------------------------------------------------
  server.registerPrompt(
    'fix',
    {
      title: 'Generate a fix for an issue',
      description: 'Generate an AI code-fix suggestion for a specific WCAG issue.',
      argsSchema: {
        issueId: z
          .string()
          .describe(
            'The pa11y issue code, e.g. WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
          ),
        scanId: z.string().optional().describe('Scan context for the issue'),
      },
    },
    // orgId: N/A (global — prompt templates are client-facing; tool calls triggered by the prompt source orgId from JWT via ToolContext ALS at invocation time)
    (args) => {
      const scanSuffix =
        args.scanId != null && args.scanId !== '' ? ` in scan ${args.scanId}` : '';
      const userTask = `Generate a code fix for WCAG issue ${args.issueId}${scanSuffix}. Include the exact HTML/CSS change and why it resolves the criterion.`;
      return { messages: [renderUserMessage(userTask)] };
    },
  );
}

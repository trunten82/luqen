/**
 * registerFixTools — MCP fix generation tool that proxies the LLM service.
 *
 * Provides the `dashboard_generate_fix` tool: calls the llm service's
 * POST /api/v1/generate-fix endpoint, enriches the response with a legal
 * context block from the compliance service, and appends a conservative
 * draft disclaimer.
 *
 * Non-destructive (D-09): output is a draft for human review only.
 * No apply/write path, no auto-merge, no file writes.
 *
 * Security:
 *   T-80-06: orgId resolved from getCurrentToolContext() only, never from args.
 *   T-80-08: DRAFT_DISCLAIMER on every successful response (D-10).
 *   D-06: legalContext: null on compliance failure — never isError.
 */

import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { checkCompliance } from '../../compliance-client.js';

// ── Constants (D-10) ─────────────────────────────────────────────────────────

/**
 * Conservative draft disclaimer (D-10). Included in every fix response.
 * Frames output as a good-faith draft for human review only.
 */
export const DRAFT_DISCLAIMER =
  'This is a good-faith remediation draft for human review. ' +
  'It does not guarantee WCAG conformance, legal compliance, or protection from legal action. ' +
  'Review, test, and merge manually.';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Per-call LLM service access. Mirrors ComplianceAccess so both access
 * callbacks follow the same nullable-graceful-degrade contract.
 */
export type LlmAccess = () => Promise<{
  readonly baseUrl: string;
  readonly token: string;
} | null>;

/**
 * Per-call compliance access. Re-exported alias for callers that wire both
 * access callbacks in one place (mirrors tools/compliance.ts).
 */
export type ComplianceAccess = () => Promise<{
  readonly baseUrl: string;
  readonly token: string;
} | null>;

export interface RegisterFixToolsOptions {
  readonly llmAccess: LlmAccess;
  readonly complianceAccess?: ComplianceAccess;
}

export const FIX_TOOL_NAMES = ['dashboard_generate_fix'] as const;

// ── Shared helpers (copied verbatim from compliance.ts lines 62-83) ──────────

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

// ── resolveAccess graceful-degrade (compliance.ts lines 85-101) ──────────────

async function resolveLlmAccess(
  llmAccess: LlmAccess,
): Promise<{ baseUrl: string; token: string } | { error: string }> {
  try {
    const access = await llmAccess();
    if (access === null) {
      return {
        error:
          'LLM service is not configured. Ask an admin to set the LLM connection in dashboard service-connections.',
      };
    }
    return { baseUrl: access.baseUrl, token: access.token };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { error: `LLM service unavailable: ${msg}` };
  }
}

// ── LLM HTTP error mapping (mirrors mapCapabilityError in llm/src/mcp/server.ts) ──

function mapLlmHttpError(status: number): string {
  if (status === 503) return 'LLM capability not configured on the server.';
  if (status === 504) return 'LLM provider exhausted retry budget.';
  if (status === 400) return 'Invalid fix request parameters.';
  return `Upstream LLM error (HTTP ${status})`;
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerFixTools(
  server: McpServer,
  opts: RegisterFixToolsOptions,
): void {
  const { llmAccess, complianceAccess } = opts;

  // ---- dashboard_generate_fix ----
  server.registerTool(
    'dashboard_generate_fix',
    {
      description:
        [
          'Generate an AI-powered remediation draft for a WCAG accessibility issue.',
          'Returns the fixed HTML snippet, a unified diff, WCAG criterion, effort estimate, legal context (EU/US by default), and a conservative draft disclaimer.',
          'Output is a DRAFT for human review — never auto-applied.',
          'Non-destructive: no file writes, no code commits. The caller must review, test, and merge manually.',
        ].join(' '),
      inputSchema: z.object({
        wcagCriterion: z
          .string()
          .describe('WCAG success criterion (e.g. "1.1.1 Non-text Content")'),
        issueMessage: z
          .string()
          .describe('Accessibility issue description from the scanner'),
        htmlContext: z
          .string()
          .describe('HTML snippet containing the problematic element'),
        cssContext: z
          .string()
          .optional()
          .describe('Optional: relevant CSS for the element'),
        jurisdictions: z
          .array(z.string())
          .optional()
          .describe('Jurisdiction ids for legal context (default ["EU","US"])'),
        platform: z
          .enum(['html', 'wordpress-gutenberg'])
          .optional()
          .describe('Target platform (default: html)'),
      }),
      annotations: { destructiveHint: false, readOnlyHint: true },
    },
    // orgId: ctx.orgId — used only for per-org prompt overrides forwarded to llm; no org-scoped data read in dashboard
    async (args) => {
      const orgId = resolveOrgId();

      // Resolve LLM access — hard error if not configured
      const llm = await resolveLlmAccess(llmAccess);
      if ('error' in llm) return errorEnvelope(llm.error);

      const { wcagCriterion, issueMessage, htmlContext, cssContext, platform } = args;
      const jurisdictions = args.jurisdictions ?? ['EU', 'US'];

      // Call the LLM service generate-fix endpoint (Plan 01 extended)
      let fixResult: {
        fixedHtml?: string;
        explanation?: string;
        effort?: string;
        wcagCriterion?: string;
        diff?: string;
      };

      try {
        const llmResponse = await fetch(`${llm.baseUrl}/api/v1/generate-fix`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${llm.token}`,
          },
          body: JSON.stringify({
            wcagCriterion,
            issueMessage,
            htmlContext,
            ...(cssContext !== undefined ? { cssContext } : {}),
            ...(platform !== undefined ? { platform } : {}),
            orgId,
          }),
        });

        if (!llmResponse.ok) {
          return errorEnvelope(mapLlmHttpError(llmResponse.status));
        }

        fixResult = (await llmResponse.json()) as typeof fixResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return errorEnvelope(`LLM service unreachable: ${msg}`);
      }

      // Enrich with legal context from compliance service (D-06)
      // Failure degrades to legalContext: null — never sets isError.
      let legalContext: unknown = null;

      if (complianceAccess !== undefined) {
        try {
          const complianceAccess_ = complianceAccess;
          const accessResult = await complianceAccess_();
          if (accessResult !== null) {
            const enrichment = await checkCompliance(
              accessResult.baseUrl,
              accessResult.token,
              jurisdictions,
              [],
              [
                {
                  code: wcagCriterion,
                  type: 'error',
                  message: issueMessage,
                  selector: '',
                  context: htmlContext,
                },
              ],
              orgId,
            );
            legalContext = enrichment;
          }
        } catch {
          // Graceful degrade — legalContext remains null
          legalContext = null;
        }
      }

      return okEnvelope({
        wcagCriterion: fixResult.wcagCriterion ?? wcagCriterion,
        diff: fixResult.diff ?? null,
        fixedHtml: fixResult.fixedHtml ?? null,
        explanation: fixResult.explanation ?? null,
        effort: fixResult.effort ?? null,
        legalContext,
        disclaimer: DRAFT_DISCLAIMER,
      });
    },
  );
}

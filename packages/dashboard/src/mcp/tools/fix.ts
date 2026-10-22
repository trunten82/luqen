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
 * Entitlement (phase 93, D-01/D-02): LLM output reaches only a caller whose
 * ToolContext.permissions holds llm.view, the same rule the report page's
 * fix-suggestion route applies. A caller with issues.fix but without llm.view
 * keeps the tool and receives the deterministic pattern hint (getFixSuggestion,
 * source "pattern"); the LLM credentials are not resolved and the LLM service
 * is not called for them. A call with no tool context is treated as not
 * entitled (fail closed).
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
import { getFixSuggestion } from '../../fix-suggestions.js';
import { extractCriterion } from '../../routes/wcag-enrichment.js';

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

// ── Entitlement (D-01, D-02) ─────────────────────────────────────────────────

/** Permission that entitles a caller to LLM-generated fix output. */
const AI_FIX_PERMISSION = 'llm.view';

const AI_FIX_PERMISSION_SENTENCE =
  'AI-generated fix drafts need the llm.view permission.';

/** Note on a pattern answer that found a matching hint. */
export const PATTERN_HINT_NOTE =
  'This is a pattern-based hint, not an AI-generated fix. ' + AI_FIX_PERMISSION_SENTENCE;

/** Note on a pattern answer when no pattern matches the issue. */
export const PATTERN_NO_MATCH_NOTE =
  'No pattern-based hint matches this issue. ' + AI_FIX_PERMISSION_SENTENCE;

/**
 * True only when the caller's tool context holds llm.view. A missing context
 * (or a context without a permission set) is not entitled: fail closed, the
 * same outcome as the report route's hasPermission when no set is attached.
 */
export function mayReceiveAiFix(
  ctx: { readonly permissions?: ReadonlySet<string> } | undefined,
): boolean {
  return ctx?.permissions?.has(AI_FIX_PERMISSION) === true;
}

/**
 * Turn the tool's wcagCriterion input into the dotted code getFixSuggestion
 * expects: a leading dotted N.N.N token ("1.1.1 Non-text Content" -> "1.1.1"),
 * else the criterion inside an underscore pa11y code, else the trimmed input.
 */
export function toDottedCriterion(input: string): string {
  const leading = input.trim().match(/^(\d+\.\d+\.\d+)(?![\d.])/);
  if (leading !== null) return leading[1]!;
  return extractCriterion(input) ?? input.trim();
}

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
          'AI output requires the llm.view permission and is marked source "ai".',
          'A caller with issues.fix but without llm.view receives the deterministic pattern-based hint the report page shows, marked source "pattern", and the LLM service is not called.',
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
      const toolCtx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const { wcagCriterion, issueMessage, htmlContext } = args;
      const jurisdictions = args.jurisdictions ?? ['EU', 'US'];

      // Enrich with legal context from compliance service (D-06). Compliance
      // data is not LLM output, so both answers carry it. Failure degrades to
      // legalContext: null — never sets isError.
      const enrich = async (): Promise<unknown> => {
        if (complianceAccess === undefined) return null;
        try {
          const accessResult = await complianceAccess();
          if (accessResult === null) return null;
          return await checkCompliance(
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
        } catch {
          return null;
        }
      };

      // D-01/D-02: entitlement is decided BEFORE any LLM access. A caller
      // without llm.view never resolves LLM credentials, never spends LLM
      // budget and never reaches the LLM service.
      if (!mayReceiveAiFix(toolCtx)) {
        const suggestion = getFixSuggestion(toDottedCriterion(wcagCriterion), issueMessage);
        return okEnvelope({
          source: 'pattern',
          wcagCriterion,
          hint: suggestion === null
            ? null
            : {
                title: suggestion.title,
                description: suggestion.description,
                codeExample: suggestion.codeExample,
                effort: suggestion.effort,
              },
          note: suggestion === null ? PATTERN_NO_MATCH_NOTE : PATTERN_HINT_NOTE,
          legalContext: await enrich(),
          disclaimer: DRAFT_DISCLAIMER,
        });
      }

      const { cssContext, platform } = args;

      // Resolve LLM access — hard error if not configured
      const llm = await resolveLlmAccess(llmAccess);
      if ('error' in llm) return errorEnvelope(llm.error);

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

      const legalContext = await enrich();

      return okEnvelope({
        source: 'ai',
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

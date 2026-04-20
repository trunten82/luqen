/**
 * Phase 32 Plan 04 — in-process MCP tool dispatcher for AgentService.
 *
 * D-08 option (a): direct handler invocation against DASHBOARD_TOOL_METADATA
 * handlers. Avoids the HTTP round-trip to the dashboard's own `/mcp` endpoint
 * for tools that would have executed in the same process anyway. Phase 33
 * cross-service tool exposure can revisit this choice.
 *
 * Each `dispatch(call, ctx)` call:
 *   1. Looks the tool up in the manifest — unknown name returns
 *      `{error:'unknown_tool'}`. The model sees this as a role='tool'
 *      content on the next turn and self-corrects (AI-SPEC §6.1 Guardrail 1).
 *   2. zod.safeParse's the call args against the tool's inputSchema. Failure
 *      returns `{error:'invalid_args', issues:[...]}` WITHOUT invoking the
 *      handler (AI-SPEC §4b.1 Boundary 2 / §6.1 Guardrail 6). Feeds the zod
 *      issue list back as the tool-result content so the LLM can self-correct
 *      the arg shape on the next iteration.
 *   3. Resolves the caller's current scopes (AI-SPEC §6.1 Guardrail 7) and
 *      mints a fresh RS256 JWT via jwt-minter (AI-SPEC §3 Pitfall 5). Token
 *      audit trail carried through `signer.mintAccessToken` → existing
 *      oauth-signer instrumentation.
 *   4. Invokes the handler under a timeout (D-24 = 30s). Timeout returns
 *      `{error:'timeout'}`; any other throw returns `{error:'internal',
 *      message:String(err)}`.
 *
 * Not responsible for persistence, audit writes, or emit() calls — those are
 * AgentService concerns (single-responsibility per PATTERNS.md).
 */

import { z } from 'zod';
import type { DashboardSigner } from '../auth/oauth-signer.js';
import { mintAgentToken } from './jwt-minter.js';

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolDispatchContext,
) => Promise<unknown>;

export interface ToolManifestEntry {
  readonly name: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly handler: ToolHandler;
}

export interface ToolDispatchContext {
  readonly userId: string;
  readonly orgId: string;
  readonly signal?: AbortSignal;
  /**
   * Short-lived agent-internal JWT minted for THIS dispatch. Exposed on the
   * context so handlers forwarding to downstream services can carry the
   * user's identity without re-minting.
   */
  readonly authToken: string;
}

export interface ToolCallInput {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export type ToolDispatchResult =
  | { readonly error: 'unknown_tool' }
  | { readonly error: 'invalid_args'; readonly issues: readonly z.core.$ZodIssue[] }
  | { readonly error: 'timeout' }
  | { readonly error: 'internal'; readonly message: string }
  | { readonly ok: true; readonly value: unknown }
  // Handlers may return their own shape; callers treat anything without an
  // `error` or `ok` sentinel as a plain success payload.
  | Record<string, unknown>;

/**
 * Minimal signer surface ToolDispatcher depends on. Accepting the minimal
 * interface (not the full DashboardSigner) keeps the unit tests able to inject
 * a lightweight spy without importing the oauth-signer test harness.
 */
type SignerLike = Pick<DashboardSigner, 'mintAccessToken' | 'currentKid'>;

export interface ToolDispatcherOptions {
  readonly tools: readonly ToolManifestEntry[];
  readonly signer: SignerLike;
  readonly dashboardMcpAudience: string;
  readonly resolveScopes: (
    userId: string,
    orgId: string,
  ) => Promise<readonly string[]>;
  /**
   * Per-dispatch timeout. Defaults to 30s (D-24). Overridable so unit tests
   * can exercise the timeout path without waiting 30s.
   */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ToolDispatcher {
  private readonly tools: readonly ToolManifestEntry[];
  private readonly signer: SignerLike;
  private readonly dashboardMcpAudience: string;
  private readonly resolveScopes: (
    userId: string,
    orgId: string,
  ) => Promise<readonly string[]>;
  private readonly timeoutMs: number;

  constructor(options: ToolDispatcherOptions) {
    this.tools = options.tools;
    this.signer = options.signer;
    this.dashboardMcpAudience = options.dashboardMcpAudience;
    this.resolveScopes = options.resolveScopes;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async dispatch(
    call: ToolCallInput,
    ctx: Omit<ToolDispatchContext, 'authToken'>,
  ): Promise<ToolDispatchResult> {
    // 1. Manifest lookup — refuse unknown names (model hallucinated a tool).
    const tool = this.tools.find((t) => t.name === call.name);
    if (tool === undefined) {
      return { error: 'unknown_tool' };
    }

    // 2. zod validate args BEFORE dispatch (Guardrail 6). Never reach handler
    //    with an unvalidated payload.
    const parsed = tool.inputSchema.safeParse(call.args);
    if (!parsed.success) {
      return { error: 'invalid_args', issues: parsed.error.issues };
    }

    // 3. Resolve current scopes + mint a fresh JWT for THIS dispatch.
    //    resolveScopes is called per-dispatch so a mid-turn role revoke is
    //    reflected in the very next tool call (Guardrail 7).
    const scopes = await this.resolveScopes(ctx.userId, ctx.orgId);
    const authToken = await mintAgentToken(
      this.signer as DashboardSigner,
      ctx.userId,
      ctx.orgId,
      scopes,
      this.dashboardMcpAudience,
    );

    const dispatchCtx: ToolDispatchContext = {
      userId: ctx.userId,
      orgId: ctx.orgId,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      authToken,
    };

    // 4. Invoke handler with a race-based timeout. Never throws to caller —
    //    the model consumes this result as the next tool message content.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const handlerPromise = tool.handler(
        parsed.data as Record<string, unknown>,
        dispatchCtx,
      );
      const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), this.timeoutMs);
      });
      const outcome = await Promise.race([handlerPromise, timeoutPromise]);
      if (outcome === TIMEOUT_SENTINEL) {
        return { error: 'timeout' };
      }
      return outcome as ToolDispatchResult;
    } catch (err) {
      return {
        error: 'internal',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }
}

const TIMEOUT_SENTINEL: unique symbol = Symbol('tool-dispatch-timeout');

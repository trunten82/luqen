/**
 * Phase 32 Plan 04 — AgentService: the while(tool_calls) orchestrator.
 *
 * Owns:
 *   - Persisting every user / tool / assistant message via Phase 31's
 *     ConversationRepository.appendMessage (rolling-window maintenance is the
 *     repo's responsibility).
 *   - Per-iteration RBAC rebuild: calls `resolvePermissions(userId, orgId)`
 *     at the TOP of every loop iteration so a mid-turn role revoke is
 *     reflected in the manifest sent to the LLM on the very next call
 *     (AI-SPEC §3 Pitfall 6 / §6.1 Guardrail 1).
 *   - destructiveHint pause — any tool in the current `tool_calls` batch
 *     with `destructive: true` halts the ENTIRE batch. The pending row is
 *     persisted BEFORE the SSE `pending_confirmation` frame is emitted so
 *     a reload can recover the state (D-29 / SC#4).
 *   - Iteration cap MAX_TOOL_ITERATIONS=5 (D-06). Iter 6 forces a final-
 *     answer turn with an empty tool manifest + writes an audit row
 *     (toolName='__loop__', outcome='error', outcomeDetail='iteration_cap').
 *   - 8 KB tool-result truncation (AI-SPEC §4 Context Window Strategy). When
 *     the serialised result exceeds the cap, AgentService stores a sentinel
 *     `{_truncated:true, size:<bytes>}` instead of the full payload.
 *   - Per-tool audit append with correct outcome classification (success /
 *     error / timeout / denied).
 *
 * Does NOT own:
 *   - HTTP transport to @luqen/llm (lives in `llm-client.ts`).
 *   - JWT minting (lives in `jwt-minter.ts`).
 *   - zod arg validation (lives in `tool-dispatch.ts`).
 *   - Frame zod validation + reply.raw writes (lives in `sse-frames.ts`).
 *
 * The constructor injects every dep so unit tests can substitute stubs
 * without monkey-patching imports.
 */

import type { StorageAdapter } from '../db/index.js';
import type { Message } from '../db/interfaces/conversation-repository.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { SseFrame } from './sse-frames.js';
import { collectContextHints, formatContextHints } from './context-hints.js';
import { generateConversationTitle } from './conversation-title-generator.js';
import {
  estimateTokens,
  shouldCompact,
  MIN_KEEP_TURNS,
  DEFAULT_MODEL_MAX_TOKENS,
} from './token-budget.js';
import { prewarmTokenizer } from './tokenizer/index.js';
import type {
  ToolDispatcher,
  ToolCallInput,
  ToolDispatchResult,
} from './tool-dispatch.js';

/**
 * D-06: hard cap on provider tool-call iterations per user turn. Six is the
 * forced-final-answer trigger: five full tool-call iterations, then an
 * empty-tools recap turn.
 */
export const MAX_TOOL_ITERATIONS = 5;

/**
 * AI-SPEC §4 Context Window Strategy: cap each tool result at 8 KB of
 * serialised JSON before persisting it for the next LLM turn.
 */
export const TOOL_RESULT_MAX_BYTES = 8 * 1024;

// ---------------------------------------------------------------------------
// LLM + dispatcher contracts (narrow subset AgentService needs from each).
// Structural typing — stubs in tests need not import the full LlmClient.
// ---------------------------------------------------------------------------

export interface AgentChatMessage {
  readonly role: 'user' | 'assistant' | 'tool' | 'system';
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: ReadonlyArray<ToolCallInput>;
}

export interface AgentToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface AgentStreamInput {
  readonly messages: readonly AgentChatMessage[];
  readonly tools: readonly AgentToolDef[];
  readonly orgId: string;
  readonly userId: string;
  readonly agentDisplayName: string;
  /**
   * Phase 33-02 (AGENT-04): per-turn context hints block — recent scans +
   * active brand guidelines rendered as plain-text. Empty string suppresses
   * the `{contextHints}` placeholder in the system prompt.
   */
  readonly contextHintsBlock?: string;
}

export interface AgentStreamOptions {
  readonly signal: AbortSignal;
  readonly onFrame: (frame: SseFrame) => void;
}

export interface AgentStreamTurn {
  readonly text: string;
  readonly toolCalls: ReadonlyArray<ToolCallInput>;
  /**
   * Phase 36 ATOOL-04 — optional thinking/reasoning text from providers that
   * surface chain-of-thought blocks (e.g. Anthropic). When present it is
   * captured into the rationale alongside `text`. Provider adapters opt in
   * by populating this field; defaults to undefined.
   */
  readonly thinking?: string;
}

export interface LlmAgentTransport {
  streamAgentConversation(
    input: AgentStreamInput,
    opts: AgentStreamOptions,
  ): Promise<AgentStreamTurn>;
}

export interface AgentTurnInput {
  readonly conversationId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly userMessage: string;
  readonly emit: (frame: SseFrame) => void;
  readonly signal: AbortSignal;
}

export interface AgentToolCatalogEntry {
  readonly description?: string;
  readonly inputSchema?: unknown;
}

/**
 * Phase 35 Plan 03 — title generator callable signature. Injected into
 * AgentService so tests can substitute a stub; default wiring binds to
 * `generateConversationTitle` with AgentService's own `llm` field.
 */
export interface TitleGeneratorFn {
  (args: {
    readonly orgId: string;
    readonly userId: string;
    readonly agentDisplayName: string;
    readonly userMessage: string;
    readonly assistantReply: string;
    readonly signal?: AbortSignal;
  }): Promise<string>;
}

export interface AgentServiceOptions {
  readonly storage: StorageAdapter;
  readonly llm: LlmAgentTransport;
  readonly allTools: readonly ToolMetadata[];
  /**
   * Phase 35 Plan 03 — override the post-first-assistant title generator.
   * Defaults to `generateConversationTitle` bound to this service's llm.
   * Tests inject `vi.fn()` to assert call count + args without LLM calls.
   */
  readonly titleGenerator?: TitleGeneratorFn;
  /**
   * Optional catalog of tool descriptions + inputSchemas keyed by tool name.
   * Sourced from the MCP server's `_registeredTools` map so the LLM receives
   * the same descriptions + JSON Schemas that MCP clients see. Without this
   * the model gets names only and often refuses to call tools.
   */
  readonly toolCatalog?: Record<string, AgentToolCatalogEntry>;
  readonly dispatcher: Pick<ToolDispatcher, 'dispatch'>;
  /**
   * Per-iteration permission resolver. Called at the TOP of every loop
   * iteration — never cached. Typical production wiring:
   *   resolveEffectivePermissions(storage.roles, userId, userRole, orgId).
   * Tests inject a scripted function to exercise the revoke-mid-turn path.
   */
  readonly resolvePermissions: (
    userId: string,
    orgId: string,
  ) => Promise<ReadonlySet<string>>;
  readonly config: {
    readonly agentDisplayNameDefault: string;
    /** Phase 33-03 — opt-out flag. Default: true. */
    readonly agent_compaction?: boolean;
    /** Phase 33-03 — override the assumed per-provider token max. Default: 8192. */
    readonly modelMaxTokens?: number;
    /** Phase 34 — model identifier for precise tokenization. Server-config only;
     *  NEVER populate from request-scoped input (would enable Ollama SSRF-via-warm
     *  and prototype-pollution in registry lookups). */
    readonly modelId?: string;
  };
  /**
   * Optional: override where to read the agent display name from. Defaults
   * to `storage.organizations.getOrg(orgId).agentDisplayName`. Tests can
   * inject a constant so they do not need to seed an org row.
   */
  readonly resolveAgentDisplayName?: (orgId: string) => Promise<string | null | undefined>;
}

// ---------------------------------------------------------------------------
// AgentService
// ---------------------------------------------------------------------------

export class AgentService {
  private readonly storage: StorageAdapter;
  private readonly llm: LlmAgentTransport;
  private readonly allTools: readonly ToolMetadata[];
  private readonly toolCatalog: Record<string, AgentToolCatalogEntry>;
  private readonly dispatcher: Pick<ToolDispatcher, 'dispatch'>;
  private readonly resolvePermissions: (
    userId: string,
    orgId: string,
  ) => Promise<ReadonlySet<string>>;
  private readonly config: {
    readonly agentDisplayNameDefault: string;
    readonly agent_compaction?: boolean;
    readonly modelMaxTokens?: number;
    /** Phase 34 — model identifier for precise tokenization. Server-config only;
     *  NEVER populate from request-scoped input (would enable Ollama SSRF-via-warm
     *  and prototype-pollution in registry lookups). */
    readonly modelId?: string;
  };
  private readonly resolveDisplayName: (orgId: string) => Promise<string>;
  private readonly titleGenerator: TitleGeneratorFn;

  constructor(options: AgentServiceOptions) {
    this.storage = options.storage;
    this.llm = options.llm;
    this.allTools = options.allTools;
    this.toolCatalog = options.toolCatalog ?? {};
    this.dispatcher = options.dispatcher;
    this.resolvePermissions = options.resolvePermissions;
    this.config = options.config;
    // Phase 35 Plan 03 — title hook. Default binds to the shared generator
    // with this service's `llm` field; tests inject a stub to count calls.
    const injectedTitleGen = options.titleGenerator;
    if (injectedTitleGen !== undefined) {
      this.titleGenerator = injectedTitleGen;
    } else {
      this.titleGenerator = (args) => generateConversationTitle({
        llm: this.llm,
        orgId: args.orgId,
        userId: args.userId,
        agentDisplayName: args.agentDisplayName,
        userMessage: args.userMessage,
        assistantReply: args.assistantReply,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
      });
    }
    // Phase 34-02 — fire-and-forget tokenizer warm-up (D-05). `void` marks
    // the discarded promise explicitly for no-floating-promises lints.
    // Errors inside prewarm are swallowed by the tokenizer module so this
    // cannot throw at construction time.
    if (this.config.modelId) {
      void prewarmTokenizer(this.config.modelId);
    }
    const injected = options.resolveAgentDisplayName;
    this.resolveDisplayName = async (orgId: string): Promise<string> => {
      if (injected !== undefined) {
        const raw = await injected(orgId);
        if (raw === undefined || raw === null) return this.config.agentDisplayNameDefault;
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : this.config.agentDisplayNameDefault;
      }
      const org = await this.storage.organizations.getOrg(orgId);
      const raw = org?.agentDisplayName;
      if (raw === undefined || raw === null) return this.config.agentDisplayNameDefault;
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : this.config.agentDisplayNameDefault;
    };
  }

  /**
   * Execute one user turn. Persists the user message, then runs up to
   * MAX_TOOL_ITERATIONS tool-call iterations. Emits token / tool_calls /
   * pending_confirmation / done / error SSE frames along the way.
   *
   * Never throws to the caller — any unrecoverable error surfaces as an
   * error SSE frame + `status='failed'` persistence + audit row.
   */
  async runTurn(input: AgentTurnInput): Promise<void> {
    const { conversationId, userId, orgId, userMessage, emit, signal } = input;

    // Persist the user message BEFORE entering the loop so a mid-stream
    // abort does not silently drop the prompt. Idempotent: POST /agent/message
    // already persists the user row before opening the SSE stream, so skip
    // the append when the same user content is already present in the
    // current window.
    //
    // Why scan the ENTIRE preWindow (not just the last row) — fix for
    // agent-uat-residuals bug 2: when a destructive tool goes through the
    // pending_confirmation flow, the client reopens the SSE stream after
    // /confirm/:messageId returns (agent.js openStream after handleApproveClick).
    // At that point the window state is [user, tool(pending→sent), tool(result)],
    // so lastRow.role === 'tool' and the previous narrower check would
    // re-persist the user row. Scanning the whole window for any user row
    // matching userMessage handles confirm-resume, error-resume, and any
    // future flow where intervening rows separate the user message from the
    // window tail. False-positive risk: a deliberate same-prompt repeat in
    // the same turn skips the second persist — acceptable trade-off (and
    // exceedingly rare; same-prompt repeats are typically separated by an
    // assistant reply, which makes them a NEW turn with non-matching window).
    const preWindow = await this.storage.conversations.getWindow(conversationId);
    const alreadyPersisted = preWindow.some(
      (row) => row.role === 'user' && (row.content ?? '') === userMessage,
    );
    if (!alreadyPersisted) {
      await this.storage.conversations.appendMessage({
        conversationId,
        role: 'user',
        content: userMessage,
        status: 'sent',
      });
    }

    const agentDisplayName = await this.resolveDisplayName(orgId);

    // Plan 33-02 (AGENT-04): collect context hints once per runTurn so every
    // iteration shares the same snapshot. orgId may be a synthetic admin
    // namespace (__admin__:<userId>) — unwrap to '' (cross-org) for the
    // hints read so dashboard admins get meaningful data, not zero rows
    // under their synthetic org.
    const hintsOrgId = orgId.startsWith('__admin__:') ? '' : orgId;
    let contextHintsBlock = '';
    try {
      const hints = await collectContextHints(this.storage, { userId, orgId: hintsOrgId });
      contextHintsBlock = formatContextHints(hints);
    } catch {
      contextHintsBlock = '';
    }

    // Phase 36 ATOOL-02 — shared per-turn retry budget. Closure-scoped so the
    // LLM cannot influence it (T-36-08); decremented for every non-success
    // tool outcome, clamped at 0. Reset per runTurn invocation.
    const retryBudget = { remaining: 3 };

    // Phase 37 Plan 03 (AUX-01) — stop-persistence state. We accumulate
    // streamed token text per LLM call so an AbortSignal mid-stream can
    // persist whatever arrived before the user clicked stop. The
    // assistant DB row is created lazily inside handleStreamAbort —
    // pre-creating would double assistant rows on natural completion.
    let accumulatedText = '';
    const turnStart = Date.now();

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        // (1) Re-resolve permissions every iteration (D-07, Guardrail 1).
        const perms = await this.resolvePermissions(userId, orgId);
        const manifest = buildManifest(this.allTools, perms, this.toolCatalog);

        // (2) Fresh rolling-window read — the previous iteration's tool row
        //     is already visible because appendMessage flipped `in_window=1`
        //     inside the same transaction.
        let window = await this.storage.conversations.getWindow(conversationId);
        let messages = windowToChatMessages(window);

        // Phase 33-03 / 34-02: compact if the turn would exceed the token
        // budget. modelId (when configured) drives the precise per-provider
        // tokenizer; system message stays in the input array because
        // countMessageTokens excludes it per D-10 — keeping a single code
        // path leaves the tokenizer module authoritative for what-to-exclude.
        const estimate = estimateTokens(
          [{ role: 'system', content: contextHintsBlock }, ...messages],
          this.config.modelId,
        );
        if (this.config.agent_compaction !== false && shouldCompact(estimate, this.config.modelMaxTokens)) {
          await this.compactOldestTurns({
            conversationId,
            orgId,
            userId,
            agentDisplayName,
            signal,
          });
          window = await this.storage.conversations.getWindow(conversationId);
          messages = windowToChatMessages(window);
        }

        // Phase 37 Plan 03 (AUX-01) — reset accumulator before each LLM
        // call so abort-persistence captures only the in-flight stream.
        accumulatedText = '';

        // (3) Stream the LLM turn; onFrame forwards tokens straight through.
        const turn = await this.llm.streamAgentConversation(
          { messages, tools: manifest, orgId, userId, agentDisplayName, contextHintsBlock },
          {
            signal,
            onFrame: (f) => {
              // Only forward token frames from the LLM layer — the outer
              // route is the sole authority for control frames (tool_calls,
              // pending_confirmation, done, error). Phase 37 Plan 03: also
              // accumulate token text for stop-persistence.
              if (f.type === 'token') {
                accumulatedText += f.text;
                emit(f);
              }
            },
          },
        );

        if (turn.toolCalls.length === 0) {
          // Plain final answer path. Phase 37 Plan 03: clear the abort
          // tracker — the LLM returned successfully so any later
          // exception is NOT a stream abort and must follow the existing
          // error path.
          accumulatedText = '';
          await this.storage.conversations.appendMessage({
            conversationId,
            role: 'assistant',
            content: turn.text,
            status: 'sent',
          });
          // Phase 35 Plan 03 — post-first-assistant-turn title hook (D-02/D-03).
          // Fire-and-forget so SSE `done` latency is unaffected. Only triggers
          // when the conversation has no title yet (first assistant turn).
          // Errors are swallowed: the generator's own fallback guarantees a
          // safe title is written; any exception here means the stubbed test
          // generator rejected without fallback — correct behaviour is to do
          // nothing and let the conversation stay untitled rather than crash
          // the user-visible turn that already completed.
          await this.maybeGenerateTitle({
            conversationId,
            orgId,
            userId,
            agentDisplayName,
            userMessage,
            assistantReply: turn.text,
            signal,
          });
          emit({ type: 'done' });
          return;
        }

        // (4) Destructive-batch pause — scan the WHOLE batch first.
        const destructive = turn.toolCalls.find((c) => {
          const meta = this.allTools.find((t) => t.name === c.name);
          return meta?.destructive === true;
        });
        if (destructive !== undefined) {
          const meta = this.allTools.find((t) => t.name === destructive.name);
          const confirmationText = meta?.confirmationTemplate?.(destructive.args);
          // Persist BEFORE emit so reload recovery has the row regardless of
          // when the client receives the frame (D-29).
          const pending = await this.storage.conversations.appendMessage({
            conversationId,
            role: 'tool',
            status: 'pending_confirmation',
            toolCallJson: JSON.stringify(destructive),
          });
          emit({
            type: 'pending_confirmation',
            messageId: pending.id,
            toolName: destructive.name,
            args: destructive.args,
            ...(confirmationText !== undefined ? { confirmationText } : {}),
          });
          return;
        }

        // (5) Non-destructive batch — persist ONE assistant(tool_calls) row
        //     for the whole batch, then dispatch each tool and persist its
        //     result row. windowToChatMessages preserves the
        //     user → assistant(tool_calls) → tool (per call) order that
        //     Ollama / OpenAI / Anthropic all require for conversation
        //     history. See Plan 32.1-08.
        await this.storage.conversations.appendMessage({
          conversationId,
          role: 'assistant',
          content: turn.text ?? '',
          status: 'sent',
          toolCallJson: JSON.stringify(turn.toolCalls),
        });
        // Phase 36 ATOOL-01/02/04 — parallel dispatch with rationale capture,
        // retry budget management, and per-tool SSE lifecycle frames.
        await this.dispatchBatchAndPersist({
          turn,
          conversationId,
          userId,
          orgId,
          signal,
          emit,
          retryBudget,
        });
        // Fall through to next iteration.
      }

      // (6) Iteration cap — force a final-answer turn with EMPTY tools.
      // Phase 36-03 — emit a synthetic tool_completed frame ahead of the
      // forced wrap-up so the chip strip in 36-04 can render the
      // "iteration_cap" notice. Re-uses the existing tool_completed schema
      // with toolCallId='__loop__' (no DOM injection — frontend uses
      // textContent only; T-36-10 mitigation).
      emit({
        type: 'tool_completed',
        toolCallId: '__loop__',
        toolName: '__loop__',
        status: 'error',
        errorMessage: 'iteration_cap',
      });
      await this.forceFinalAnswer({
        conversationId,
        userId,
        orgId,
        emit,
        signal,
        agentDisplayName,
      });
      await this.storage.agentAudit.append({
        userId,
        orgId,
        conversationId,
        toolName: '__loop__',
        argsJson: '{}',
        outcome: 'error',
        outcomeDetail: 'iteration_cap',
        latencyMs: 0,
      });
    } catch (err) {
      // Phase 37 Plan 03 (AUX-01) — distinguish abort-by-user from
      // genuine errors. When the route's AbortController fires (user
      // hit the stop button or closed the SSE), persist the partial
      // assistant text with status='stopped' and emit no further
      // frames — the consumer is gone. An audit row records the stop
      // for /admin/audit visibility. Provider/internal errors fall
      // through to the original error path below.
      if (signal.aborted) {
        await this.handleStreamAbort({
          conversationId,
          orgId,
          userId,
          accumulatedText,
          turnStartMs: turnStart,
        });
        return;
      }
      // Catch-all: emit an error frame + persist failed status on any
      // lingering in-flight assistant row. Never rethrow to caller.
      const message = err instanceof Error ? err.message : String(err);
      emit({
        type: 'error',
        code: 'internal',
        message,
        retryable: false,
      });
      await this.storage.conversations.appendMessage({
        conversationId,
        role: 'assistant',
        content: `Error: ${message}`,
        status: 'failed',
      });
    }
  }

  /**
   * Phase 37 Plan 03 (AUX-01) — persist a stopped streaming turn.
   *
   * Appends an assistant row with the partial text and immediately
   * flips it to status='stopped' via markMessageStopped. The two-step
   * dance keeps the stop primitive (markMessageStopped) authoritative
   * for the status flag while this method owns the row creation —
   * consistent with Plan 01's contract.
   *
   * Audit row: toolName='message_stopped', outcome='success',
   * outcomeDetail='stopped_by_user'. latencyMs is the turn-start →
   * abort delta so /admin/audit can show how long the user waited
   * before hitting stop.
   */
  private async handleStreamAbort(args: {
    readonly conversationId: string;
    readonly orgId: string;
    readonly userId: string;
    readonly accumulatedText: string;
    readonly turnStartMs: number;
  }): Promise<void> {
    const row = await this.storage.conversations.appendMessage({
      conversationId: args.conversationId,
      role: 'assistant',
      content: args.accumulatedText,
      status: 'streaming',
    });
    await this.storage.conversations.markMessageStopped(
      row.id,
      args.conversationId,
      args.orgId,
      args.accumulatedText,
    );
    await this.storage.agentAudit.append({
      userId: args.userId,
      orgId: args.orgId,
      conversationId: args.conversationId,
      toolName: 'message_stopped',
      argsJson: '{}',
      outcome: 'success',
      outcomeDetail: 'stopped_by_user',
      latencyMs: Math.max(0, Date.now() - args.turnStartMs),
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Phase 33-03 — when the prompt budget is exceeded, summarise every row
   * older than the last MIN_KEEP_TURNS user-anchored turns into a single
   * [summary] assistant row, then flip those older rows out of the window.
   *
   * The summarisation call reuses the agent-conversation capability itself
   * with an empty tool manifest — the same model that drives the turn is
   * asked to produce a terse summary via a synthetic user message. No new
   * LLM capability registration required.
   */
  private async compactOldestTurns(args: {
    readonly conversationId: string;
    readonly orgId: string;
    readonly userId: string;
    readonly agentDisplayName: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const { conversationId, orgId, userId, agentDisplayName, signal } = args;

    const window = await this.storage.conversations.getWindow(conversationId);
    // Identify user-anchored turn boundaries.
    const userIndices: number[] = [];
    window.forEach((m, i) => {
      if (m.role === 'user') userIndices.push(i);
    });
    // Need MIN_KEEP_TURNS + 1 user messages to have something older to summarise.
    if (userIndices.length <= MIN_KEEP_TURNS) return;

    const tailStartIdx = userIndices[userIndices.length - MIN_KEEP_TURNS];
    if (tailStartIdx === undefined || tailStartIdx === 0) return;

    const olderRows = window.slice(0, tailStartIdx);
    const boundaryCreatedAt = window[tailStartIdx].createdAt;

    // Build the summarisation prompt as a window for the model.
    const olderMessages = windowToChatMessages(olderRows);
    const summariseRequest: AgentChatMessage = {
      role: 'user' as const,
      content:
        'Summarise the conversation above in at most 8 bullet points. Capture: decisions made, facts learned, open questions, and any pending tool outcomes. Begin with the word "[summary]".',
    };

    let summaryText = '';
    try {
      const turn = await this.llm.streamAgentConversation(
        {
          messages: [...olderMessages, summariseRequest],
          tools: [],
          orgId,
          userId,
          agentDisplayName,
          contextHintsBlock: '',
        },
        {
          signal,
          // Swallow the summarisation tokens — we only persist the final text,
          // not stream to the client. The caller's emit is unused here.
          onFrame: () => { /* noop */ },
        },
      );
      summaryText = turn.text;
    } catch {
      // If summarisation fails, abort compaction — do NOT drop rows out of
      // the window without a replacement summary (that would lose context).
      return;
    }

    if (summaryText.length === 0) return;
    const prefixed = summaryText.startsWith('[summary]')
      ? summaryText
      : `[summary] ${summaryText}`;

    // Persist the summary FIRST so the new row's created_at > boundary.
    await this.storage.conversations.appendMessage({
      conversationId,
      role: 'assistant',
      content: prefixed,
      status: 'sent',
    });

    // Flip the older rows out of the window.
    await this.storage.conversations.markOutOfWindowBefore(conversationId, boundaryCreatedAt);

    // Audit trail.
    await this.storage.agentAudit.append({
      userId,
      orgId,
      conversationId,
      toolName: '__compaction__',
      argsJson: JSON.stringify({ summarisedRows: olderRows.length, boundaryCreatedAt }),
      outcome: 'success',
      latencyMs: 0,
    });
  }

  /**
   * Phase 35 Plan 03 — fire-and-forget post-first-assistant title hook.
   *
   * Reads the conversation row; if title is still null, dispatches the
   * title generator in the background and writes the result via
   * renameConversation. The outer runTurn emits its SSE `done` frame BEFORE
   * awaiting the background promise so user-visible latency is unaffected.
   *
   * Swallow-with-comment is explicit here: the production generator's own
   * fallback (Plan 02) guarantees a safe title always resolves, so a
   * rejection in this code path comes only from stubbed tests or a
   * catastrophic bug — either way, the right move is leaving the
   * conversation untitled rather than crashing the already-completed turn.
   */
  private async maybeGenerateTitle(args: {
    readonly conversationId: string;
    readonly orgId: string;
    readonly userId: string;
    readonly agentDisplayName: string;
    readonly userMessage: string;
    readonly assistantReply: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const conv = await this.storage.conversations.getConversation(
      args.conversationId,
      args.orgId,
    );
    if (conv === null || conv.title !== null) return;
    // Fire-and-forget — intentional `void` to keep runTurn non-blocking.
    void this.titleGenerator({
      orgId: args.orgId,
      userId: args.userId,
      agentDisplayName: args.agentDisplayName,
      userMessage: args.userMessage,
      assistantReply: args.assistantReply,
      signal: args.signal,
    })
      .then((title) => this.storage.conversations.renameConversation(
        args.conversationId,
        args.orgId,
        title,
      ))
      .catch(() => {
        // See JSDoc above — generator's own fallback normally prevents this.
      });
  }

  /**
   * Phase 36 ATOOL-01/02/04 — dispatch a batch of tool calls concurrently,
   * stream per-tool lifecycle frames, manage the shared retry budget, and
   * persist results + audit rows in input order.
   *
   * Design choice (per 36-03 plan): we call `dispatcher.dispatch(...)` per
   * call inside `Promise.all` (NOT `dispatchAll`) so each `tool_completed`
   * frame fires the moment its own promise resolves — preserving accurate
   * event ordering in the chip strip. `dispatchAll` from 36-02 remains the
   * public batch API for callers that don't need streaming events.
   */
  private async dispatchBatchAndPersist(args: {
    readonly turn: AgentStreamTurn;
    readonly conversationId: string;
    readonly userId: string;
    readonly orgId: string;
    readonly signal: AbortSignal;
    readonly emit: (frame: SseFrame) => void;
    readonly retryBudget: { remaining: number };
  }): Promise<void> {
    const { turn, conversationId, userId, orgId, signal, emit, retryBudget } = args;
    const calls = turn.toolCalls;

    // (a) Capture rationale BEFORE dispatching — same string applied to every
    //     audit row in this batch (D-CONTEXT: rationale is per assistant turn).
    const rationale = extractRationale(turn);

    // (b) Emit tool_started frames in input order, synchronously, before any
    //     dispatch promise has a chance to resolve.
    for (const call of calls) {
      emit({ type: 'tool_started', toolCallId: call.id, toolName: call.name });
    }

    // (c) Dispatch all calls concurrently. Per-call .then(emit) wraps each
    //     promise so tool_completed fires the instant its own dispatch
    //     settles — accurate event ordering vs awaiting Promise.all in bulk.
    const startTimes = calls.map(() => Date.now());
    type SettledResult = {
      readonly call: ToolCallInput;
      readonly result: unknown;
      readonly outcome: 'success' | 'error' | 'timeout' | 'denied';
      readonly outcomeDetail: string | undefined;
      readonly latencyMs: number;
    };
    const settled = await Promise.all(
      calls.map(async (call, idx): Promise<SettledResult> => {
        const started = startTimes[idx];
        let outcome: 'success' | 'error' | 'timeout' | 'denied' = 'success';
        let outcomeDetail: string | undefined;
        let resultToStore: unknown;
        try {
          const result = await this.dispatcher.dispatch(call, { userId, orgId, signal });
          resultToStore = result;
          if (result !== null && typeof result === 'object' && 'error' in result) {
            const err = (result as { error: string }).error;
            if (err === 'timeout') outcome = 'timeout';
            else if (err === 'denied') outcome = 'denied';
            else outcome = 'error';
            outcomeDetail = err;
          }
        } catch (err) {
          outcome = 'error';
          outcomeDetail = err instanceof Error ? err.message : String(err);
          resultToStore = { error: outcomeDetail };
        }
        // Emit tool_completed at the moment this individual call settles.
        emit({
          type: 'tool_completed',
          toolCallId: call.id,
          toolName: call.name,
          status: outcome === 'success' ? 'success' : 'error',
          ...(outcome !== 'success' && outcomeDetail !== undefined
            ? { errorMessage: outcomeDetail }
            : {}),
        });
        return {
          call,
          result: resultToStore,
          outcome,
          outcomeDetail,
          latencyMs: Date.now() - started,
        };
      }),
    );

    // (d) Persist results + audit rows in input order. Apply retry guidance
    //     from the shared budget; decrement per non-success outcome.
    for (const s of settled) {
      // buildRetryGuidance treats anything without an `error` sentinel as
      // success → null. Failed handler-thrown sentinels (resultToStore =
      // { error: ... }) and dispatcher error sentinels both flow through
      // the same path.
      const guidance = buildRetryGuidance(
        s.result as ToolDispatchResult,
        retryBudget.remaining,
      );
      if (guidance !== null) {
        retryBudget.remaining = Math.max(0, retryBudget.remaining - 1);
      }
      // Immutable: build a fresh wrapper object — never mutate s.result.
      const persistedShape = guidance === null
        ? s.result
        : (typeof s.result === 'object' && s.result !== null
            ? { ...(s.result as Record<string, unknown>), _guidance: guidance }
            : { value: s.result, _guidance: guidance });
      const stored = truncateResultForStorage(persistedShape);
      await this.storage.conversations.appendMessage({
        conversationId,
        role: 'tool',
        toolCallJson: JSON.stringify(s.call),
        toolResultJson: stored,
        status: s.outcome === 'success' ? 'sent' : 'failed',
      });
      await this.storage.agentAudit.append({
        userId,
        orgId,
        conversationId,
        toolName: s.call.name,
        argsJson: JSON.stringify(s.call.args),
        outcome: s.outcome,
        ...(s.outcomeDetail !== undefined ? { outcomeDetail: s.outcomeDetail } : {}),
        rationale,
        latencyMs: s.latencyMs,
      });
    }
  }

  private async forceFinalAnswer(args: {
    readonly conversationId: string;
    readonly userId: string;
    readonly orgId: string;
    readonly emit: (f: SseFrame) => void;
    readonly signal: AbortSignal;
    readonly agentDisplayName: string;
  }): Promise<void> {
    const { conversationId, emit, signal, agentDisplayName, orgId, userId } = args;
    const window = await this.storage.conversations.getWindow(conversationId);
    const messages: AgentChatMessage[] = [
      ...windowToChatMessages(window),
      {
        role: 'user',
        content:
          "Respond to the user now based on what you've learned; do not call any more tools.",
      },
    ];
    const turn = await this.llm.streamAgentConversation(
      { messages, tools: [], orgId, userId, agentDisplayName },
      {
        signal,
        onFrame: (f) => {
          if (f.type === 'token') emit(f);
        },
      },
    );
    await this.storage.conversations.appendMessage({
      conversationId,
      role: 'assistant',
      content: turn.text,
      status: 'sent',
    });
    emit({ type: 'done' });
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (extracted so tests + future admin tools can exercise them).
// ---------------------------------------------------------------------------

/**
 * Phase 36 ATOOL-04 — extract rationale from an assistant turn for audit
 * persistence. Combines `thinking` (when present, e.g. Anthropic) with
 * `text` (any provider). Whitespace-only inputs collapse to null.
 *
 * Order: thinking precedes text — matches the order the model emits them
 * (chain-of-thought, then user-visible preamble before the tool_use block).
 */
export function extractRationale(
  turn: { readonly text: string; readonly thinking?: string },
): string | null {
  const parts: string[] = [];
  const t = (turn.thinking ?? '').trim();
  if (t.length > 0) parts.push(t);
  const x = turn.text.trim();
  if (x.length > 0) parts.push(x);
  return parts.length === 0 ? null : parts.join('\n\n');
}

/**
 * Phase 36 ATOOL-02 — build the retry-guidance string appended to a failed
 * tool result before the model sees it. When `retriesRemaining > 0` the
 * model is told it may retry; when `0` it is told the budget is exhausted.
 * Successful results return null (no guidance needed).
 *
 * The shared per-turn budget starts at 3 (D-CONTEXT) and is decremented for
 * every non-success outcome until it reaches zero.
 */
export function buildRetryGuidance(
  result: ToolDispatchResult,
  retriesRemaining: number,
): string | null {
  if (typeof result !== 'object' || result === null || !('error' in result)) {
    return null;
  }
  const sentinel = (result as { error: string }).error;
  if (retriesRemaining > 0) {
    return `Tool call failed: ${sentinel}. You have ${retriesRemaining} retry attempt(s) remaining for this turn — you may retry with different arguments, switch to another tool, or proceed with what you have.`;
  }
  return `Tool call failed: ${sentinel}. The retry budget for this turn is exhausted; do not retry this tool. Proceed with the information you have.`;
}

function buildManifest(
  allTools: readonly ToolMetadata[],
  perms: ReadonlySet<string>,
  catalog: Record<string, AgentToolCatalogEntry> = {},
): readonly AgentToolDef[] {
  return allTools
    .filter((t) => t.requiredPermission === undefined || perms.has(t.requiredPermission))
    .map((t) => {
      const entry = catalog[t.name];
      const description = entry?.description ?? '';
      const inputSchema =
        entry?.inputSchema != null && typeof entry.inputSchema === 'object'
          ? (entry.inputSchema as Record<string, unknown>)
          : { type: 'object' };
      return { name: t.name, description, inputSchema };
    });
}

export function windowToChatMessages(window: readonly Message[]): AgentChatMessage[] {
  const out: AgentChatMessage[] = [];
  // Track which tool_call ids the most recent assistant(tool_calls) row
  // already declared. Tool rows whose own toolCallJson references an id
  // OUTSIDE this set must synthesise their own assistant(tool_calls)
  // preamble, otherwise providers (Ollama, OpenAI, Anthropic) see a tool
  // result with no matching prior tool_call and reject the request.
  //
  // Background: Phase 32.1-08 introduced assistant(tool_calls) batch rows
  // that cover the *whole* batch from a single LLM streaming turn. But
  // mid-conversation rows can still appear that are NOT part of that batch
  // — most notably the destructive-pause `pending_confirmation` tool row
  // (see runTurn line 444) which is persisted alone with its own
  // toolCallJson and resumed in a fresh turn. The original "skip shim if
  // last assistant had any tool_calls" logic dropped the synthetic
  // preamble for those rows, producing N+M tool results against an N-call
  // assistant message — Ollama responds 400 "Unexpected tool call id <X>
  // in tool results".
  let coveredIds: Set<string> = new Set();

  for (const m of window) {
    const role = m.role;
    if (role === 'tool') {
      if (m.toolCallJson != null && m.toolCallJson.length > 0) {
        try {
          const parsed = JSON.parse(m.toolCallJson) as
            | { id: string; name: string; args: Record<string, unknown> }
            | Array<{ id: string; name: string; args: Record<string, unknown> }>;
          const call = Array.isArray(parsed) ? parsed[0] : parsed;
          if (call !== undefined && !coveredIds.has(call.id)) {
            // This tool row's call id was NOT declared by the preceding
            // assistant batch — synthesise a single-call assistant
            // preamble so the provider sees a valid pair.
            out.push({
              role: 'assistant' as const,
              content: '',
              toolCalls: [{ id: call.id, name: call.name, args: call.args }],
            });
            coveredIds = new Set([call.id]);
          }
        } catch { /* invalid JSON shouldn't happen — fall through */ }
      }
      const content = m.toolResultJson ?? '';
      out.push({ role: 'tool' as const, content });
      continue;
    }
    if (role === 'assistant') {
      // Plan 32.1-08: assistant rows that preceded a tool batch carry
      // toolCallJson with the full batch array — re-emit with the
      // toolCalls field so the provider sees an assistant(tool_calls) →
      // tool pair, and record every id as "covered" so the followers do
      // not trigger the synthesis path above.
      if (m.toolCallJson != null && m.toolCallJson.length > 0) {
        try {
          const calls = JSON.parse(m.toolCallJson) as Array<{ id: string; name: string; args: Record<string, unknown> }>;
          if (Array.isArray(calls) && calls.length > 0) {
            out.push({
              role: 'assistant' as const,
              content: m.content ?? '',
              toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
            });
            coveredIds = new Set(calls.map((c) => c.id));
            continue;
          }
        } catch { /* fall through to plain assistant */ }
      }
      coveredIds = new Set();
      out.push({ role: 'assistant' as const, content: m.content ?? '' });
      continue;
    }
    coveredIds = new Set();
    out.push({ role: 'user' as const, content: m.content ?? '' });
  }
  return out;
}

/**
 * Bound tool-result JSON to TOOL_RESULT_MAX_BYTES. When oversized, returns a
 * sentinel `{ _truncated: true, size: <original bytes> }` rather than trimming
 * the JSON mid-string (which would produce invalid JSON). The sentinel signals
 * to the model "this result was too big; call a narrower tool or ask the
 * user" per AI-SPEC §4.
 *
 * Exported for unit tests; not part of the public AgentService surface.
 */
export function truncateResultForStorage(result: unknown): string {
  const serialised = JSON.stringify(result);
  if (serialised === undefined) {
    // JSON.stringify of undefined returns undefined; coerce to a typed null.
    return JSON.stringify({ _truncated: false });
  }
  if (Buffer.byteLength(serialised, 'utf8') <= TOOL_RESULT_MAX_BYTES) {
    return serialised;
  }
  return JSON.stringify({ _truncated: true, size: Buffer.byteLength(serialised, 'utf8') });
}

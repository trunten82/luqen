# Phase 34: Tokenizer Precision - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the `char/4` heuristic in `packages/dashboard/src/agent/token-budget.ts` with a per-provider precise tokenizer feeding the 85% compaction trigger. One `countTokens(messages, model)` interface covering Ollama, OpenAI, and Anthropic. Total bundle impact <5 MB, pure-JS or wasm only (no native). Unknown models fall back to `char/4` with a warning log.

Out of scope: changing compaction UX, summary format, thresholds, or adding model-aware context-window detection (already handled elsewhere).

</domain>

<decisions>
## Implementation Decisions

### Tokenizer Libraries (per provider)
- **D-01:** OpenAI models → `js-tiktoken` (pure JS port). Sync-friendly, ~1 MB bundled, covers cl100k/o200k encodings.
- **D-02:** Anthropic models → `@anthropic-ai/tokenizer` (official JS tokenizer package). Offline, sync. Acknowledged imperfect for Claude 3/4 but closest available without API round-trips.
- **D-03:** Ollama models → query Ollama's `/api/show` endpoint to pull tokenizer metadata, then cache the vocab/tokenizer per model for the process lifetime. If `/api/show` fails or the model lacks tokenizer metadata, fall back to char/4 + warning (see D-08).

### API Shape
- **D-04:** `countTokens(messages, model)` stays **sync** (returns `number`). Caller at `agent-service.ts:260` does not need to become async.
- **D-05:** Encoders pre-warmed at AgentService startup for the currently configured model(s). First-call lazy init is acceptable for rarely-used models but the hot path must be warm.

### Model Identification & Fallback
- **D-06:** Explicit **registry map** maps known model strings → `{ provider, encoding }`. E.g. `gpt-4o → { openai, o200k_base }`, `claude-3-5-sonnet → { anthropic }`, `llama3.1 → { ollama }`.
- **D-07:** Miss in the registry triggers the char/4 fallback path.
- **D-08:** Unknown-model warning logged **once per process per model** (deduped via in-memory `Set`). Identifies the model string so coverage gaps are visible without log spam.

### Token-Count Scope
- **D-09:** Count includes:
  - Message **content** (text)
  - **Tool-call JSON envelopes** — `tool_calls` arguments and tool-result content, serialized as they would be sent to the provider
- **D-10:** Count **excludes** the system prompt and tool schema definitions. Rationale: compaction currently operates on the rolling message window; system prompt + tool schemas are fixed overhead budgeted elsewhere. Can be revisited in a later phase if 85% trigger fires too late in practice.
- **D-11:** Per-message envelope tax: add a **fixed per-message overhead** (e.g. +3–4 tokens/msg, matching OpenAI's documented chat-format overhead for role markers and separators). Single constant, not per-provider branching.

### Claude's Discretion
- Exact registry entries and encoding names per OpenAI/Anthropic model (look up current public guidance during planning).
- Pre-warm trigger point inside `AgentService` (constructor vs first request) — pick whichever is cleanest without blocking startup.
- Logger to use for the unknown-model warning — match the existing logger already wired into `token-budget.ts` / `agent-service.ts`.
- Telemetry counter for unknown-model events (nice-to-have, not required by success criteria).
- Ollama tokenizer cache shape and TTL — keep simple (Map keyed by model, process-lifetime).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Current implementation (what is being replaced)
- `packages/dashboard/src/agent/token-budget.ts` — current `estimateTokens()`, `DEFAULT_MODEL_MAX_TOKENS`, `COMPACTION_THRESHOLD`, `MIN_KEEP_TURNS`.
- `packages/dashboard/src/agent/agent-service.ts` §~260 — call site that invokes `estimateTokens` and decides when to compact.

### Requirements
- `.planning/REQUIREMENTS.md` — TOK-01 through TOK-05.
- `.planning/ROADMAP.md` §Phase 34 — goal + success criteria (4 items).

### External (to be verified during planning research)
- `js-tiktoken` npm package (OpenAI tokenization).
- `@anthropic-ai/tokenizer` npm package (Anthropic tokenization).
- Ollama `/api/show` endpoint documentation (model tokenizer metadata retrieval).

No ADRs exist for this area yet.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `estimateTokens(messages)` and `shouldCompact(tokens, max)` in `token-budget.ts` — surface stays; internal implementation swaps. Keeping the same exports minimises caller churn.
- AgentService already owns the provider/model selection; it is the natural place to resolve `model` → `provider` and pre-warm encoders.

### Established Patterns
- `token-budget.ts` is sync and monotonic (tests depend on monotonicity). New `countTokens()` must preserve monotonicity: adding any character to any message must not decrease the count.
- Tool-call content is already included in the char-based estimate via `JSON.stringify(toolCalls).length` — precise path must maintain parity so compaction behaviour stays observable.
- Ollama adapter lives in `packages/llm/src/providers/ollama.ts` — reuse its HTTP client / base URL config for the `/api/show` call rather than hand-rolling.

### Integration Points
- Call site: `packages/dashboard/src/agent/agent-service.ts:260` (and possibly tests under `packages/dashboard/tests/agent/`).
- Tests: `packages/dashboard/tests/agent/agent-service.test.ts` and any dedicated `token-budget` tests need new cases for: precise-count path, unknown-model fallback + warning, sync contract, tool-call inclusion, per-message tax.

</code_context>

<specifics>
## Specific Ideas

- Keep `estimateTokens` export as a thin alias or rename to `countTokens` — downstream agent should pick one and update callers + tests consistently.
- Warning log message should include the model string verbatim so ops can grep for missing coverage.
- Bundle-size acceptance check: verify total added weight from js-tiktoken + @anthropic-ai/tokenizer + Ollama vocab cache stays under the 5 MB budget (TOK-02). Note any outcome in the plan.

</specifics>

<deferred>
## Deferred Ideas

- System-prompt + tool-schema token accounting. Currently out of scope; revisit if 85% trigger fires too late in practice after this phase ships.
- Per-provider envelope overhead tuning (OpenAI vs Anthropic vs Ollama specific formulas). Using a single fixed per-message tax for now.
- Anthropic `/v1/messages/count_tokens` API path. Rejected for this phase (adds latency + network dep); could revisit if offline tokenizer drift becomes material.
- Metric counter for unknown-model warnings (nice-to-have observability; not required by success criteria).

</deferred>

---

*Phase: 34-tokenizer-precision*
*Context gathered: 2026-04-24*

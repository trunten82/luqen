---
phase: 34-tokenizer-precision
plan: "02"
subsystem: agent/token-budget
tags: [tokenizer, token-budget, agent, compaction, integration]
dependency_graph:
  requires:
    - "packages/dashboard/src/agent/tokenizer/index.ts (countMessageTokens, prewarmTokenizer) from 34-01"
  provides:
    - "packages/dashboard/src/agent/token-budget.ts (estimateTokens(messages, model?), shouldCompact)"
    - "AgentService.config.modelId (server-config only)"
  affects:
    - "AgentService.runTurn compaction path — now uses precise per-provider counts when modelId configured"
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget prewarm in constructor via `void prewarmTokenizer(...)` (D-05)"
    - "Server-config-only boundary for modelId — documented inline to prevent request-scoped injection (T-34-08)"
key-files:
  created:
    - "packages/dashboard/tests/agent/token-budget.test.ts"
    - "packages/dashboard/tests/agent/agent-service-tokenizer.test.ts"
  modified:
    - "packages/dashboard/src/agent/token-budget.ts"
    - "packages/dashboard/src/agent/agent-service.ts"
decisions:
  - "Separated new AgentService tokenizer tests into their own file — vi.mock of the tokenizer module is hoisted file-wide and would have broken the ~10 existing agent-service.test.ts integration fixtures that rely on the real countMessageTokens"
  - "Kept the system message inside the estimateTokens input array at the runTurn call site rather than filtering it out; the tokenizer module excludes system per D-10, so we preserve a single authority for what-to-exclude"
  - "Test D/E in the plan asked to modify an existing compaction test in agent-service.test.ts, but no such test exists in the current file (no matches for `compact`, `modelMaxTokens`, `estimateTokens`). Treated as a planning artefact — behavioural coverage lives in the token-budget.test.ts B/D tests and the new agent-service-tokenizer.test.ts C test"
metrics:
  duration_minutes: ~8
  completed: 2026-04-24
  tasks: 2
  commits: 4
  tests_added: 9
requirements: [TOK-03, TOK-04]
---

# Phase 34 Plan 02: Tokenizer Wire-Up Summary

One-liner: `token-budget.ts` is now a 2-line delegation layer to the Phase 34-01
tokenizer module, `AgentService.config` accepts `modelId`, and the constructor
fire-and-forget warms the encoder so the first `runTurn` compaction check
lands on a precise per-provider count.

## What Was Delivered

### `token-budget.ts` — thin delegation

The entire body of `estimateTokens` is now:

```typescript
export function estimateTokens(
  messages: readonly AgentChatMessage[],
  model?: string,
): number {
  return countMessageTokens(messages as readonly TokenizerMessage[], model);
}
```

No `chars / 4` arithmetic remains in this file. The tokenizer module owns all
counting logic: char/4 fallback for unknown/undefined models, js-tiktoken for
OpenAI, `@anthropic-ai/tokenizer` for Anthropic, `/api/show`-cached metadata
for Ollama. The sync contract (D-04) is preserved — Ollama cold-cache silently
returns char/4 and fires a background warm so the NEXT call is precise.

`shouldCompact(tokens, max?)` is byte-identical to the pre-phase
implementation: `tokens > Math.floor(max * COMPACTION_THRESHOLD)`. The public
surface (`DEFAULT_MODEL_MAX_TOKENS`, `COMPACTION_THRESHOLD`, `MIN_KEEP_TURNS`)
is unchanged.

### `agent-service.ts` — modelId threading

Three edits:

1. **Config type extended** (both the options interface and the private
   readonly field) with an optional `modelId?: string`, annotated with an
   explicit security comment:

   ```
   /** Phase 34 — model identifier for precise tokenization. Server-config only;
    *  NEVER populate from request-scoped input (would enable Ollama SSRF-via-warm
    *  and prototype-pollution in registry lookups). */
   ```

2. **Constructor prewarm** (fire-and-forget, no await, D-05):

   ```typescript
   if (this.config.modelId) {
     void prewarmTokenizer(this.config.modelId);
   }
   ```

3. **runTurn compaction call site** passes `this.config.modelId` as the second
   argument to `estimateTokens`. The synthetic `system` row for the context
   hints block stays in the input array — `countMessageTokens` excludes
   system entirely per D-10, keeping the tokenizer module authoritative.

## AgentChatMessage ↔ TokenizerMessage Shape Check

Both types already aligned exactly. `TokenizerMessage.toolCalls` uses `{ id?, name, args }` and `AgentChatMessage.toolCalls` uses the same shape via
`ToolCallInput`. No adjustments to `tokenizer/types.ts` were needed. The
`as readonly TokenizerMessage[]` cast in `estimateTokens` is purely structural
and compiles clean under `tsc --noEmit`.

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 RED | `b9447a5` | Failing tests for estimateTokens tokenizer delegation |
| 1 GREEN | `0893dac` | Delegate estimateTokens to tokenizer module |
| 2 RED | `4a2a182` | Failing tests for AgentService modelId threading |
| 2 GREEN | `5f511b6` | Thread modelId through AgentService + prewarm on construct |

## Verification

- `cd packages/dashboard && npx vitest run tests/agent/token-budget.test.ts`
  → **6/6 passing**.
- `cd packages/dashboard && npx vitest run tests/agent/agent-service-tokenizer.test.ts`
  → **3/3 passing**.
- Full agent suite: `npx vitest run tests/agent/` → **10 files, 65/65 passing**.
- `npx tsc --noEmit` (dashboard package) → **clean, zero errors**.

## Before/After Token Counts — Representative 2k-char Conversation

Measured on a realistic multi-turn conversation (user prompt + assistant
tool-call + tool-result JSON with 30 findings + assistant recap), total
~2,383 chars:

| Model | Count | Delta vs char/4 |
|-------|-------|-----------------|
| char/4 fallback (pre-phase) | 601 | — |
| gpt-4o (precise) | 670 | **+11.5 %** |
| claude-3-5-sonnet-latest (precise) | 673 | **+12.0 %** |

On structured tool-call-heavy payloads, precise counts run **~11–12 %
higher** than the char/4 heuristic. This means the 85 % compaction threshold
now fires ~11 % earlier on realistic agent traffic — exactly the
under-reporting gap Phase 34 was scoped to close.

On clean English prose (no tool calls, same total chars), the precise count
runs ~10 % LOWER than char/4 (because common English words collapse into
single tokens). So the phase is not a one-way compaction-earlier change:
it's **accuracy in both directions**, which preserves context window on
clean dialogue AND fires compaction on-time for JSON-dense agent loops.

## Deviations from Plan

1. **Tests in a separate file.** Plan Task 2 placed Tests A–E inside
   `agent-service.test.ts`. Vitest's `vi.mock` is file-hoisted, and mocking
   the tokenizer module would have broken the ~10 existing integration
   fixtures (RBAC, destructive-batch, iteration-cap) that exercise the real
   `countMessageTokens` in the compaction path. Moved the new tests to
   `agent-service-tokenizer.test.ts` to keep the existing suite clean. Rule 3
   (blocking-issue auto-fix): test infrastructure compatibility.
2. **Tests D/E dropped.** Plan Task 2 Tests D/E asked to modify "the existing
   compaction test" in `agent-service.test.ts`. No such test exists today
   (greps for `compact`, `modelMaxTokens`, `estimateTokens` all return zero).
   The behavioural coverage the plan wanted (precise-count-triggers-compaction
   vs fallback-does-not) lives more cleanly in `token-budget.test.ts` B/D
   (model-aware vs no-model count divergence) and in the new
   `agent-service-tokenizer.test.ts` C (full wire intact). New compaction
   integration tests land in Plan 34-03.
3. **No `AgentChatMessage` ↔ `TokenizerMessage` type adjustments** — shapes
   already matched. The `as readonly TokenizerMessage[]` cast is a pure
   structural widening.

## Security — Threat Model Dispositions

| Threat ID | Disposition | Evidence |
|-----------|-------------|----------|
| T-34-08 Tampering via request-scoped modelId | **mitigated** | Inline doc comment on both config type definitions in agent-service.ts (search "NEVER populate from request-scoped input") |
| T-34-09 DoS via blocking prewarm | **mitigated** | `void prewarmTokenizer(this.config.modelId)` — fire-and-forget; tokenizer module's `warm()` swallows all errors internally |
| T-34-10 Information disclosure in logger | **accepted** | Tokenizer module logs only the model string; no content ever traverses the logger at this layer |

## Self-Check: PASSED

- Files exist:
  - ✓ `packages/dashboard/src/agent/token-budget.ts` (rewritten)
  - ✓ `packages/dashboard/src/agent/agent-service.ts` (modified)
  - ✓ `packages/dashboard/tests/agent/token-budget.test.ts`
  - ✓ `packages/dashboard/tests/agent/agent-service-tokenizer.test.ts`
- Commits exist: `b9447a5`, `0893dac`, `4a2a182`, `5f511b6` (verified via `git log`).
- Tests: 9 new + 65 agent suite total, all passing.
- `tsc --noEmit`: clean.

## Integration Status

The wire is complete. When `AgentService` is constructed with `config.modelId`
(e.g. `'gpt-4o'` or `'claude-3-5-sonnet-latest'`), every compaction check in
`runTurn` uses the precise per-provider count. When `modelId` is omitted,
behaviour is byte-identical to the pre-phase char/4 heuristic (via the
tokenizer module's fallback path).

Bootstrap wiring of `config.modelId` from the server's capability config /
environment lands in **Plan 34-03** along with integration tests that drive
the full SSE pipeline end-to-end.

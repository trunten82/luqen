---
phase: 36-multi-step-tool-use
plan: 03
subsystem: dashboard/agent
tags: [agent, atool-01, atool-02, atool-03, atool-04, parallel, retry-budget, rationale, sse]
requires:
  - ToolDispatcher.dispatch (Phase 32-04)
  - dispatchAll + tool_started/tool_completed frames (Phase 36-02)
  - agent_audit_log.rationale + outcomeDetail filter (Phase 36-01)
provides:
  - AgentService.runTurn parallel batch dispatch via Promise.all of per-call dispatch
  - Shared per-turn retry budget (3) with retry-guidance string injection into failed tool results
  - Per-assistant-turn rationale capture (thinking + text) persisted to every audit row in the batch
  - Per-tool tool_started / tool_completed SSE frame emission
  - Synthetic tool_completed{toolCallId='__loop__', errorMessage='iteration_cap'} chip frame for cap-hit UX
  - extractRationale + buildRetryGuidance pure helper exports
  - AgentStreamTurn.thinking?: string interface extension
affects:
  - Frontend chip strip (consumer wiring lands in 36-04)
  - /admin/audit row rationale display (consumer surface lands in 36-04 / future)
tech-stack:
  added: []
  patterns:
    - Per-call .then(emit) inside Promise.all (preserves accurate event ordering vs. dispatchAll-then-iterate)
    - Closure-scoped retry budget object passed by reference (LLM-untamperable per T-36-08)
    - Immutable result wrapping ({...result, _guidance}) — never mutates dispatcher output
    - Synthetic SseFrame overload (tool_completed for __loop__) — avoids inventing a new frame type
key-files:
  created: []
  modified:
    - packages/dashboard/src/agent/agent-service.ts
    - packages/dashboard/tests/agent/agent-service.test.ts
decisions:
  - Use per-call dispatcher.dispatch().then(emit) inside Promise.all in production, NOT dispatchAll, so each tool_completed frame fires the moment its own promise resolves (per plan 36-03 §action 1d). dispatchAll from 36-02 remains the public batch API for non-streaming callers.
  - Retry budget is a closure-scoped { remaining: number } object — LLM cannot influence; budget=3 is a hardcoded constant per D-CONTEXT (T-36-08 mitigation).
  - Iteration-cap chip uses tool_completed{toolCallId='__loop__'} synthetic overload rather than introducing a new SSE frame type. Frontend in 36-04 translates this into the i18n chip text (T-36-10 mitigation: textContent only, no DOM injection).
  - Audit row order in test E checked by content (toolName + argsJson), not chronological, because parallel writes within the same millisecond yield unstable ORDER BY created_at DESC ordering.
metrics:
  duration: ~25 min
  completed: 2026-04-24
requirements: [ATOOL-01, ATOOL-02, ATOOL-03, ATOOL-04]
---

# Phase 36 Plan 03: Parallel Dispatch + Retry Budget + Rationale + Per-Tool SSE Summary

Rewires `AgentService.runTurn` to fan out tool calls concurrently, capture rationale per assistant turn, manage a shared per-turn retry budget, and emit per-tool lifecycle SSE frames — implementing all four ATOOL requirements in the agent loop.

## Code Path Diff in `runTurn`

**Before** (sequential per-call dispatch):
```ts
for (const call of turn.toolCalls) {
  await this.dispatchAndPersist({ call, conversationId, userId, orgId, signal });
}
```

**After** (single batch helper):
```ts
const retryBudget = { remaining: 3 };  // hoisted to top of runTurn try-block
// ...
await this.dispatchBatchAndPersist({
  turn, conversationId, userId, orgId, signal, emit, retryBudget,
});
```

`dispatchAndPersist` was deleted; `dispatchBatchAndPersist` is the single tool-call entry point.

## Helper Exports (Task 1)

```ts
export function extractRationale(turn: { text: string; thinking?: string }): string | null
export function buildRetryGuidance(result: ToolDispatchResult, retriesRemaining: number): string | null
```

`AgentStreamTurn` interface extended with `readonly thinking?: string` so provider adapters can opt in (Anthropic in particular). No `llm-client.ts` changes in this plan — thinking remains undefined until a future provider plan wires it.

## Retry-Budget Design

- Budget = 3 per `runTurn` (per turn, not per iteration), declared as `{ remaining: 3 }` closure-scoped at the top of the try block.
- Passed by reference into `dispatchBatchAndPersist`.
- For each settled result, `buildRetryGuidance` is called with `retryBudget.remaining`. If guidance is non-null (i.e. failure), `remaining` is decremented (clamped at 0).
- When `remaining === 0`, guidance string flips to the "exhausted, do not retry" branch — still includes the error sentinel so the model sees what went wrong, but omits all retry-permission language.
- LLM cannot tamper with the budget: it is closure-scoped inside `runTurn` and never serialised over the wire (T-36-08).

## dispatchAll vs. per-call .then

Per plan 36-03 §action 1d, the production batch helper calls `dispatcher.dispatch(call, ctx).then((result) => { emit(tool_completed); return result })` per call inside `Promise.all`, **not** `dispatcher.dispatchAll`. Rationale: it keeps the per-tool `tool_completed` SSE frame fired the instant its own promise resolves, which preserves accurate event ordering for the frontend chip strip (slow handler completing first emits its checkmark first).

`dispatchAll` from 36-02 stays in the public API surface for non-streaming callers (future MCP server batch paths, future test helpers) — unchanged.

## Iteration-Cap Chip Frame

Right before `forceFinalAnswer`, runTurn now emits a synthetic `tool_completed` frame:

```ts
emit({
  type: 'tool_completed',
  toolCallId: '__loop__',
  toolName: '__loop__',
  status: 'error',
  errorMessage: 'iteration_cap',
});
```

Avoids inventing a new SSE frame variant. Plan 36-04 translates `__loop__/iteration_cap` into the i18n chip "Reached tool limit — producing answer with what we have" using `textContent` only (T-36-10 mitigation).

## Test Count Delta

| File | Before | After |
|------|--------|-------|
| tests/agent/agent-service.test.ts | 9 | **26** |

Additions:
- 8 helper unit tests (extractRationale + buildRetryGuidance)
- 9 integration tests (Phase 36 multi-step describe: A–I)

All 26 in this file pass; full agent suite (15 files, 125 tests) green; full dashboard suite (229 files, 3185 tests) green.

## Verification

- `cd packages/dashboard && pnpm test` — 3185/3185 passing, 0 failed.
- `cd packages/dashboard && npx vitest run tests/agent/` — 125/125 passing.
- `cd packages/dashboard && npx tsc --noEmit` — clean.

## Threat-Model Coverage

| Threat | Disposition | How |
|--------|-------------|-----|
| T-36-07 (Info disclosure on rationale) | mitigated | Persisted via existing `agentAudit.append` repo (parameterised binds); access still gated by `/admin/audit` org-scope + admin permission. |
| T-36-08 (Retry budget bypass) | mitigated | Closure-scoped `{ remaining: 3 }` inside runTurn; never serialised; LLM has no surface to influence it. |
| T-36-09 (DoS via runaway tool loop) | mitigated | MAX_TOOL_ITERATIONS=5 unchanged; per-call timeout=30s inherited from dispatcher; 8KB tool-result truncation unchanged. |
| T-36-10 (Spoofing toolCallId in tool_completed) | mitigated | Plan 36-04 will use textContent on the chip strip. This plan only emits the contract. |

## Deviations from Plan

**Test E order assertion (Rule 1 — minor test bug)** — Plan asked for chronological audit-row ordering via `[...dispatchRows].reverse()`. In practice, parallel writes within the same millisecond yield unstable `ORDER BY created_at DESC` ordering on SQLite. Fixed by indexing rows by `toolName + argsJson` content instead of chronological position. Same intent (per-row outcome assertions); more robust to scheduling jitter. No production code change.

Otherwise plan executed exactly as written.

## Commits

| Commit | Type | Message |
|--------|------|---------|
| `112cb9f` | test | failing tests for extractRationale + buildRetryGuidance (Task 1 RED) |
| `642d957` | feat | extractRationale + buildRetryGuidance helpers (Task 1 GREEN) |
| `eda2563` | test | failing Phase 36 multi-step tests (Task 2 RED) |
| `2234a88` | feat | parallel dispatch, retry budget, rationale + per-tool SSE in runTurn (Task 2 GREEN) |

## Self-Check: PASSED

- FOUND: packages/dashboard/src/agent/agent-service.ts (extractRationale + buildRetryGuidance exported; dispatchBatchAndPersist replaces dispatchAndPersist; retryBudget hoisted; iteration-cap synthetic tool_completed emitted; AgentStreamTurn.thinking added)
- FOUND: packages/dashboard/tests/agent/agent-service.test.ts (8 helper tests + 9 Phase 36 integration tests A–I)
- FOUND: commit 112cb9f (Task 1 RED)
- FOUND: commit 642d957 (Task 1 GREEN)
- FOUND: commit eda2563 (Task 2 RED)
- FOUND: commit 2234a88 (Task 2 GREEN)
- Vitest: 26/26 in agent-service.test.ts; 125/125 across tests/agent/; 3185/3185 across full dashboard suite
- tsc --noEmit: clean

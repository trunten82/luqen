---
phase: 36-multi-step-tool-use
plan: 02
subsystem: dashboard/agent
tags: [agent, tool-dispatch, sse, atool-01, parallel]
requires:
  - ToolDispatcher.dispatch (Phase 32-04)
  - SseFrameSchema discriminated-union + writeFrame (Phase 32-04)
provides:
  - ToolDispatcher.dispatchAll(calls, ctx) — parallel batch dispatch, input-order results
  - ToolStartedFrameSchema + ToolCompletedFrameSchema added to SseFrameSchema union
  - ToolStartedFrame + ToolCompletedFrame exported types
affects:
  - AgentService loop (consumer wiring deferred to Plan 36-03)
  - dashboard chip strip UX (consumer wiring deferred to Plan 36-04)
tech-stack:
  added: []
  patterns:
    - Unbounded Promise.all (per-call DEFAULT_TIMEOUT_MS = 30s bounds runtime)
    - Input-order result aggregation (preserves model's tool_use → tool_result pairing)
    - zod discriminated-union extension at writeFrame chokepoint
    - Per-tool errors via tool_completed{status:error}, NOT via global ErrorFrame
key-files:
  created: []
  modified:
    - packages/dashboard/src/agent/tool-dispatch.ts
    - packages/dashboard/src/agent/sse-frames.ts
    - packages/dashboard/tests/agent/tool-dispatch.test.ts
    - packages/dashboard/tests/agent/sse-frames.test.ts
decisions:
  - dispatchAll delegates to existing per-call dispatch — timeout/JWT/scope path unchanged
  - No semaphore / no per-name dedupe / no early-abort — siblings always settle
  - Per-tool failures surface as tool_completed{status:'error'}; ErrorFrame stays reserved for turn-fatal conditions
  - calls.length === 0 short-circuits before any signer/scope work
metrics:
  duration: ~10 min
  completed: 2026-04-24
requirements: [ATOOL-01]
---

# Phase 36 Plan 02: Parallel Dispatch + Tool Lifecycle SSE Frames Summary

Foundation for parallel tool dispatch and per-tool streaming visibility. Two atomic, independently-testable surface extensions ship without yet touching `AgentService` (deferred to 36-03).

## dispatchAll Signature

```ts
async dispatchAll(
  calls: readonly ToolCallInput[],
  ctx: Omit<ToolDispatchContext, 'authToken'>,
): Promise<readonly ToolDispatchResult[]>
```

- Empty input short-circuits to `[]` synchronously — no signer or scope work.
- Otherwise: `Promise.all(calls.map((c) => this.dispatch(c, ctx)))` — unbounded concurrency.
- Returns results in **input order**, preserving the model's expected tool_use → tool_result pairing.
- Per-call timeout (30s default), JWT mint, scope resolution, and error sentinels are inherited from `dispatch()` — no duplicated logic.

## Concurrency Proof (Test 3)

Two handlers each resolving after 50 ms, dispatched as a batch:

```
expect(elapsed).toBeLessThan(90);
```

Local run: well under 90 ms (typical ~52–55 ms). If sequential, would be ≥100 ms. Promise.all parallelism confirmed.

## Sibling Isolation

| Test | Position 0 | Position 1     | Position 2 | Result                                                                    |
| ---- | ---------- | -------------- | ---------- | ------------------------------------------------------------------------- |
| 4    | fast       | hang (timeout) | fast       | `[ok, {error:'timeout'}, ok]` — timeout sentinel does not abort siblings |
| 5    | known      | unknown_tool   | known      | `[ok, {error:'unknown_tool'}, ok]` — unknown name does not propagate     |
| 6    | hang       | hang           | (aborted)  | both resolve to per-handler error sentinels; `dispatchAll` never throws  |

## New SSE Frame Schemas

```ts
export const ToolStartedFrameSchema = z.object({
  type: z.literal('tool_started'),
  toolCallId: z.string(),
  toolName: z.string(),
});

export const ToolCompletedFrameSchema = z.object({
  type: z.literal('tool_completed'),
  toolCallId: z.string(),
  toolName: z.string(),
  status: z.enum(['success', 'error']),
  errorMessage: z.string().optional(),
});
```

Both members added to `SseFrameSchema` discriminated union. `writeFrame` continues to be the single chokepoint — malformed frames throw before any bytes hit `reply.raw`.

`ErrorFrameSchema.code` enum **not extended**: per-call errors are routed through `tool_completed{status:'error'}`, leaving the global `ErrorFrame` reserved for turn-fatal conditions (provider failure, iteration cap, rate limit, internal, tool_timeout).

## Test Count Delta

| File                                          | Before | After  |
| --------------------------------------------- | ------ | ------ |
| tests/agent/tool-dispatch.test.ts             | 5      | **11** |
| tests/agent/sse-frames.test.ts                | 6      | **12** |
| **Total**                                     | **11** | **23** |

All 23 passing. Existing tests untouched.

## Verification

- `npx tsc --noEmit` — clean across `packages/dashboard`.
- `npx vitest run tests/agent/tool-dispatch.test.ts tests/agent/sse-frames.test.ts` — 23/23 passing.
- No production AgentService changes — foundation only; consumer wiring lands in 36-03 (loop) and 36-04 (chip strip).

## Threat Model Coverage

- **T-36-04 (Tampering on SSE frame contract):** Mitigated — `writeFrame` still zod-parses every frame against the extended `SseFrameSchema`. New frame variants required no changes to the chokepoint.
- **T-36-05 (Spoofing toolName / errorMessage in chip strip):** Plan 36-04 will use `textContent` / `createElement` (no innerHTML). This plan only ships the contract; no DOM rendering yet.
- **T-36-06 (DoS via unbounded Promise.all):** Accepted as planned. Per-call 30 s timeout bounds runtime; iteration cap (5) bounds calls per turn. Documented in 36-CONTEXT.md "Concurrency model".

## Deviations from Plan

None — plan executed exactly as written. Two minor judgement calls:

- **Test 5 + Test 6 use a single `ok` handler for multiple slots** (instead of three distinct stubs) since the assertion is about isolation, not handler identity. Same intent as the plan; less ceremony.
- **Tests assert `toEqual({error:'timeout'})` rather than the loose pattern** in the plan brief, because the dispatcher's behavior is deterministic for that path.

## Commits

| Commit    | Type | Message                                                              |
| --------- | ---- | -------------------------------------------------------------------- |
| `74ee99e` | test | add failing dispatchAll tests (RED)                                  |
| `f114cf3` | feat | add ToolDispatcher.dispatchAll for parallel batch dispatch (GREEN)   |
| `b61b581` | test | add failing tool lifecycle SSE frame tests (RED)                     |
| `360a092` | feat | add tool_started + tool_completed SSE frame variants (GREEN)         |

## Self-Check: PASSED

- FOUND: packages/dashboard/src/agent/tool-dispatch.ts (dispatchAll method present)
- FOUND: packages/dashboard/src/agent/sse-frames.ts (ToolStartedFrameSchema + ToolCompletedFrameSchema in union)
- FOUND: packages/dashboard/tests/agent/tool-dispatch.test.ts (6 new tests under dispatchAll describe)
- FOUND: packages/dashboard/tests/agent/sse-frames.test.ts (6 new tests under "Tool lifecycle frames")
- FOUND: commit 74ee99e (Task 1 RED)
- FOUND: commit f114cf3 (Task 1 GREEN)
- FOUND: commit b61b581 (Task 2 RED)
- FOUND: commit 360a092 (Task 2 GREEN)
- Vitest: 23/23 passing across both files
- tsc --noEmit: clean

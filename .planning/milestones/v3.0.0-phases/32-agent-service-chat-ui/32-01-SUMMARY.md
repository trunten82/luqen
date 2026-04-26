---
phase: 32-agent-service-chat-ui
plan: 01
subsystem: llm-providers
tags: [anthropic, openai, ollama, streaming, sse, ndjson, tool-use, tdd, vitest]

# Dependency graph
requires:
  - phase: 02-llm-module-foundation
    provides: LLMProviderAdapter interface, OpenAI + Ollama adapters, registry
provides:
  - Token-level streaming contract via completeStream() on LLMProviderAdapter
  - StreamFrame discriminated union (token | tool_calls | done | error)
  - ChatMessage / ToolDef / ToolCall type contracts
  - OpenAI streaming adapter with D-11 tool_call argument buffering
  - Ollama streaming adapter with D-11 end-of-turn tool_calls batch
  - NEW Anthropic provider adapter (@anthropic-ai/sdk 0.90.0 pinned)
  - Shared streaming helpers (readSsePayloads, readNdjsonLines, anySignal, validateStreamFrame)
  - Provider parity baseline fixture for cross-adapter regression checks
affects: [32-02-agent-conversation-capability, 32-04-agent-service, 32-05-agent-routes, future-provider-additions]

# Tech tracking
tech-stack:
  added:
    - "@anthropic-ai/sdk@0.90.0 (exact pin, no caret — supply-chain posture per threat_model T-32-01-06)"
  patterns:
    - "AsyncIterable<StreamFrame> generator contract for provider streaming"
    - "Provider-side tool_call buffering — consumers never see partial tool-call JSON (D-11)"
    - "Optional interface method (completeStream?) — non-streaming capabilities stay byte-compatible"
    - "Shared reader helpers for SSE (\\n\\n) and NDJSON (\\n) — single source of truth for byte→line transform"
    - "Anthropic-specific: client.messages.stream({...}).finalMessage() instead of hand-rolled input_json_delta accumulation (AI-SPEC §3 Pitfall 2)"

key-files:
  created:
    - packages/llm/src/providers/anthropic.ts
    - packages/llm/src/providers/streaming-helpers.ts
    - packages/llm/tests/providers/anthropic.test.ts
    - packages/llm/tests/providers/parity.test.ts
    - packages/llm/tests/providers/parity-baseline.json
  modified:
    - packages/llm/package.json (add @anthropic-ai/sdk@0.90.0 exact pin)
    - packages/llm/src/providers/types.ts (ChatMessage/ToolDef/ToolCall/StreamFrame + optional completeStream)
    - packages/llm/src/providers/openai.ts (add completeStream generator, delegate SSE reader to streaming-helpers)
    - packages/llm/src/providers/ollama.ts (add completeStream generator, delegate NDJSON reader to streaming-helpers)
    - packages/llm/src/providers/registry.ts (register AnthropicAdapter factory)
    - packages/llm/tests/providers/openai.test.ts (add 5 streaming tests)
    - packages/llm/tests/providers/ollama.test.ts (add 3 streaming tests)
    - packages/llm/tests/providers/registry.test.ts (add anthropic factory + getSupportedTypes parity)

key-decisions:
  - "Pin @anthropic-ai/sdk at exact 0.90.0 (no caret) — threat_model T-32-01-06 supply-chain posture"
  - "completeStream is OPTIONAL on the LLMProviderAdapter interface — all 4 existing capabilities remain byte-compatible"
  - "Anthropic adapter uses stream.finalMessage() helper instead of hand-rolling input_json_delta.partial_json accumulation (AI-SPEC §3 Pitfall 2)"
  - "Ollama tool_call ids are minted client-side via randomUUID() with prefix 'toolu_ollama_' — Ollama does not provide tool-call ids in its NDJSON response shape"
  - "D-11 ordering invariant enforced at adapter level: every token frame emits BEFORE the single tool_calls frame (Anthropic Test 14 pins this behavior)"
  - "REFACTOR produced streaming-helpers.ts with both shared readers AND validateStreamFrame guard — plan allowed either/or; both were extractable without overreach"
  - "Parity baseline fixture committed so future provider changes can be regression-checked via a single JSON diff (AI-SPEC §5.4)"

patterns-established:
  - "Streaming adapter pattern: async *completeStream(messages, options, signal) → AsyncIterable<StreamFrame> with ordering invariant (tokens BEFORE single tool_calls BEFORE terminal done/error)"
  - "Aborted signal BEFORE network call: adapter yields a provider_failed error frame with retryable:false and returns without issuing the fetch/SDK call — saves a round-trip and makes the abort observable to consumers"
  - "Supply-chain pin discipline: new runtime deps go in dependencies (not devDependencies) at an EXACT version — the ^x.y.z caret is not acceptable for runtime SDKs that span provider/privacy boundaries"
  - "Anthropic mock pattern for vitest: class-based `default` export so `new Anthropic(cfg)` works — vi.fn().mockImplementation() arrow fns are NOT valid constructors"

requirements-completed: [AGENT-02]

# Metrics
duration: ~10min
completed: 2026-04-20
---

# Phase 32 Plan 01: Streaming Providers + Anthropic Adapter Summary

**Extended `LLMProviderAdapter` with optional token-level `completeStream()`, added SSE streaming to OpenAI, NDJSON streaming to Ollama (removing `stream:false` from `complete()` path only — new generator uses `stream:true`), and introduced the Anthropic provider adapter wrapping `@anthropic-ai/sdk@0.90.0` — all under a unified `StreamFrame` discriminated union with a buffered-tool_calls ordering invariant (D-11).**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-20T07:33:27Z
- **Completed:** 2026-04-20T07:43:44Z
- **Tasks:** 3 (RED → GREEN → REFACTOR)
- **Files created:** 5
- **Files modified:** 8

## Accomplishments

- **LLMProviderAdapter extended** with optional `completeStream(messages, options, signal)` returning `AsyncIterable<StreamFrame>`. Non-streaming `complete()` path untouched — the 4 existing capabilities (extract-requirements, generate-fix, analyse-report, discover-branding) stay byte-compatible (43/43 capability tests pass with zero changes).
- **OpenAI streaming adapter** buffers `delta.tool_calls[].function.arguments` fragments per `index`, JSON.parses once on `finish_reason='tool_calls'`, emits exactly ONE `tool_calls` frame. No token frames for tool-call JSON. Request body includes `stream:true` + `stream_options:{include_usage:true}`.
- **Ollama streaming adapter** honors D-11 end-of-turn batching: ZERO token frames for empty `message.content`, ONE `tool_calls` frame when `done:true` carries `message.tool_calls`, terminal `done` with `finishReason:'tool_calls'`. Tool-call ids minted via `randomUUID()` because Ollama does not provide them.
- **Anthropic provider adapter (NEW)** wraps `@anthropic-ai/sdk@0.90.0` (exact pin). `complete()` maps `systemPrompt` to the top-level `system` parameter (not a message). `completeStream()` uses `client.messages.stream({...}).finalMessage()` to assemble `tool_use.input` objects (AI-SPEC §3 Pitfall 2 — never roll partial_json parser). Tool-result messages transform to Anthropic's `{role:'user', content:[{type:'tool_result', tool_use_id, content}]}` shape.
- **Ordering invariant (D-11, adapter-level)** locked by Anthropic Test 14: capture emit-frame array, assert every `token` frame index < the single `tool_calls` frame index.
- **Registry** exposes `['ollama','openai','anthropic']` via `getSupportedTypes()`; `createAdapter('anthropic')` returns a fresh `AnthropicAdapter`.
- **Shared helpers** extracted during REFACTOR: `readSsePayloads()`, `readNdjsonLines()`, `anySignal()`, `validateStreamFrame()`. Duplicated reader/decoder loops in openai.ts + ollama.ts now single-source-of-truth in `streaming-helpers.ts`.
- **Parity baseline** fixture (3 scenarios: plain text, single tool_call, invalid JSON args) committed at `packages/llm/tests/providers/parity-baseline.json` for future cross-provider regression checks (AI-SPEC §5.4).

## Task Commits

Each TDD phase committed atomically:

1. **Task 1 (RED): Failing tests for streaming providers + Anthropic adapter** — `ef0d16f` (test)
   - 8 failing tests in openai.test.ts + ollama.test.ts expecting `completeStream` method.
   - 2 test files (registry.test.ts + anthropic.test.ts) fail to load because `anthropic.ts` does not exist.
   - 13 pre-existing provider tests still pass (regression-free RED).
2. **Task 2 (GREEN): Streaming adapters + Anthropic provider** — `40f3015` (feat)
   - All 40 provider tests pass + 43 capability tests pass + tsc clean.
3. **Task 3 (REFACTOR): Shared streaming helpers + parity baseline** — `93282a3` (refactor)
   - Extracted `readSsePayloads`, `readNdjsonLines`, `anySignal`, `validateStreamFrame` to `streaming-helpers.ts`.
   - Added 3 parity test fixtures exercising all three adapters.
   - 43/43 provider tests + 43/43 capability tests pass.

**Plan metadata commit (pending):** will follow SUMMARY.md via `node gsd-tools.cjs commit ...`.

## Files Created/Modified

### Created
- `packages/llm/src/providers/anthropic.ts` — AnthropicAdapter class (complete + completeStream + listModels + connect/disconnect/healthCheck). Uses default import `import Anthropic from '@anthropic-ai/sdk'`.
- `packages/llm/src/providers/streaming-helpers.ts` — Shared SSE/NDJSON readers, anySignal polyfill, StreamFrame runtime validator.
- `packages/llm/tests/providers/anthropic.test.ts` — 10 tests covering connect, healthCheck (connected/disconnected), listModels, complete (systemPrompt→system top-level), completeStream plain text, tool_use ordering invariant (D-11 at adapter level), tool_result conversion, AbortSignal.
- `packages/llm/tests/providers/parity.test.ts` — 3 Dimension-6 parity fixtures.
- `packages/llm/tests/providers/parity-baseline.json` — Canonical StreamFrame[] shapes for parity CI.

### Modified
- `packages/llm/package.json` — Add `@anthropic-ai/sdk: 0.90.0` (exact pin, no caret) in dependencies.
- `packages/llm/src/providers/types.ts` — Add `ChatMessage`, `ToolDef`, `ToolCall`, `StreamFrame` type exports + optional `completeStream?` method on `LLMProviderAdapter`.
- `packages/llm/src/providers/openai.ts` — Add `async *completeStream(...)` using shared `readSsePayloads()` helper. Delegate abort-signal merging to `anySignal()`.
- `packages/llm/src/providers/ollama.ts` — Add `async *completeStream(...)` using shared `readNdjsonLines()` helper. Delegate abort-signal merging to `anySignal()`. Non-streaming `complete()` untouched (still has `stream:false` — required per plan to avoid breaking the 4 capabilities).
- `packages/llm/src/providers/registry.ts` — Add `AnthropicAdapter` import + `anthropic:` factory entry.
- `packages/llm/tests/providers/openai.test.ts` — Add 5 streaming tests (Tests 1–4 + stream:true body assertion).
- `packages/llm/tests/providers/ollama.test.ts` — Add 3 streaming tests (Tests 5, 6, 8). Test 7 (regression-free complete()) is the existing complete() test, preserved as-is.
- `packages/llm/tests/providers/registry.test.ts` — Add anthropic factory test + extend `getSupportedTypes()` assertions to include all 3 providers.

## Decisions Made

1. **Exact version pin for @anthropic-ai/sdk (`0.90.0`, no caret).** Threat_model T-32-01-06 requires the supply-chain posture to be reviewable in lockfile diffs. Caret ranges allow minor-version drift that could introduce new postinstall scripts or API changes without a plan bump.
2. **completeStream is OPTIONAL on the interface.** The four existing non-streaming capabilities never call it; the `agent-conversation` capability (Plan 02) will assert presence and throw a clear "provider does not support streaming" error otherwise. This is an additive interface change — zero risk of regression.
3. **Anthropic adapter uses SDK's `stream.finalMessage()` helper.** AI-SPEC §3 Pitfall 2 is explicit: rolling your own `input_json_delta.partial_json` accumulator is a data-corruption bug factory. The SDK's helper is the one-correct way to assemble `tool_use.input` from Anthropic's streaming events.
4. **Ollama tool-call ids minted client-side as `toolu_ollama_<uuid>`.** Ollama's `/api/chat` response for tool calls does NOT include an id field. Consumers need one to key tool_result messages; the adapter mints deterministically-unique ids with a provider-identifying prefix so audit logs stay readable.
5. **REFACTOR produced BOTH shared readers AND `validateStreamFrame` guard.** The plan allowed either/or; both were genuinely present — `anySignal` was exactly duplicated, the reader loops were structurally identical modulo separator — so extracting both improved the surface. `validateStreamFrame` is a zod-free runtime guard for future defense-in-depth use at emit boundaries.
6. **Parity baseline committed as JSON (not inline test assertions).** The parity check is the seed of AI-SPEC §5.4's CI parity gate. Keeping the canonical shapes in a JSON file means future provider bumps can be tested against an immutable baseline via a single diff.

## Deviations from Plan

**Total deviations:** 2 auto-fixed (1 test-infrastructure mock correction, 1 Rule 2 defense-in-depth helper addition)

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Anthropic test mock initially used `vi.fn().mockImplementation(...)` which produced an arrow function — not a valid constructor for `new Anthropic(...)`**
- **Found during:** Task 2 (GREEN) — the first test run after creating `anthropic.ts` failed with `TypeError: ... is not a constructor` because the Task 1 mock used `vi.fn().mockImplementation((cfg) => { ... return {messages:...} })` which cannot be called with `new`.
- **Fix:** Replaced the mock with a class-based declaration — `class MockAnthropic { messages = {...}; constructor(cfg) { anthropicCtorSpy(cfg); } }` — exported as `default`. `new Anthropic(cfg)` now resolves correctly.
- **Files modified:** `packages/llm/tests/providers/anthropic.test.ts`
- **Verification:** All 10 Anthropic tests pass after the change.
- **Committed in:** `40f3015` (GREEN commit — the fix was applied during GREEN since it was a test-infrastructure bug, not production code).

**2. [Rule 2 - Missing Critical] Added `validateStreamFrame()` runtime guard to `streaming-helpers.ts`**
- **Found during:** Task 3 (REFACTOR) — plan's acceptance criteria allowed EITHER shared readers OR `validateStreamFrame` guard. Extracting both is strictly additive and closes the AI-SPEC §4b.1 "zod-at-boundaries" defense-in-depth gap for consumers that want runtime frame validation (e.g. future fuzz-test harness).
- **Issue:** Without a shared guard, each consumer of `completeStream()` either re-validates ad-hoc or trusts the adapter unconditionally.
- **Fix:** Added `validateStreamFrame(frame: unknown): StreamFrame` to `streaming-helpers.ts` — exhaustive discriminated-union check with clear error messages per variant. Not currently called anywhere in-module; it's opt-in for consumers.
- **Files modified:** `packages/llm/src/providers/streaming-helpers.ts`
- **Verification:** tsc --noEmit clean; no test changes needed because no adapter calls the guard yet.
- **Committed in:** `93282a3` (REFACTOR commit).

---

**Impact on plan:** Both deviations are strictly additive/corrective. No scope creep. No architectural change. Plan execution remained within TDD flow (RED → GREEN → REFACTOR) and all 3 commits landed cleanly.

## Issues Encountered

- **Anthropic SDK installed with caret range initially.** `npm install @anthropic-ai/sdk@0.90.0 --save` inserted `"^0.90.0"` in `package.json` (npm's default behavior). Manually edited to `"0.90.0"` to honor the plan's exact-pin requirement; lockfile (`package-lock.json`) already resolved to `0.90.0` so no re-install needed. Verified via `grep '@anthropic-ai/sdk' package.json` — single line showing `"0.90.0"` with no caret.
- **Phase Node 22+ polyfill for `AbortSignal.any`.** The shared `anySignal()` helper guards against missing native support by constructing a manual controller when `(AbortSignal as any).any` is undefined. Node 22.3+ has native support; Node 20 and earlier-22 builds fall through to the polyfill.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>` already documents. All 6 STRIDE entries (T-32-01-01 through T-32-01-06) remain accurate for the implementation shipped:

- **T-32-01-01** (Tampering, provider stream): `JSON.parse` inside try/catch in all three adapters; malformed frames yield `error` StreamFrame with `retryable:true`.
- **T-32-01-02** (Info disclosure, API keys): No `console.log` anywhere in the new adapter code; error messages use `err.message` only, never serialise client config.
- **T-32-01-03** (DoS, unbounded max_tokens): All three adapters default `maxTokens` to 2048 when caller omits.
- **T-32-01-04** (DoS, hanging stream): `options.timeout` honoured via `AbortSignal.timeout(timeoutMs)` merged into the fetch/SDK signal via `anySignal()`.
- **T-32-01-05** (Tampering, tool-call prototype pollution): Native `JSON.parse` does NOT revive `__proto__`; the capability engine (Plan 02) will re-validate via zod `inputSchema` for defense-in-depth.
- **T-32-01-06** (Elevation, Anthropic SDK supply-chain): Pinned exact `0.90.0`, no caret; lockfile diff reviewable in PR.

## Next Phase Readiness

**Ready for Plan 32-02** (agent-conversation capability):
- `LLMProviderAdapter.completeStream()` is a stable contract.
- `StreamFrame` discriminated union is exported from `packages/llm/src/providers/types.js` for Plan 02 to re-export or alias.
- Provider registry exposes all three providers — capability can probe `adapter.completeStream` to detect streaming support and fall through fallback chain otherwise.
- Parity baseline in place for future regression checks when new providers or SDK bumps land.

**No blockers for Wave 2** (Plan 02). The streaming contract is the Wave-1 prerequisite for every downstream Phase 32 plan (02 capability → 03 MCP adapter glue → 04 AgentService → 05 routes → 06 UI → 07 speech → 08 confirmation flow).

**Downstream capability assignment note:** Per plan's `<scope_reminders>` — the default capability assignment `claude-haiku-4-5-20251001` → `agent-conversation` at priority 1 is DEFERRED to Plan 02 Task 4 (the capability doesn't exist in `CAPABILITY_NAMES` yet; Plan 02 extends `packages/llm/src/types.ts` to add it, so the seed row belongs there).

---
*Phase: 32-agent-service-chat-ui*
*Completed: 2026-04-20*

## Self-Check: PASSED

- `packages/llm/src/providers/anthropic.ts` — FOUND
- `packages/llm/src/providers/streaming-helpers.ts` — FOUND
- `packages/llm/tests/providers/anthropic.test.ts` — FOUND
- `packages/llm/tests/providers/parity.test.ts` — FOUND
- `packages/llm/tests/providers/parity-baseline.json` — FOUND
- Commit `ef0d16f` (RED) — FOUND in `git log`
- Commit `40f3015` (GREEN) — FOUND in `git log`
- Commit `93282a3` (REFACTOR) — FOUND in `git log`
- `npx vitest run tests/providers/` — 43/43 pass
- `npx vitest run tests/capabilities/` — 43/43 pass (regression-free)
- `npx tsc --noEmit` — exit 0
- `@anthropic-ai/sdk` pin in `package.json` — `"0.90.0"` (exact)
- `completeStream` appears in types.ts + openai.ts + ollama.ts + anthropic.ts — 4 implementation sites

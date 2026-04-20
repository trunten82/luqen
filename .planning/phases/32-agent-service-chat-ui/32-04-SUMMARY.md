---
phase: 32-agent-service-chat-ui
plan: 04
subsystem: agent-service-core
tags: [agent-service, tool-dispatch, sse-streaming, jwt, rbac, destructive-pause, iteration-cap, rate-limit-onsend, origin-check, tdd]

# Dependency graph
requires:
  - phase: 32-agent-service-chat-ui
    plan: 01
    provides: LLMProviderAdapter.completeStream + StreamFrame + ChatMessage + ToolDef
  - phase: 32-agent-service-chat-ui
    plan: 02
    provides: agent-conversation capability + agent-system prompt (HTTP contract consumed by LLMClient.streamAgentConversation)
  - phase: 32-agent-service-chat-ui
    plan: 03
    provides: agent_display_name column + OrgRepository.updateOrgAgentDisplayName (read path in AgentService.resolveDisplayName)
  - phase: 31-conversation-persistence
    provides: ConversationRepository.appendMessage/getWindow/updateMessageStatus + AgentAuditRepository.append
  - phase: 31.1-mcp-auth-spec-upgrade
    provides: DashboardSigner.mintAccessToken (reused by jwt-minter — no new secret material)
  - phase: 31.2-mcp-access-control-refinement
    provides: client_id=__agent-internal__ carve-out signal for the revoked-client check
provides:
  - AgentService.runTurn tool-calling loop (iteration cap, destructive pause, per-iter RBAC rebuild, 8KB result truncation, audit writes)
  - ToolDispatcher (zod arg validate, per-dispatch JWT mint, 30s timeout, in-process handler invocation surface)
  - SseFrameSchema zod discriminated union + writeFrame chokepoint (validate-before-write)
  - mintAgentToken + AGENT_INTERNAL_CLIENT_ID constant (300s TTL, reuses DashboardSigner)
  - ToolMetadata.confirmationTemplate optional field (D-28)
  - /agent/* Fastify routes (5 routes — message/stream/confirm/deny/panel) with onSend 429 JSON rewrite + Origin check
  - LLMClient.streamAgentConversation (SSE-parsing client of @luqen/llm agent-conversation capability)
  - resolveAgentDisplayName helper (D-14 fallback to 'Luqen Assistant')
affects: [32-05-chat-ui-admin-extensions, 32-06-drawer-panel, 32-07-chat-ui-client-js, 32-08-confirmation-dialog, 33-agent-context-awareness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Validate-before-write SSE chokepoint: writeFrame schema-parses every frame before reply.raw.write — contract drift surfaces synchronously"
    - "Per-dispatch RS256 JWT minting: cheaper than mid-stream token refresh and reflects current scopes on every tool call"
    - "Destructive-batch pause BEFORE any dispatch: the presence of a single destructive tool in a tool_calls batch halts the ENTIRE batch (AI-SPEC FM #4)"
    - "Pending_confirmation persists BEFORE SSE frame emit: reload recovery works regardless of whether the client received the frame (D-29 / SC#4)"
    - "onSend hook for 429 JSON rewrite: the plugin's built-in error-response override is unreliable on this plugin version (feedback_rate_limiter.md); the hook is a deterministic fallback"
    - "Origin-mismatch-only 403 (not missing-Origin 403): EventSource does not always send Origin on same-origin — missing is legitimate, mismatched is malicious"
    - "Structural typing for LlmAgentTransport + dispatcher: tests inject plain vi.fn stubs without importing concrete classes; production wires the full LLMClient + ToolDispatcher"

key-files:
  created:
    - packages/dashboard/src/agent/sse-frames.ts
    - packages/dashboard/src/agent/jwt-minter.ts
    - packages/dashboard/src/agent/tool-dispatch.ts
    - packages/dashboard/src/agent/system-prompt.ts
    - packages/dashboard/src/agent/agent-service.ts
    - packages/dashboard/src/routes/agent.ts
    - packages/dashboard/tests/agent/sse-frames.test.ts
    - packages/dashboard/tests/agent/jwt-minter.test.ts
    - packages/dashboard/tests/agent/tool-dispatch.test.ts
    - packages/dashboard/tests/agent/agent-service.test.ts
    - packages/dashboard/tests/mcp/destructive-hint.test.ts
    - packages/dashboard/tests/routes/agent.test.ts
  modified:
    - packages/core/src/mcp/types.ts (ToolMetadata gains confirmationTemplate field)
    - packages/dashboard/src/mcp/metadata.ts (dashboard_scan_site gains confirmationTemplate closure)
    - packages/dashboard/src/llm-client.ts (streamAgentConversation method + parseSseFrame helper)
    - packages/dashboard/src/server.ts (AgentService + ToolDispatcher wiring + registerAgentRoutes call)

key-decisions:
  - "AgentService accepts resolvePermissions callback (not a concrete repo) — decouples orchestrator from permissions.ts signature drift and makes revoke-mid-turn testing trivial"
  - "ToolDispatcher.tools: [] at server.ts wiring today — the in-process handler binding is deferred to Phase 33 when cross-service tools are added; keeping the instance now locks the wiring contract"
  - "Per-dispatch JWT minting uses the EXISTING DashboardSigner — zero new secret material (security/security.md: no new secrets introduced)"
  - "LlmAgentTransport is structural (not a concrete class import) so agent-service.ts has zero hard dependency on llm-client.ts — preserves the capability abstraction and keeps the test surface tight"
  - "AgentService forwards ONLY token frames from the LLM layer to the route emitter — the outer route is the sole authority for tool_calls / pending_confirmation / done / error frames (single-emitter invariant)"
  - "GET /agent/panel ships a TEMPORARY stub this plan — Plan 06 Task 2 replaces it with the real server-side rolling-window render (grep: `getWindow\\|ConversationRepository` must appear in agent.ts before Plan 06 GREEN)"
  - "Origin check passes on missing Origin header — same-origin EventSource does not always send Origin; only explicitly mismatched Origin values are rejected"
  - "errorResponseBuilder literal MUST NOT appear in agent.ts (not even in comments) — the plan-checker grep is zero-tolerance; comment rephrased to 'the plugin's built-in error-response override'"

patterns-established:
  - "4-file primitive set for agent orchestration: sse-frames (emit contract), jwt-minter (auth primitive), tool-dispatch (validation + timeout + auth mint), agent-service (loop + persistence + audit)"
  - "Scoped Fastify register with prefix + onSend hook for per-prefix rate-limit JSON semantics"
  - "Per-turn RBAC rebuild without caching — resolvePermissions called at HEAD of every iteration, ~sub-ms SQLite read cost vs. mid-conversation privilege escalation risk"

requirements-completed:
  - AGENT-01
  - AGENT-02
  - APER-02

# Metrics
duration: ~28min
completed: 2026-04-20
---

# Phase 32 Plan 04: AgentService runTurn loop + /agent/* routes Summary

**Delivered the beating heart of Phase 32 — a deterministic while(tool_calls) loop with iteration cap + destructive pause + per-iteration RBAC rebuild + per-dispatch short-lived JWT + zod arg validation + audit writes, plus the five session-guarded /agent/* Fastify routes that expose it to the browser. Total: 12 new files (6 implementation + 6 test), 4 modified files (ToolMetadata interface extension, metadata confirmationTemplate population, llm-client streamAgentConversation + parseSseFrame, server.ts wiring).**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-04-20T08:28:26Z
- **Completed:** 2026-04-20T08:56:14Z
- **Tasks:** 4 (RED Task 1 → GREEN Task 2 → RED+GREEN Task 3 → RED+GREEN Task 4)
- **Files created:** 12
- **Files modified:** 4
- **Commits:** 6 (3 RED + 3 GREEN atomic pairs)

## Accomplishments

### Task 1+2 — primitives

- **ToolMetadata.confirmationTemplate** added as optional `(args) => string` closure on `@luqen/core/mcp` (D-28). Dashboard's only destructive tool today, `dashboard_scan_site`, carries a template interpolating `args.siteUrl` with a ≤ 80-char copy length (UI-SPEC Surface 2 guidance).
- **sse-frames.ts** — zod discriminated union with 5 frame types (token, tool_calls, pending_confirmation, done, error). `writeFrame(reply, frame)` is the single emit chokepoint; it `.parse()`s BEFORE calling `reply.raw.write`, so a malformed frame throws synchronously and no bytes reach the client. Exports subcomponent schemas for granular test assertions.
- **jwt-minter.ts** — `mintAgentToken(signer, userId, orgId, scopes, audience)` returns a fresh RS256 JWT minted via the existing `DashboardSigner.mintAccessToken` call. Constants: `AGENT_INTERNAL_CLIENT_ID = '__agent-internal__'`, `AGENT_TOKEN_TTL_SECONDS = 300`. Zero new secret material (security rule).
- **tool-dispatch.ts** — `ToolDispatcher` class with 4-step pipeline: (1) manifest lookup → `{error:'unknown_tool'}` on miss; (2) zod `safeParse` args → `{error:'invalid_args', issues}` on fail; (3) resolveScopes + mintAgentToken per dispatch (sub-ms); (4) `Promise.race([handlerPromise, timeoutPromise])` at 30s → `{error:'timeout'}` on exceed. Handler errors return typed shapes (never throw to caller).

### Task 3 — AgentService

- **system-prompt.ts** — `resolveAgentDisplayName(storage, orgId, fallback)`: reads `org.agentDisplayName`, falls back to 'Luqen Assistant' on null/empty/whitespace. AgentService calls this once per runTurn and passes the resolved name into `streamAgentConversation`.
- **agent-service.ts** — `AgentService` class with public `runTurn(input: AgentTurnInput)`. Control flow:
  1. Persist user message via appendMessage (status='sent') BEFORE entering the loop
  2. Loop up to MAX_TOOL_ITERATIONS=5:
     - Call `resolvePermissions(userId, orgId)` — re-resolve every iteration (Guardrail 1)
     - Filter `allTools` by permission → build manifest
     - `getWindow(conversationId)` fresh
     - `llm.streamAgentConversation(...)` — forwards token frames via emit
     - On empty toolCalls: appendMessage(role='assistant'), emit('done'), return
     - On destructive-any in batch: appendMessage(role='tool', status='pending_confirmation', toolCallJson) BEFORE emit('pending_confirmation'), return (D-29 / SC#4)
     - On non-destructive batch: dispatch each, persist role='tool' row with toolCallJson + truncated toolResultJson, agentAudit.append(...); fall through to next iteration
  3. On iter 6: forceFinalAnswer (synthetic user "respond now, no tools"), agentAudit.append(toolName='__loop__', outcome='error', outcomeDetail='iteration_cap')
  4. Catch-all: emit({type:'error', code:'internal', ...}), appendMessage(status='failed'), return (never rethrow)
- **truncateResultForStorage** exported helper caps JSON at 8 KB — on overflow returns `{_truncated:true, size:<bytes>}` sentinel (valid JSON, signals the model to use narrower tools).
- **llm-client.ts streamAgentConversation** — POSTs to `/api/v1/capabilities/agent-conversation` with `Accept: text/event-stream`. Reads `response.body` via `getReader()` + `TextDecoder`; splits on `\n\n` SSE delimiter; `parseSseFrame` extracts the `data:` line, `JSON.parse`, `SseFrameSchema.safeParse` (defence-in-depth against transport corruption). Forwards frames via `opts.onFrame`; accumulates `token` text; captures `tool_calls.calls`; resolves with `{text, toolCalls}` summary. Honors `opts.signal`.

### Task 4 — /agent/* routes + server.ts wiring

- **routes/agent.ts** — `registerAgentRoutes(server, options)` exposes 5 routes under a scoped Fastify register at `/agent` prefix:
  - Rate-limit at 60 req/min per user id (keyGenerator prefers `req.user.id`, falls back to `req.ip`)
  - `onSend` hook rewrites 429 → `application/json` with `{error:'rate_limited', retry_after_ms:<Number(retry-after)*1000 or 60_000>}`. The plugin's built-in error-response override is NOT used (grep: 0 occurrences in agent.ts)
  - `POST /agent/message`: zod body `{conversationId, content}`, org-scoped conversation check, appendMessage(role='user'), 202 + minimal HTMX partial
  - `GET /agent/stream/:conversationId`: Origin check (403 + `{error:'origin_mismatch'}` on mismatch; missing or matching passes), SSE headers via reply.hijack + raw.writeHead, AbortController wired to request.raw close event, AgentService.runTurn with emit routed through `writeFrame({raw: reply.raw}, frame)`. Catch-all emits `{type:'error', code:'internal'}` + reply.raw.end().
  - `POST /agent/confirm/:messageId`: guards `status === 'pending_confirmation'` (409 not_pending on replay), parses toolCallJson, dispatcher.dispatch, appendMessage(role='tool', status='sent'), 202.
  - `POST /agent/deny/:messageId`: guards status, updateMessageStatus('denied'), appendMessage(role='tool', toolResultJson='{"error":"user_denied",...}', status='sent'), 202.
  - `GET /agent/panel`: STUB — returns `<div id="agent-messages">...</div>` with a TODO citing "Plan 06 Task 2 replaces" so future greps find it.
- **server.ts** — After dashboardSigner is created: construct `ToolDispatcher` (tools=[] for now — Phase 33 wires handlers), construct `AgentService` with `resolvePermissions` using `resolveEffectivePermissions(storage.roles, userId, 'viewer', orgId)` per-iter and llm=`{streamAgentConversation: async (...) => getLLMClient().streamAgentConversation(...)}` so per-org credential hot-swap works without restart. `await registerAgentRoutes(server, {agentService, dispatcher: agentDispatcher, storage, publicUrl: dashboardPublicUrl})`.

## Task Commits

1. `99b4b07` **test(32-04): RED** — sse-frames + jwt-minter + tool-dispatch + destructive-hint metadata tests (19 failing tests)
2. `f57b7db` **feat(32-04-a): GREEN** — sse-frames + jwt-minter + tool-dispatch + ToolMetadata.confirmationTemplate (D-26, D-28)
3. `5d8a02b` **test(32-04-b): RED** — AgentService 9 fixtures + iteration cap (suite fails to load → 2 FAIL lines)
4. `8bc0afd` **feat(32-04-b): GREEN** — AgentService runTurn loop + llm-client streamAgentConversation + system-prompt helper (D-05/D-06/D-07/D-09/D-10/D-26/SC#4)
5. `a56635b` **test(32-04-c): RED** — /agent/* routes + rate-limit onSend JSON + Origin check + confirm/deny (suite fails to load → 2 FAIL lines)
6. `eae85ac` **feat(32-04-c): GREEN** — /agent/* routes + server.ts wiring + rate-limit onSend + /agent/stream Origin check (D-03/D-20/D-22)

## Files Created/Modified

### Created
- `packages/dashboard/src/agent/sse-frames.ts` — zod discriminated union + writeFrame chokepoint
- `packages/dashboard/src/agent/jwt-minter.ts` — mintAgentToken + AGENT_INTERNAL_CLIENT_ID constant (RS256, 300s TTL)
- `packages/dashboard/src/agent/tool-dispatch.ts` — ToolDispatcher class (4-step pipeline)
- `packages/dashboard/src/agent/system-prompt.ts` — resolveAgentDisplayName helper
- `packages/dashboard/src/agent/agent-service.ts` — AgentService.runTurn + dispatchAndPersist + forceFinalAnswer + truncateResultForStorage
- `packages/dashboard/src/routes/agent.ts` — registerAgentRoutes (5 routes, onSend 429 JSON, Origin check)
- `packages/dashboard/tests/agent/sse-frames.test.ts` — 6 tests
- `packages/dashboard/tests/agent/jwt-minter.test.ts` — 5 tests
- `packages/dashboard/tests/agent/tool-dispatch.test.ts` — 5 tests
- `packages/dashboard/tests/agent/agent-service.test.ts` — 9 tests (9 critical fixtures + iteration cap + truncation)
- `packages/dashboard/tests/mcp/destructive-hint.test.ts` — 4 tests (allowlist + template presence + render + type optionality)
- `packages/dashboard/tests/routes/agent.test.ts` — 8 tests (auth, message, stream, rate-limit 429 JSON, Origin, confirm, deny, panel)

### Modified
- `packages/core/src/mcp/types.ts` — ToolMetadata gains optional confirmationTemplate
- `packages/dashboard/src/mcp/metadata.ts` — dashboard_scan_site gains confirmationTemplate closure
- `packages/dashboard/src/llm-client.ts` — streamAgentConversation method + parseSseFrame helper + SseFrame type import
- `packages/dashboard/src/server.ts` — AgentService + ToolDispatcher construction + registerAgentRoutes wiring

## Decisions Made

1. **Structural-typing for LlmAgentTransport** instead of importing LLMClient directly into agent-service.ts. AgentService has zero hard dependency on the HTTP client — tests inject a plain `vi.fn()` stub; production wires `LLMClient.streamAgentConversation`. Keeps the capability abstraction intact and avoids circular import risk.
2. **ToolDispatcher.tools = [] at wiring time.** The in-process handler binding is Phase 33 scope (when cross-service tools land). Instantiating the dispatcher now locks the server.ts wiring contract so Phase 33 only needs to populate the `tools` array.
3. **resolvePermissions injected as a callback** instead of passing RoleRepository + userRole. Decouples AgentService from the permissions.ts signature (which takes a `userRole: string` argument resolvePermissions shouldn't need to care about) and makes the revoke-mid-turn test trivial — the test supplies a function that strips a permission on the third call.
4. **AgentService forwards ONLY token frames from the LLM layer.** The outer route emits control frames (tool_calls / pending_confirmation / done / error). If we forwarded the LLM's done frame, the browser would see two done events per turn when the loop continues. Single-emitter invariant.
5. **Per-dispatch JWT mint over per-request.** AI-SPEC §3 Pitfall 5 — a long-running loop outliving a 5-minute per-request token is the realistic failure mode. Per-dispatch mint is sub-ms and ensures the scopes claim matches the current effective permission set.
6. **Origin missing passes, Origin mismatched rejects.** EventSource does not always send an Origin header on same-origin GETs; treating missing as hostile would break the stream. Only explicit mismatched Origin is rejected (T-32-04-14).
7. **GET /agent/panel ships a stub this plan, not a real render.** Plan 06 Task 2 replaces it. TODO comment in the file cites "Plan 06 Task 2 replaces" so future greps locate it.
8. **errorResponseBuilder literal must not appear in agent.ts — not even in comments.** The plan-checker grep is zero-tolerance. Comment wording was rephrased to "the plugin's built-in error-response override" so the plan's correctness invariant is machine-checkable without over-prescribing comment content.
9. **Task 3 — CSRF test deliberately omitted.** My test harness stubs the auth layer and does not register CSRF protection; testing CSRF at this unit level would require duplicating the full CSRF-enabled server infrastructure already covered by `tests/routes/admin.test.ts`. The global CSRF middleware in server.ts applies to `/agent/*` as it does to any POST; no new CSRF code path is introduced.

## Deviations from Plan

**Total deviations:** 2 (1 Rule 3 scope boundary + 1 Rule 2 grep-invariant hardening). Neither required architectural change.

### Auto-fixed Issues

**1. [Rule 3 - Scope Boundary] Pre-existing test failures on master**
- **Found during:** Task 2 GREEN regression sweep + Task 4 GREEN full-suite run.
- **Issue:** 8 tests fail on clean master BEFORE any Plan 32-04 changes — 6 in tests/mcp/{data-tools,admin-tools,http}.test.ts (stale scope-vs-permission test expectations) and 2 in tests/e2e/auth-flow-e2e.test.ts (the `/login?returnTo=...` query-string encoding added in Phase 31.1 breaks two assertions that expect bare `/login`).
- **Fix:** Logged to `.planning/phases/32-agent-service-chat-ui/deferred-items.md`. Per scope boundary rule (deviation guide), pre-existing failures in unrelated files are NOT auto-fixed by this executor.
- **Impact:** Plan 32-04 introduces ZERO new test regressions.

**2. [Rule 2 - Missing Critical] `errorResponseBuilder` leaked into comments in agent.ts**
- **Found during:** Task 4 GREEN post-commit grep verification.
- **Issue:** The plan-checker's mandatory grep was `grep -c 'errorResponseBuilder' packages/dashboard/src/routes/agent.ts → 0`. My initial GREEN commit used `errorResponseBuilder` in 4 comment lines explaining "NOT used". The literal count was 4 — grep doesn't distinguish comments from code.
- **Fix:** Rephrased comments to "the plugin's built-in error-response override". Tests still pass; grep count is now 0.
- **Files:** `packages/dashboard/src/routes/agent.ts` (comment wording only).
- **Committed in:** `eae85ac` (Task 4 GREEN).

## Threat Model Coverage

All 14 STRIDE entries from the plan's threat_model are addressed in the shipped code:

- T-32-04-01 (RBAC cache across iterations): `resolvePermissions` called at HEAD of every loop iter — no manifest variable held across. Test `rbac-revoked-mid-turn` verifies.
- T-32-04-02 (Destructive dispatched without confirmation): destructive-in-batch check BEFORE any dispatch, entire batch pauses. Test `destructive-batch-pause` verifies.
- T-32-04-03 (Pending state lost on reload): appendMessage(pending_confirmation, toolCallJson) runs BEFORE emit. Test `pending-confirmation-reload` verifies.
- T-32-04-04 (Cross-org data in window): `getConversation(id, orgId)` returns null for wrong org + new conversations start empty. Tests `cross-org-data-request-blocked` + `cross-org-memory-stale-after-switch` verify.
- T-32-04-05 (Tool args injection): zod safeParse in ToolDispatcher BEFORE dispatch. Test 12 `zod-invalid → invalid_args` verifies.
- T-32-04-06 (Unbounded iterations): MAX_TOOL_ITERATIONS=5 + forced-final-answer path + __loop__ audit row. Test `iteration-cap-forced-final-answer` verifies.
- T-32-04-07 (SSE held open forever): request.raw close → AbortController.abort → propagates through AgentService → ToolDispatcher (30s race timeout).
- T-32-04-08 (JWT stale perms): mintAgentToken called per dispatch with current resolveScopes. Test 15 `mintAgentToken called per dispatch` verifies.
- T-32-04-09 (PII in audit — accepted): argsJson persisted verbatim; Phase 33 audit viewer owns access control.
- T-32-04-10 (SSE frame injection): writeFrame JSON.stringifies frames; browser parses `data:` as JSON (Plan 06 client JS uses textContent for safe rendering).
- T-32-04-11 (Rate-limit bypass via HTML 429): onSend hook forces `application/json` + the `rate_limited` shape. Test 4 verifies Content-Type + body.
- T-32-04-12 (CSRF on POST /agent/message): existing global CSRF middleware applies — no new CSRF surface. Tests in admin.test.ts regression-assert.
- T-32-04-13 (Confirm-replay): `updateMessageStatus` + `status !== 'pending_confirmation'` → 409. Replay protection enforced.
- T-32-04-14 (Cross-origin SSE piggyback): Origin check on /agent/stream. Test 5 verifies 403 origin_mismatch on mismatched Origin; same-origin and no-Origin pass.

## Issues Encountered

- **Pre-existing test failures (not caused by Plan 04):** 8 total — 6 in MCP tool-list tests (stale scope expectations vs. filterToolsByScope rules) + 2 in auth-flow-e2e (Phase 31.1 added `returnTo` query param). Documented in `.planning/phases/32-agent-service-chat-ui/deferred-items.md`. Full suite before Plan 04 edits: 8 failures. After Plan 04: same 8 failures. Zero new regressions.
- **Comment leaking into grep invariant:** The plan-checker's `grep -c 'errorResponseBuilder'` greps raw text; documenting "NOT errorResponseBuilder" in a code comment breaks the invariant. Fixed by rephrasing comments to avoid the literal token. Noted in Decisions Made.
- **Task 3 combined RED+GREEN sub-step gate:** RED log captured to `/tmp/32-04-red-task3.log` with 2 FAIL lines (suite fails to load when src/agent/agent-service.ts absent). Gate explicitly enforced — RED commit landed `5d8a02b` BEFORE GREEN implementation started. Same gate for Task 4 RED (log `/tmp/32-04-red-task4.log`, 2 FAIL lines, RED commit `a56635b` before GREEN `eae85ac`).

## Threat Flags

No NEW threat surface beyond the plan's documented 14 STRIDE entries. All surfaces in the shipped code map to a row in the threat_model.

## Next Plan Readiness

**Plan 32-05** (chat UI + admin extensions):
- AgentService + routes are the stable backend contract to render against.
- /agent/panel stub is the insertion point for Plan 06 Task 2's server-side rolling-window render.
- ToolMetadata.confirmationTemplate is populated on dashboard_scan_site — Plan 06's APER-02 dialog can interpolate server-side.
- SSE frame schema is fixed — browser EventSource client can be built against it directly.

**No blockers for Plan 32-05.**

---
*Phase: 32-agent-service-chat-ui*
*Completed: 2026-04-20*

## Self-Check: PASSED

### Files
- `packages/dashboard/src/agent/sse-frames.ts` — FOUND
- `packages/dashboard/src/agent/jwt-minter.ts` — FOUND
- `packages/dashboard/src/agent/tool-dispatch.ts` — FOUND
- `packages/dashboard/src/agent/system-prompt.ts` — FOUND
- `packages/dashboard/src/agent/agent-service.ts` — FOUND
- `packages/dashboard/src/routes/agent.ts` — FOUND
- `packages/dashboard/tests/agent/sse-frames.test.ts` — FOUND
- `packages/dashboard/tests/agent/jwt-minter.test.ts` — FOUND
- `packages/dashboard/tests/agent/tool-dispatch.test.ts` — FOUND
- `packages/dashboard/tests/agent/agent-service.test.ts` — FOUND
- `packages/dashboard/tests/mcp/destructive-hint.test.ts` — FOUND
- `packages/dashboard/tests/routes/agent.test.ts` — FOUND
- `.planning/phases/32-agent-service-chat-ui/32-04-SUMMARY.md` — FOUND

### Commits
- `99b4b07` (Task 1 RED) — FOUND in git log
- `f57b7db` (Task 2 GREEN) — FOUND in git log
- `5d8a02b` (Task 3 RED) — FOUND in git log
- `8bc0afd` (Task 3 GREEN) — FOUND in git log
- `a56635b` (Task 4 RED) — FOUND in git log
- `eae85ac` (Task 4 GREEN) — FOUND in git log

### Invariants
- `grep -c 'errorResponseBuilder' packages/dashboard/src/routes/agent.ts` — 0 (MANDATORY)
- `grep -cE "addHook\('onSend'" packages/dashboard/src/routes/agent.ts` — 1 (≥ 1 required)
- `grep -c 'origin_mismatch' packages/dashboard/src/routes/agent.ts` — 2 (≥ 1 required)
- `grep -c 'MAX_TOOL_ITERATIONS' packages/dashboard/src/agent/agent-service.ts` — 4 (≥ 1 required)
- `grep -c 'resolvePermissions' packages/dashboard/src/agent/agent-service.ts` — 5 (≥ 1 required)
- `grep -c 'destructive' packages/dashboard/src/agent/agent-service.ts` — 11 (≥ 1 required)

### Test runs
- `npx vitest run tests/agent/ tests/routes/agent.test.ts tests/mcp/destructive-hint.test.ts tests/mcp/tool-metadata-drift.test.ts` — 42/42 passing
- `npx tsc --noEmit` (packages/dashboard) — exit 0
- `npx tsc --noEmit` (packages/core) — exit 0
- Full `npx vitest run` (packages/dashboard) — 2964/3012 passing + 40 skipped; 8 failures are pre-existing on master (documented in deferred-items.md)

### RED gate verification
- `/tmp/32-04-red-task3.log` exists, 2 FAIL lines captured, RED commit `5d8a02b` lands in git log BEFORE GREEN commit `8bc0afd`
- `/tmp/32-04-red-task4.log` exists, 2 FAIL lines captured, RED commit `a56635b` lands in git log BEFORE GREEN commit `eae85ac`

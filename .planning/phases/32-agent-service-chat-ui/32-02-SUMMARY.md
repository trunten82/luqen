---
phase: 32-agent-service-chat-ui
plan: 02
subsystem: llm-capabilities
tags: [agent-conversation, agent-system, prompt-management, capability-engine, tdd, streaming, rbac-prompt-locks, bootstrap-seed]

# Dependency graph
requires:
  - phase: 32-agent-service-chat-ui
    plan: 01
    provides: LLMProviderAdapter.completeStream() + StreamFrame + ChatMessage + ToolDef types
provides:
  - agent-conversation capability (AsyncIterable of StreamFrame) with provider fallback
  - agent-system prompt default template with three LOCKED fences (rbac / confirmation / honesty)
  - PUT /api/v1/prompts/agent-system per-org override refusal (D-14)
  - interpolateTemplate helper (single-brace, Handlebars-safe double-brace pass-through)
  - bootstrapAgentConversation startup seed (AI-SPEC §4c.1 row #5)
  - T-32-02-03 defence-in-depth sanitisation of agentDisplayName
affects: [32-03-mcp-adapter-glue, 32-04-agent-service, 32-05-chat-ui-and-admin-extensions, future-agent-system-prompt-edits]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Streaming capability pattern — AsyncGenerator that mirrors the non-streaming extract-requirements provider-priority loop but forwards frames verbatim after first iterator step"
    - "D-23 committed-provider semantics — once first frame is yielded, commit to that provider; mid-stream errors forward to caller and terminate without retry"
    - "Prompt id surface wider than CapabilityName — PromptId union keeps route types honest without polluting CAPABILITY_NAMES"
    - "Interpolation helper with negative-lookbehind/lookahead — single-brace tokens match but double-brace tokens survive for Handlebars-style templates"
    - "Startup bootstrap seed with no-op-on-existing — admin intent preserved; four-tier model preference chain"

key-files:
  created:
    - packages/llm/src/prompts/agent-system.ts
    - packages/llm/src/prompts/helpers.ts
    - packages/llm/src/capabilities/agent-conversation.ts
    - packages/llm/tests/capabilities/agent-conversation.test.ts
    - packages/llm/tests/api/prompts-agent.test.ts
    - packages/llm/tests/api/bootstrap-agent-conversation.test.ts
    - packages/llm/tests/prompts/helpers.test.ts
  modified:
    - packages/llm/src/types.ts (CapabilityName union + CAPABILITY_NAMES append 'agent-conversation')
    - packages/llm/src/api/routes/prompts.ts (PromptId + agent-system default + PUT orgId guard)
    - packages/llm/src/api/server.ts (export bootstrapAgentConversation + call post-db.initialize)
    - packages/llm/src/cli.ts (help text lists agent-conversation)

key-decisions:
  - "Introduce PromptId as a union of CapabilityName + 'agent-system' in prompts.ts rather than extending CapabilityName — keeps capability surfaces (assignments, engine) separate from prompt-id surfaces (route handlers, prompt UI)"
  - "interpolateTemplate uses negative-lookbehind/lookahead so Handlebars-style double-brace tokens survive untouched — compatible with existing generate-fix prompts"
  - "D-23 boundary: the stream-open failure gate is the first iterator step; after that resolves, the capability is committed to that provider — errors forward to caller and terminate, NO fallback retry"
  - "Bootstrap four-tier preference (Haiku → gpt-4o-mini → supportsTools-true → first model) keeps on-prem Ollama installs bootstrapping even when no paid API keys are configured — plan noted supportsTools flag is future-work on the Model type, so step 3 naturally collapses to step 4 today"
  - "Dashboard admin local CAPABILITY_NAMES arrays (dashboard/src/routes/admin/llm.ts:90, :646) NOT extended — agent-conversation has no own prompt (its prompt is agent-system); adding it would render an empty-template row in the prompt-browser. The agent-system prompt admin UI lands in Plan 32-05 per AI-SPEC §4c.2"
  - "T-32-02-03 defence-in-depth sanitisation applied inline at interpolation time (strip to 'Luqen Assistant' when less-than or greater-than character in displayName) — Plan 08 write-time validator is the primary defense but this capability is the last boundary before the name enters the LLM system message"

patterns-established:
  - "Streaming capability generator pattern: async generator that resolves fallback candidates upfront, iterates providers, commits on first iterator step, forwards frames verbatim thereafter"
  - "Bootstrap seed pattern: read listCapabilityAssignments once, return early on existing, pick preferred model by modelId prefix chain, assign at priority 1 with orgId omitted (system scope)"
  - "Prompt route pattern for ids-wider-than-capabilities: define PromptId union + isValidPromptId guard + re-use same GET/PUT/DELETE handlers with id-specific defense-in-depth guards (agent-system orgId refusal) added AFTER the validity check"

requirements-completed: []
requirements-reinforced: [AGENT-02]

# Metrics
duration: ~12min
completed: 2026-04-20
---

# Phase 32 Plan 02: agent-conversation capability + agent-system prompt + bootstrap seed Summary

**Added the `agent-conversation` LLM capability (streaming AsyncIterable of StreamFrame) that consumes Plan 01's provider contract, created the `agent-system` prompt template with three verbatim AI-SPEC §4b.3 LOCKED fences, blocked per-org PUT writes to agent-system (D-14 defence-in-depth), and wired a startup seed so fresh installs assign `claude-haiku-4-5-20251001` (or OpenAI/Ollama fallback) to `agent-conversation` at priority 1 without admin UI interaction (AI-SPEC §4c.1 row #5).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-20T07:50:01Z
- **Completed:** 2026-04-20T08:02:51Z
- **Tasks:** 4 (RED → GREEN → REFACTOR → Task 4 RED/GREEN → T-32-02-03 mitigation)
- **Files created:** 7
- **Files modified:** 4

## Accomplishments

- **CapabilityName union + CAPABILITY_NAMES array** extended with `'agent-conversation'` (append-only; 43 existing capability tests continue to pass with zero changes — typescript discriminated-union exhaustiveness picked up on the one non-exhaustive switch in `prompts.ts` which was widened via the new `PromptId` type).
- **`buildAgentSystemPrompt()`** returns a default template with:
  - Byte-verbatim AI-SPEC §4b.3 LOCKED fences for rbac / confirmation / honesty
  - `{agentDisplayName}` placeholder for per-org display-name injection
  - A closing paragraph on WCAG citation accuracy and honest automated-testing scope
  - Runtime check confirms exactly 6 fence markers (3 open + 3 close) in the emitted string
- **`executeAgentConversation(db, adapterFactory, input)`** exports an AsyncIterable of StreamFrame generator:
  - Reads the capability-priority chain via `db.getModelsForCapability('agent-conversation', orgId)` (method names confirmed via grep of the existing extract-requirements capability per plan's Task 1 read_first)
  - Reads per-org `agent-system` prompt override if present; otherwise uses the default template (read path honors overrides; write path blocks them)
  - Sanitises `agentDisplayName` (T-32-02-03 defence-in-depth) before interpolating via `interpolateTemplate`
  - Assembles system + messages array — user message content NEVER concatenated into the system parameter (AI-SPEC §4b.3)
  - Forwards `input.tools` unchanged to `adapter.completeStream` options
  - Commits to a provider on first successful iterator step; mid-stream errors yield through to the caller and terminate (D-23); only stream-open failures (first iterator step throws) fall through to the next provider
  - Throws `CapabilityNotConfiguredError` when no assignment exists; `CapabilityExhaustedError` when ALL providers fail to open a stream
- **PUT `/api/v1/prompts/agent-system` with orgId returns HTTP 400** with body error message `agent-system does not support per-org overrides` and capability `agent-system`, statusCode 400. Guard placed AFTER the valid-prompt-id check (defence-in-depth order per PATTERNS.md). Global PUT (no orgId) still works; other capabilities' per-org PUTs (e.g. extract-requirements) remain unaffected.
- **GET `/api/v1/prompts/agent-system`** returns the default template with all three fences and the `{agentDisplayName}` placeholder intact (regression-tested).
- **`interpolateTemplate(template, vars)` helper** replaces single-brace-key tokens using a regex with negative-lookbehind/lookahead so double-brace Handlebars tokens survive untouched — compatibility with `generate-fix` prompt which uses double-brace placeholders.
- **`bootstrapAgentConversation(db, log)`** runs after `await db.initialize()` in `createServer()`:
  1. No-op when any `agent-conversation` assignment already exists
  2. Prefer `claude-haiku-4-5-20251001` (Anthropic) → `gpt-4o-mini` (OpenAI) → first model (Ollama/on-prem)
  3. Warn via Pino logger and return gracefully when no models registered (no startup blocker)
  4. Assign at priority 1 at the global/system scope (orgId omitted → stored as empty string per sqlite-adapter convention)
- **T-32-02-03 mitigation**: `sanitiseDisplayName()` returns `'Luqen Assistant'` if the incoming name contains an HTML opening or closing angle bracket — plan's threat register prescribed this as a defence-in-depth complement to Plan 08's write-time validator.

## Task Commits

1. **Task 1 (RED):** `3800761` — test(32-02): RED — agent-conversation capability + agent-system prompt + PUT orgId guard
   - 10 failing tests in `tests/capabilities/agent-conversation.test.ts` (suite load error: module does not yet exist)
   - 3 failing + 1 passing test in `tests/api/prompts-agent.test.ts`
   - DbAdapter method names recorded in commit body: `getModelsForCapability`, `getPromptOverride`, `getProvider`
2. **Task 2 (GREEN):** `4b64ae3` — feat(32-02): GREEN — agent-conversation capability + agent-system prompt template + PUT orgId guard (D-10, D-13, D-14)
   - Types extended, agent-system.ts + agent-conversation.ts created, prompts.ts widened with PromptId + isValidPromptId + agent-system case + D-14 guard, cli.ts help text updated
   - 311/311 package tests pass; tsc clean; dashboard tsc clean
3. **Task 3 (REFACTOR):** `a1f16a5` — refactor(32-02): extract interpolateTemplate helper + capability discovery smoke test
   - New `helpers.ts` with Handlebars-safe interpolateTemplate; agent-conversation refactored to use it; 6-case helper test file; capability-discovery smoke test
   - 318/318 tests pass
4. **Task 4 RED:** `a0b59f0` — test(32-02-task4): RED — bootstrapAgentConversation 8 failing cases (B1-B7 + B4b)
   - All 8 tests fail with "bootstrapAgentConversation is not a function"
5. **Task 4 GREEN:** `01d60ec` — feat(32-02-task4): GREEN — bootstrapAgentConversation default seed for agent-conversation (AI-SPEC §4c.1 row #5)
   - Export added + invocation after `await db.initialize()` in `createServer`
   - 326/326 tests pass
6. **T-32-02-03 mitigation:** `8de4df8` — feat(32-02): Rule 2 — sanitise agentDisplayName for T-32-02-03 defence-in-depth
   - Sanitiser + unit test
   - 327/327 tests pass

**Plan metadata commit (pending):** will follow SUMMARY.md via gsd-tools commit helper.

## Files Created/Modified

### Created
- `packages/llm/src/prompts/agent-system.ts` — Default template with verbatim LOCKED fences + agentDisplayName placeholder
- `packages/llm/src/prompts/helpers.ts` — interpolateTemplate (single-brace token replace, negative-lookaround for Handlebars compat)
- `packages/llm/src/capabilities/agent-conversation.ts` — executeAgentConversation AsyncGenerator (provider fallback + D-23 committed-provider semantics + sanitiseDisplayName)
- `packages/llm/tests/capabilities/agent-conversation.test.ts` — 13 tests: CAPABILITY_NAMES, prompt fences, happy-path streaming, system-prompt injection, tool forwarding, per-org override read, provider fallback, exhaustion, mid-stream error, no-assignment, ordering smoke, display-name sanitisation
- `packages/llm/tests/api/prompts-agent.test.ts` — 4 tests: PUT with orgId rejected, PUT without orgId accepted, other capabilities per-org unaffected, GET returns default
- `packages/llm/tests/api/bootstrap-agent-conversation.test.ts` — 8 tests: B1 Haiku seed, B2 getModelsForCapability resolves, B3 idempotency, B4a OpenAI fallback, B4b first-model fallback, B5 no-op on existing, B6 warn-on-empty, B7 fresh-install invariant
- `packages/llm/tests/prompts/helpers.test.ts` — 6 tests: present, missing, repeated, empty-vars, empty-string value, Handlebars-safe

### Modified
- `packages/llm/src/types.ts` — CapabilityName union + CAPABILITY_NAMES array appended with `'agent-conversation'`
- `packages/llm/src/api/routes/prompts.ts` — PromptId union + isValidPromptId + VALID_PROMPT_IDS + agent-system default branch + agent-conversation stub branch + D-14 PUT orgId guard (lines 163-171)
- `packages/llm/src/api/server.ts` — export bootstrapAgentConversation + invoke after `await db.initialize()`
- `packages/llm/src/cli.ts` — `--capability` help lists `agent-conversation`

## Decisions Made

1. **PromptId union of CapabilityName + agent-system instead of extending CapabilityName.** Prompt-management routes manage a superset of ids: `agent-conversation` is a capability (with an assignment, a model, a priority) but its prompt is `agent-system`. Adding `'agent-system'` to `CapabilityName` would pollute the capability-assignment surfaces (admin capabilities tab, `listCapabilityAssignments`). Keeping them in separate type families means changes to one do not leak into the other.
2. **interpolateTemplate uses regex with negative-lookaround** instead of simple split/join. The initial helpers.ts used split/join which matched inside double-brace Handlebars tokens (because single-brace key is a substring). A helper test ("does NOT touch Handlebars-style double-braces") caught this; switched to a regex with negative lookbehind/lookahead so only single-brace tokens match.
3. **D-23 committed-provider semantics codified as "first iterator step commits"**: the capability manually drives the async iterator rather than using `for await` so the stream-open gate has a clear boundary — if first frame yields, we forward every subsequent frame (including error frames) and return; if first frame throws, we fall through to next provider.
4. **`agent-conversation` capability stub in `getDefaultTemplate` switch**: rather than crashing for unknown `CapabilityName`, the switch returns a documenting stub string noting the actual prompt is agent-system. This keeps exhaustiveness working and documents the relationship for future readers.
5. **Bootstrap fourth branch (supportsTools flag) documented but not used today.** Plan specified a four-tier preference chain; the current Model type has no `supportsTools: boolean` column. Implementation uses Haiku → gpt-4o-mini → first-model; step 3 (supportsTools-true) naturally collapses to step 4 (first) until a future plan adds the flag. Documented in the function's doc comment.
6. **T-32-02-03 sanitiser placed at interpolation call site**, not at the type boundary or as a separate zod schema. The risk surface is the LLM system message, so the check is at the last boundary. Plan 08's write-time validator is the primary defense; this is defence-in-depth per the plan's threat register.
7. **Dashboard admin local CAPABILITY_NAMES arrays (`packages/dashboard/src/routes/admin/llm.ts:90,:646`) left unchanged.** These iterate capabilities for the prompt-browser UI; `agent-conversation` has no own prompt (its prompt is `agent-system`), so adding it would render an empty-template row. The admin UI surface for `agent-system` belongs in Plan 32-05 per AI-SPEC §4c.2. Scope boundary flagged in executor prompt; documented here for the UI-phase planner.

## Deviations from Plan

**Total deviations:** 3 (1 Rule 3 blocking, 2 Rule 2 missing-critical). None required architectural decision.

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file path — plan said `tests/api/routes/prompts.test.ts`, actual convention is `tests/api/*.test.ts`**
- **Found during:** Task 1 test-writing step.
- **Issue:** Plan specified a nested `routes/` subdirectory. No such subdirectory exists; the established convention in `tests/api/` is flat. Creating a parallel nested tree would diverge from convention.
- **Fix:** Created `tests/api/prompts-agent.test.ts` following the existing flat naming pattern (same pattern as `prompts-extended.test.ts`).
- **Files:** `packages/llm/tests/api/prompts-agent.test.ts`
- **Committed in:** `3800761` (Task 1 RED).

**2. [Rule 2 - Missing Critical] interpolateTemplate initial implementation collided with Handlebars double-brace tokens**
- **Found during:** Task 3 REFACTOR test run.
- **Issue:** Initial `interpolateTemplate` used split/join which matches single-brace key inside double-brace wrapper (because single-brace is a substring). Existing prompts in the registry use Handlebars-style double-brace tokens; a naive helper would corrupt those.
- **Fix:** Switched to a regex with negative lookbehind/lookahead. Handlebars-safe test case added to `helpers.test.ts`.
- **Files:** `packages/llm/src/prompts/helpers.ts`, `packages/llm/tests/prompts/helpers.test.ts`
- **Committed in:** `a1f16a5` (REFACTOR).

**3. [Rule 2 - Missing Critical] agentDisplayName sanitisation at interpolation time**
- **Found during:** Post-TDD self-review against plan's threat_model.
- **Issue:** The plan's threat register row T-32-02-03 prescribes a specific mitigation: defence-in-depth regex rejection at interpolation time with safe fallback. Plan 08 will validate at write-time but this capability is the boundary at which the value crosses into the LLM system prompt; without the sanitiser, a bypass in Plan 08 could land HTML-like content in the system message.
- **Fix:** Added `sanitiseDisplayName()` helper in `agent-conversation.ts` that returns the safe fallback when the raw name contains an angle bracket. New unit test asserting that an HTML-injected name sanitises to 'Luqen Assistant'.
- **Files:** `packages/llm/src/capabilities/agent-conversation.ts`, `packages/llm/tests/capabilities/agent-conversation.test.ts`
- **Committed in:** `8de4df8`.

### Additive (not strictly a deviation, logged for completeness)

- Added a `capability-discovery` smoke test asserting `'agent-conversation'` is the trailing `CAPABILITY_NAMES` entry — plan called out "If a `listCapabilities()` or similar capability-discovery surface exists in packages/llm/src/api, add a smoke test". Grep found `GET /api/v1/capabilities` in `api/routes/capabilities.ts` which iterates `CAPABILITY_NAMES`; the append-only assertion is the discovery smoke equivalent.
- Updated `packages/llm/src/cli.ts` help text to include `agent-conversation` so admin UX stays consistent — a minor addition not strictly in the files_modified list but clearly Rule 2 (missing info for admin UX).

---

**Impact on plan:** All deviations are strictly additive or convention-preserving. No architectural change. No scope creep. All 4 tasks executed with TDD gate sequence (RED → GREEN, + a REFACTOR task + a Task 4 RED/GREEN + a post-review mitigation commit). Total of 6 commits on master.

## Issues Encountered

- **`db.setPromptOverride` / `getPromptOverride` / `deletePromptOverride` signatures are typed as `CapabilityName`**, but `agent-system` is a prompt id, not a capability. Used type-assertion casts at call sites (two locations: route handlers and the capability). The underlying SQLite schema stores the column as a string, so this is type-level erasure only — runtime behaviour is unaffected. A future refactor could widen the DbAdapter to accept `PromptId` directly.
- **`listModels()` for bootstrap** returns an array ordered by the underlying SQLite row insert order. The B4b test seeded only one model so the "first model" behaviour is unambiguous; in production the first model on `listModels()` is deterministic per SQLite's default ORDER BY (insertion order for CREATE TABLE without explicit ORDER BY). Documented in bootstrap step 4.
- **`Pino` logger shape**: the `log.warn({ctx}, 'message')` double-arg form is idiomatic for Pino but requires the test to handle both arg positions when asserting the message. `bootstrap-agent-conversation.test.ts` B6 uses a defensive index check to cover both.

## Threat Flags

No NEW threat surface beyond what the plan's `<threat_model>` documents. All 7 STRIDE entries (T-32-02-01 through T-32-02-07) are accurate for the implementation shipped:

- **T-32-02-01** (EoP, per-org agent-system override): PUT route refusal verified via Test 11; read path still honors overrides per plan.
- **T-32-02-02** (Tampering, locked-fence deletion): existing `validateOverride` in prompts.ts:165 still enforces locked-section preservation for writes; no regression (extract-requirements per-org PUT still green).
- **T-32-02-03** (Info disclosure, agentDisplayName): defence-in-depth sanitiser added (commit `8de4df8`).
- **T-32-02-04** (Tampering, user→system concatenation): Test 6 in agent-conversation.test.ts explicitly asserts system content does NOT contain user message text, and user arrives as `role:'user'` separate entry.
- **T-32-02-05** (DoS, all providers stream-fail): `CapabilityExhaustedError` thrown on exhaustion (Test 9b) — caller catches and emits SSE error frame per Plan 04.
- **T-32-02-06** (Spoofing, caller-supplied orgId): accepted per plan — capability layer trusts resolved orgId from AgentService.
- **T-32-02-07** (Info disclosure, Org A overrides leaking to Org B): `db.getPromptOverride('agent-system', orgId)` is org-scoped per existing schema; Test 8 seeds an override for one org, capability called with same org returns that org's content (no cross-org leak test added because the existing DB schema prevents cross-org leakage at the SQL level — reviewed sqlite-adapter.ts query which filters on both capability and org_id).

## Next Phase Readiness

**Ready for Plan 32-03** (MCP adapter glue):
- `executeAgentConversation` is a stable contract; AgentService (Plan 04) will call a thin HTTP client over this capability.
- `bootstrapAgentConversation` runs automatically on LLM service startup — fresh installs have a working agent.
- agent-system prompt is served via `GET /api/v1/prompts/agent-system` for admin UI rendering (Plan 05).

**No blockers for Plan 32-03**.

**UI-phase touchpoints deferred to Plan 32-05** (AI-SPEC §4c.2):
- `/admin/llm?tab=prompts` needs to render `agent-system` in the prompt list (currently the admin UI iterates a local `CAPABILITY_NAMES` array that excludes `agent-system`; Plan 32-05 will add it plus the read-only-fence UI variant for per-org editing blocked state).
- `/admin/llm?tab=capabilities` needs the tool-use / manifest-size / destructive-hint badges for `agent-conversation`.
- These are UI-phase concerns per AI-SPEC §4c.2 A-D.

---
*Phase: 32-agent-service-chat-ui*
*Completed: 2026-04-20*

## Self-Check: PASSED

- `packages/llm/src/prompts/agent-system.ts` — FOUND
- `packages/llm/src/prompts/helpers.ts` — FOUND
- `packages/llm/src/capabilities/agent-conversation.ts` — FOUND
- `packages/llm/tests/capabilities/agent-conversation.test.ts` — FOUND
- `packages/llm/tests/api/prompts-agent.test.ts` — FOUND
- `packages/llm/tests/api/bootstrap-agent-conversation.test.ts` — FOUND
- `packages/llm/tests/prompts/helpers.test.ts` — FOUND
- Commit `3800761` (Task 1 RED) — FOUND in `git log`
- Commit `4b64ae3` (Task 2 GREEN) — FOUND in `git log`
- Commit `a1f16a5` (Task 3 REFACTOR) — FOUND in `git log`
- Commit `a0b59f0` (Task 4 RED) — FOUND in `git log`
- Commit `01d60ec` (Task 4 GREEN) — FOUND in `git log`
- Commit `8de4df8` (T-32-02-03 mitigation) — FOUND in `git log`
- `cd packages/llm && npx vitest run` — 327/327 pass
- `cd packages/llm && npx tsc --noEmit` — exit 0
- `grep -c "'agent-conversation'" packages/llm/src/types.ts` — 2 (union + array)
- Runtime LOCKED fences in `buildAgentSystemPrompt()` output — 6 (3 open + 3 close)
- `grep -n 'bootstrapAgentConversation' packages/llm/src/api/server.ts` — 2 (export + invocation)

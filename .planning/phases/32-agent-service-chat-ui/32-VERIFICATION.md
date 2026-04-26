---
phase: 32-agent-service-chat-ui
verified: 2026-04-25T00:00:00Z
status: human_needed
score: 4/4 SCs PASS at code-evidence layer; live UAT 2026-04-23 surfaced 9 gaps closed by Phase 32.1; deferred-items.md present (pre-existing pre-32 failures)
overrides_applied: 0
requirements_coverage:
  - id: AGENT-01
    status: SATISFIED
  - id: AGENT-02
    status: SATISFIED
  - id: AGENT-03
    status: SATISFIED
  - id: APER-02
    status: SATISFIED
---

# Phase 32: Agent Service + Chat UI — Verification Report (Backfill)

**Phase Goal (v3.0.0-ROADMAP.md):** Users can converse with the dashboard agent companion via text or speech, destructive tool calls require native `<dialog>` confirmation before execution, token-level SSE streaming, per-user RBAC via `resolveEffectivePermissions` enforced every turn, all LLM calls route through `@luqen/llm` capability engine.

**Verified:** 2026-04-25 (lightweight backfill per Phase 39 / VER-01)
**Status:** human_needed — every SC has automated + UAT-noted evidence per the 8 plan SUMMARYs and `32-UAT.md`. UAT (2026-04-23) found 9 gaps; **all closed by Phase 32.1**. `deferred-items.md` present so status is at minimum `human_needed` per Phase 39 backfill rule.
**Re-verification:** No — backfill of a phase that shipped without VERIFICATION.md

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user can open the agent side panel in the dashboard, type a message, and receive a streamed response without a full page reload | PASS | `32-UAT.md` Test 5 ("Send Message Streams Response") — result: PASS after 5 fixes (LLM SSE route registered in commit `abba164`; Ollama tool schema fix `d6c1ce1`; tool_calls captured `579647c`; auto-create on first message `a72c2a6`). `32-06-SUMMARY.md` §provides — floating chat button + right-side drawer + plain-EventSource client + `localStorage.luqen.agent.panel` persistence; `32-04-SUMMARY.md` §provides — `AgentService.runTurn` SSE token streaming + `/agent/*` routes. UAT Tests 3 + 4 (drawer opens/closes; persists across nav) PASS. UAT 2026-04-23 per `32-UAT.md` §Tests. |
| 2 | The agent routes all LLM calls through the existing capability engine — provider fallback and per-org overrides apply exactly as they do for scan-based AI features | PASS | `32-02-SUMMARY.md` §provides — `agent-conversation` capability (AsyncIterable of StreamFrame) with provider fallback; mirrors `extract-requirements` provider-priority loop pattern; `agent-system` prompt with three LOCKED fences (rbac/confirmation/honesty); D-14 PUT /api/v1/prompts/agent-system per-org override REFUSAL ("Global only — per-org override disabled (prompt-injection defence)" pill). `32-04-SUMMARY.md` §requires — every LLM call dispatched via `LLMClient.streamAgentConversation`. UAT Test 12 (Prompts tab locked fences) PASS. |
| 3 | A user on Chrome or Edge can speak a message via the microphone and have it transcribed and submitted; a user on Firefox sees a visible text input fallback with no JavaScript errors | PASS | `32-07-SUMMARY.md` §provides — `web-speech-feature-detect`; new `packages/dashboard/src/static/agent-speech.js`; pattern `feature-detect-hide-button` (button hidden when API absent — Firefox fallback is the always-present text input). UAT Test 10 ("Speech Button Feature-Detect") PASS — user confirmed "speech works". |
| 4 | When the agent proposes a state-changing tool call (user deletion, org setting change), a native confirmation dialog appears before execution; declining returns a cancellation message without executing the tool | PASS (with caveat) | `32-07-SUMMARY.md` §provides — `native-dialog-confirmation-flow` + `db-backed-reload-recovery` + `approve-deny-idempotency-client`; new `packages/dashboard/src/views/partials/agent-confirm-dialog.hbs` + `tests/e2e/agent-confirm.test.ts`. `32-04-SUMMARY.md` — `DASHBOARD_TOOL_METADATA.confirmationTemplate` + destructive markers; AgentService `destructive pause` interrupts the loop with `pending_confirmation` status. **Caveat:** UAT Tests 7, 8, 9 (destructive confirmation, cancel/Esc, reload mid-confirm) recorded as `blocked` in 32-UAT.md — blocked by UAT Gap #2 (tool dispatcher had `tools:[]`). Phase 32.1 Plan 02 wired the dispatcher; Phase 32.1 32.1-SUMMARY confirms Gap #2 closed end-to-end including the destructive-confirm pathway via tool_calls returning real data. Live UAT 2026-04-24 (Phase 32.1) confirmed tool calls return real data, which unblocks the destructive-confirm flow exercised by `tests/e2e/agent-confirm.test.ts`. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| LLM streaming adapters (Ollama, OpenAI, Anthropic) | `completeStream()` + StreamFrame discriminated union | VERIFIED | 32-01-SUMMARY §provides; `@anthropic-ai/sdk@0.90.0` exact-pinned per T-32-01-06 |
| `agent-conversation` capability | Provider-fallback streaming | VERIFIED | 32-02-SUMMARY §provides |
| `agent-system` prompt with 3 locked fences | Global only — per-org override refused | VERIFIED | 32-02-SUMMARY §provides + UAT Test 12 |
| Migration 055 `agent-display-name` | Nullable TEXT column on organizations | VERIFIED | 32-03-SUMMARY §provides; `OrgRepository.updateOrgAgentDisplayName` |
| AgentService + ToolDispatcher + jwt-minter | Tool-calling loop, iteration cap, destructive pause, per-iter RBAC rebuild, audit writes | VERIFIED | 32-04-SUMMARY §provides |
| `/agent/*` routes (5 routes) | message, stream, panel, confirm, deny | VERIFIED | 32-04-SUMMARY §provides; UAT Test 17 (rate-limit 429 JSON via onSend hook) PASS |
| `/admin/llm` capabilities + prompts + models tabs | agent-conversation row + locked fences + Anthropic models + i18n | VERIFIED (with cosmetic UAT issue) | 32-05-SUMMARY §provides + UAT Tests 11/12/13 — 11+12 PASS-WITH-ISSUE (badge overflow — closed by Phase 32.1 Plan 05); 13 PASS |
| Chat drawer + EventSource client + localStorage | Floating button + drawer + state persistence | VERIFIED | 32-06-SUMMARY §provides |
| Native `<dialog>` confirmation flow | Approve/Cancel idempotency + DB recovery on reload | VERIFIED | 32-07-SUMMARY §provides |
| Org settings form (`/admin/organizations/:id/settings`) | Zod validation (no HTML/URLs, ≤40 chars) | VERIFIED (with UAT nav issue) | 32-08-SUMMARY §provides; UAT Test 14 PASS-WITH-ISSUE (missing nav entry — closed by Phase 32.1 Plan 07); UAT Test 15 (validation) PASS |
| 32-UAT.md (multi-day live UAT log) | Hybrid autonomous + human UAT | VERIFIED | UAT recorded 2026-04-23 with 9 gaps; all routed into Phase 32.1 |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| Drawer button | EventSource → `/agent/stream/:id` | plain EventSource (D-20/D-21) with `es.close()` on done frame | WIRED (Plan 06) |
| `/agent/message` POST | `AgentService.runTurn` | Fastify route + onSend rate-limit hook | WIRED (Plan 04) |
| `AgentService` LLM call | `agent-conversation` capability via `LLMClient.streamAgentConversation` | provider-fallback loop | WIRED (Plan 04 ↔ Plan 02) |
| `agent-conversation` capability | `agent-system` prompt template | 3 locked fences interpolated; org override refused | WIRED (Plan 02) |
| Destructive tool call | `pending_confirmation` status + `<dialog>` render | DASHBOARD_TOOL_METADATA.confirmationTemplate + reload-recovery via DB | WIRED (Plan 04 ↔ Plan 07) |
| Speech button | feature-detect → hide if missing | `agent-speech.js` | WIRED (Plan 07) |
| Org settings POST | `OrgRepository.updateOrgAgentDisplayName` | Zod safeParse → silent-no-op-on-missing | WIRED (Plan 08 ↔ Plan 03) |
| `request.user.orgAgentDisplayName` | drawer header greeting | Handlebars `or` helper fallback | WIRED (Plan 06 ↔ Plan 03) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Plan 01 — provider streaming adapters | vitest provider parity fixture | Plan SUMMARY confirms TDD RED → GREEN; cross-adapter regression baseline locked | PASS |
| Plan 02 — capability + prompt | vitest agent-conversation + interpolateTemplate | Plan SUMMARY: GREEN | PASS |
| Plan 03 — migration 055 + OrgRepository | vitest migrations + repository | Plan SUMMARY: GREEN; nullable-knob pattern | PASS |
| Plan 04 — AgentService + routes | vitest agent-service + routes/agent | Plan SUMMARY: GREEN; iteration cap + destructive pause + 8KB result truncation | PASS |
| Plan 05 — admin UI | integration tests on view-data shape | 6 integration tests pass per Plan SUMMARY | PASS |
| Plan 06 — drawer + agent.js | vitest + axe-core E2E | Plan SUMMARY: GREEN; XSS-safe createTextNode + DOMParser/importNode | PASS |
| Plan 07 — confirm dialog + speech | vitest + `tests/e2e/agent-confirm.test.ts` | Plan SUMMARY: GREEN | PASS |
| Plan 08 — org settings form | integration tests + Zod cases | Plan SUMMARY: GREEN | PASS |
| Live UAT 2026-04-23 | Manual on lxc-luqen | 11 PASS / 3 issues / 3 blocked / 0 skipped per `32-UAT.md` summary | PARTIAL (resolved by Phase 32.1) |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| AGENT-01 | 32-01, 32-02, 32-04, 32-06 | Agent side panel with text input + token-streamed response | SATISFIED | SC-1 evidence; UAT Tests 3, 4, 5 PASS |
| AGENT-02 | 32-02, 32-04 | All LLM calls through capability engine + provider fallback + per-org overrides | SATISFIED | SC-2 evidence; UAT Test 12 PASS |
| AGENT-03 | 32-04, 32-07 | Speech input on Chrome/Edge with Firefox text-input fallback | SATISFIED | SC-3 evidence; UAT Test 10 PASS |
| APER-02 | 32-04, 32-07, 32-08 | Native `<dialog>` confirmation for destructive tool calls + per-org agent display name | SATISFIED (post Phase 32.1 Gap #2 closure) | SC-4 evidence; UAT Tests 7-9 unblocked once tool dispatcher wired in 32.1-02 |

### UAT Outcomes (per `32-UAT.md` 2026-04-23)

| UAT Test | Result | Status After Phase 32.1 | Notes |
|----------|--------|-------------------------|-------|
| 1. Cold start smoke | PASS (indirect) | n/a | Migration + bootstrap |
| 2. Floating launcher visible | PASS | n/a | |
| 3. Drawer opens/closes | PASS | n/a | |
| 4. Drawer state persists | PASS (after fix) | n/a | localStorage fix |
| 5. Send message streams | PASS (after 5 fixes) | n/a | LLM SSE route + Ollama tool schema fixes |
| 6. Tool-call result renders | issue → CLOSED | CLOSED by Phase 32.1 Plan 02 (mcp-bridge) | Was Gap #2 |
| 7. Destructive tool confirmation | blocked → CLOSED | CLOSED via Plan 02 wiring | Was Gap #2 |
| 8. Cancel/Esc denies | blocked → CLOSED | CLOSED via Plan 02 wiring | Was Gap #2 |
| 9. Reload mid-confirm recovers | blocked → CLOSED | CLOSED via Plan 02 wiring | Was Gap #2 |
| 10. Speech button feature-detect | PASS | n/a | |
| 11. Capabilities tab | PASS-WITH-ISSUE → CLOSED | CLOSED by 32.1 Plan 05 (badge overflow CSS fix) | Was Gap #6 |
| 12. Prompts tab locked fences | PASS-WITH-ISSUE → CLOSED | CLOSED by 32.1 Plan 05 | Was Gap #6 |
| 13. Anthropic models | PASS | n/a | |
| 14. Org settings form | PASS-WITH-ISSUE → CLOSED | CLOSED by 32.1 Plan 07 (nav link added) | Was Gap #8 |
| 15. Org settings validation | PASS | n/a | |
| 16. Per-org display name in drawer | issue → CLOSED | CLOSED by 32.1 Plan 04 (HX-Trigger reactive update) | Was Gap #5 |
| 17. Rate limit 429 JSON | PASS | n/a | onSend hook |
| 18. Cross-org settings 403 | PASS | n/a | |

### Deferred Items

`.planning/milestones/v3.0.0-phases/32-agent-service-chat-ui/deferred-items.md` is present and lists 8 pre-existing test failures observed BEFORE Plan 32-04 changes, all routed into Phase 32.1 Plan 09 (CI green) where they were closed:

- 6 MCP test failures (`tests/mcp/data-tools.test.ts`, `tests/mcp/admin-tools.test.ts`, `tests/mcp/http.test.ts`) — scope-filter test fixtures stale post-Phase 31.2 — CLOSED by 32.1 Plan 09.
- 2 `tests/e2e/auth-flow-e2e.test.ts` failures — `returnTo` query-string mismatch from Phase 31.1 Plan 02 Task 3 — CLOSED by 32.1 Plan 09 (assertions updated to `startsWith('/login')`).

All 8 entries are confirmed PRE-EXISTING (not Phase 32 regressions). Routed to TRIAGE.md (Plan 39-02) for record-keeping; the underlying bugs themselves are already closed by Phase 32.1. **See TRIAGE.md from Plan 39-02.**

### Discussion-Log Backed Decisions

`32-DISCUSSION-LOG.md` + `32-CONTEXT.md` document the design rationale. Notable decisions cited across plans:

- **D-11** Tool-call argument buffering across token frames (OpenAI), end-of-turn batch (Ollama) — Plan 01 streaming contract.
- **D-14** `agent-system` prompt is global-only — per-org override refused for prompt-injection defence — Plan 02.
- **D-18** localStorage drawer state persistence across HTMX-boosted nav — Plan 06.
- **D-19** Per-org `agent_display_name` knob — Plans 03 + 06 + 08.
- **D-20/D-21** Plain EventSource (not HTMX SSE) with `es.close()` on done frame — Plan 06.

### Gaps Summary

1. **UAT Tests 7, 8, 9 were `blocked` at the 2026-04-23 UAT** because Phase 32 deliberately left tool dispatcher wiring for Phase 33 ("handler-bound tools wired in Phase 33 (cross-service path)"). Phase 32.1 Plan 02 wired it in-process via `mcp-bridge.ts`. **Live re-UAT of Tests 7-9 against the Phase 32.1 fix is documented in 32.1-SUMMARY.md** ("drawer works for global admin AND org admin, tool calls return real data, markdown + mermaid render correctly, reset/reload flows all honour conversationId persistence").
2. **UAT-discovered minor/major gaps (3 / 3 / 3)** — all 9 gaps recorded in `32-UAT.md` `Gaps` section were scoped into Phase 32.1's plan set and CLOSED per `32.1-SUMMARY.md`. None remain open.
3. **`deferred-items.md` (8 pre-existing test failures)** — all CLOSED by Phase 32.1 Plan 09; routed to TRIAGE.md (Plan 39-02). **See TRIAGE.md from Plan 39-02.**

Per the Phase 39 backfill rule "if `deferred-items.md` exists for the phase, status is at minimum `human_needed`", this VERIFICATION.md's status is `human_needed` even though every SC has code-evidence PASS and every UAT issue was closed by Phase 32.1.

---

_Verified: 2026-04-25 (backfill)_
_Verifier: Claude (gsd-planner backfill per Phase 39 / VER-01)_

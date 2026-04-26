# Phase 32: Agent Service + Chat UI — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

**What this phase delivers:**
- `AgentService` orchestrator in `packages/dashboard/src/agent/` that owns the tool-calling loop and persists every turn via the Phase 31 repositories
- Right-side chat drawer with floating entry button on every authenticated dashboard page, single rolling thread per user, panel open/closed state persisted in `localStorage`
- Server-minted short-lived RS256 JWT per request for MCP tool dispatch (auth invariant for per-user RBAC)
- Confirmation dialog flow driven by the MCP `destructiveHint` tool annotation, with `pending_confirmation` recovery on reload
- Speech input via Web Speech API with text-only fallback for Firefox (Claude's discretion on interaction pattern)
- Token-level SSE streaming end-to-end: add streaming code paths to `packages/llm/src/providers/ollama.ts` and `openai.ts`, plus a NEW Anthropic adapter
- New global `agent-system` prompt managed via the existing LLM prompt-management system (`/admin/llm?tab=prompts`)

**What this phase does NOT deliver** (tracked for other phases):
- The MCP Authorization spec upgrade (OAuth 2.1 + PKCE, refresh tokens, Dynamic Client Registration, `.well-known/oauth-protected-resource` + `.well-known/oauth-authorization-server` metadata). **Routed to an inserted Phase 31.1** — must land before Phase 32 ships. Requirements MCPAUTH-01/02/03.
- Context-aware org data injection / live scan references in responses — Phase 33 (AGENT-04)
- Token-budget management with sliding-window summary compaction — Phase 33 (AGENT-05)
- Admin audit log viewer page — Phase 33 (APER-04)
- Multi-thread conversation sidebar / thread rename / delete
- Per-org custom agent system prompts (REQUIREMENTS Out of Scope — prompt injection surface)
- Server-side Whisper or any TTS feature (REQUIREMENTS Out of Scope)

**Phase requirement IDs:** AGENT-01, AGENT-02, AGENT-03, APER-02. MCPAUTH-01/02/03 re-routed to Phase 31.1 (see Deferred Ideas).

</domain>

<decisions>
## Implementation Decisions

### Scope routing (MCPAUTH)
- **D-01:** MCP Authorization spec upgrade (OAuth 2.1 + PKCE + refresh + DCR + well-known metadata) lands as a new **Phase 31.1 (inserted — CLI-assigned number after `/gsd-insert-phase 31 "MCP Authorization Spec Upgrade"`)** before Phase 32 ships. Phase 32 is gated on 31.1 for external-client auth compliance, but the two can be planned in parallel because their code surfaces barely overlap (31.1 = auth middleware + new routes + metadata; 32 = agent runtime + UI).
- **D-02:** Phase 32 itself stays multi-plan under one phase — sequenced as: streaming adapters + Anthropic provider (prereq), then AgentService + tool loop, then chat UI + streaming client, then confirmation flow, then speech input. Do NOT subdivide into separate phases.

### Agent authentication (internal, dashboard → MCP)
- **D-03:** Chat UI authenticates with the **existing cookie-session**. `POST /agent/message` is session-guarded; the route handler **mints a short-lived per-user RS256 JWT** (existing JWT signing infra) for downstream MCP tool dispatch. No new user-facing OAuth flow is introduced in Phase 32. This preserves per-user RBAC via `resolveEffectivePermissions(userId, orgId)` and respects the scope-filter rules locked in Phase 30.1.
- **D-04:** The minted JWT carries the user's `sub` = `dashboard_users.id` and `orgId` = the user's active org — not a service `client_id`. This means `filterToolsByScope` in `packages/core/src/mcp/tool-filter.ts` gets the full per-user permission set, not the empty-set fallback.

### Agent runtime architecture
- **D-05:** **`AgentService` lives in `packages/dashboard/src/agent/`** and owns the `while(tool_calls)` loop. It:
  1. Reads the rolling window via `storage.conversations.getWindow(conversationId)`.
  2. Calls a new LLM-service capability (D-10) for each model turn, passing messages + tool manifest.
  3. On `tool_calls` response: dispatches each via the local MCP client (or direct MCP handler invocation — planning decision), appends a `role='tool'` message, then loops.
  4. On plain text response: appends a final `role='assistant'` message, closes the turn.
- **D-06:** **Iteration cap = 5 tool calls per user turn.** If the model tries to emit a 6th `tool_calls` response, AgentService forces a final-answer turn (re-prompts with "respond to the user now based on what you've learned"). Exceeding the cap writes an `agent_audit_log` row with `outcome='error'` and `outcome_detail='iteration_cap'`.
- **D-07:** **Tool-decision mechanism = provider-native function calling.** Use OpenAI `tools` parameter and Ollama `tools` field (Ollama ≥ 0.3.0). No JSON-schema-forced output, no regex parsing. Tool manifest built from `resolveEffectivePermissions(userId, orgId)` filtered against `tool_filter` (Phase 30.1 rules) before every model turn.
- **D-08:** **Tool manifest shape** — Dashboard-side MCP tools are the primary surface (scan, reports, brand score, admin ops). The planner should confirm during research whether the agent ALSO exposes cross-service tools from compliance/branding/LLM on this phase, or whether it stays dashboard-only for MVP. Tentative: **dashboard-only manifest in Phase 32**; cross-service tool exposure in Phase 33 together with AGENT-04 org-context awareness.

### LLM routing (AGENT-02 invariant)
- **D-09:** All model calls route through `@luqen/llm` at `llm:4200` via the existing capability engine — non-negotiable. AgentService never talks to OpenAI/Ollama/Anthropic directly.
- **D-10:** **Add a new LLM capability: `agent-conversation`** in `packages/llm/src/capabilities/`. Contract:
  - Input: `{ messages: Message[], tools: ToolManifest, stream: true }`.
  - Output: `ReadableStream` of SSE events (`token`, `tool_calls`, `done`, `error`).
  - Capability engine handles provider fallback + per-org model overrides as it does for `generate-fix`.
  - Prompt template includes a locked system-prompt section + model-specific tool-use instructions.
- **D-11:** **Add token-level streaming** to existing adapters. Touch:
  - `packages/llm/src/providers/ollama.ts` (line 43 currently hardcodes `stream: false`)
  - `packages/llm/src/providers/openai.ts`
  Stream text tokens token-level; when a `tool_calls` block begins, buffer it to completion before emitting the `tool_calls` SSE event (matches Ollama 0.3.0 behavior, simplifies loop).
- **D-12:** **Add a NEW Anthropic provider adapter** at `packages/llm/src/providers/anthropic.ts`. Implements the same `LlmProvider` interface as `ollama.ts`/`openai.ts`. Also adds Anthropic model entries to the model registry and makes `agent-conversation` capability assignable to Claude models via existing `/admin/llm` UI. **Anthropic SDK `@anthropic-ai/sdk` (latest) — pin to a specific version in planning.**

### System prompt
- **D-13:** **New global `agent-system` prompt** stored in the LLM prompt-management system (same table, same CRUD as `extract-requirements-system` etc.), editable via `/admin/llm?tab=prompts`. Uses the v2.10.0 locked-sections pattern: critical instructions (RBAC respect, tool-use format, confirmation for destructive ops) in `<!-- LOCKED -->` fenced sections; editable sections for tone + personality.
- **D-14:** **No per-org system-prompt override.** Explicitly out of scope per REQUIREMENTS.md (prompt injection surface). The only per-org knob is an agent *display name* (e.g. "Luna", "Aperol Assistant") — a string on the `organizations` table. Display name is a Phase 32 deliverable; falls back to a project-wide default ("Luqen Assistant") when unset.

### Chat UI — placement + threading
- **D-15:** **Right-side drawer.** Sticky panel, collapsible. Mobile: slides over with a backdrop shim.
- **D-16:** **Floating entry button, bottom-right, on every authenticated dashboard page.** The button lives in the shared layout partial so it survives HTMX nav.
- **D-17:** **Single rolling thread per user.** No multi-thread sidebar, no "New conversation" button in MVP. The rolling 20-turn window (Phase 31) is the only history model. `ConversationRepository.listForUser` already supports multi-thread — the schema is future-proof, the UI is not built.
- **D-18:** **Panel open/closed state persists in `localStorage`** (`luqen.agent.panel = 'open' | 'closed'`). HTMX boosted nav keeps the DOM mounted so the drawer does not re-render on page transitions. State reads on initial mount.
- **D-19:** **First-open UX** — new users get a single pinned assistant message: "Hi, I'm {agent display name}. I can help with scans, reports, branding, and admin. What would you like to do?" Message is synthetic (not stored as `role='assistant'`), disappears once real history exists.

### Streaming + transport
- **D-20:** **End-to-end token-level SSE.** Path: browser `EventSource('/agent/stream/:conversationId')` → dashboard route handler → forwards the capability `ReadableStream` event-by-event. Browser JS handles `token`, `tool_calls`, `done`, `error` frame types.
- **D-21:** **Never use `hx-sse`** — memory: STATE.md gotcha (HTMX 2.0 `hx-select` inheritance). Chat input is a regular HTMX POST that returns a 202 + the new user message markup; streaming assistant response arrives on the separate SSE channel.
- **D-22:** `@fastify/rate-limit` applied to `/agent/message` and `/agent/stream/*` with `onSend` hook returning JSON `{error:'rate_limited', retry_after_ms}` — not HTML 429. Memory: `feedback_rate_limiter.md`. Start with 60 req/min per user; planner tunes.

### Error + timeout surface
- **D-23:** **Mid-stream LLM failure** → capability engine's existing retry/fallback chain fires first (AGENT-02). If all providers fail, AgentService emits a final SSE `error` frame; browser renders a red "Response interrupted" card with a **Retry button**. The in-flight assistant message is marked `status='failed'` in `agent_messages` so the thread is consistent on reload.
- **D-24:** **Tool-call timeout = 30s default** (wall-clock, per tool dispatch). On expiry: `AgentAuditRepository.append({outcome: 'timeout', outcome_detail: '30s'})`, the tool result fed back to the LLM loop is `{error: 'timeout', message: 'Tool did not respond in time.'}` so the model can apologize gracefully in its next turn. No per-tool timeout config in MVP (Claude's discretion via metadata extension if a specific tool forces it).
- **D-25:** **Provider 429** → capability engine fallback chain already handles this (switches to next provider/model). No additional retry at AgentService level.

### Confirmation dialog (APER-02 / SC#4)
- **D-26:** **Trigger = MCP tool metadata `destructiveHint: true`.** Read directly from the tool metadata surfaced by `tools/list`. The AgentService inspects each pending `tool_calls` response; if any tool has `destructiveHint`, AgentService:
  1. Writes an `agent_messages` row with `role='tool'`, `status='pending_confirmation'`, `tool_call_json` populated, `tool_result_json` NULL.
  2. Suspends the loop and emits an SSE `pending_confirmation` frame carrying the tool name + args summary.
  3. Waits for `POST /agent/confirm` (approve) or `POST /agent/deny` (deny) on the pending message id.
- **D-27:** **Dialog pattern = native `<dialog>.showModal()`.** Consistent with rescore-confirm and drilldown-modal (v2.12.0 PROJECT.md decisions). No new JS framework. Focus trap handled by the browser. Includes Approve (destructive button color) + Cancel buttons.
- **D-28:** **Args UX = per-tool friendly template + collapsible raw-JSON expander.** Templates live alongside MCP tool metadata. Shape: `{ tool_name: 'dashboard_scan_site', confirmationTemplate: (args) => string }`. Fallback: when no template is provided, dialog shows the tool description from MCP metadata + pretty-printed JSON. The collapsible `<details>` expander shows raw JSON for audit.
- **D-29:** **Recovery on reload/reopen** — On chat panel mount, query `storage.conversations.getWindow(conversationId)`. If the most recent message has `status='pending_confirmation'`, immediately call `.showModal()` and render the stored `tool_call_json` in the dialog. SC#4: "a pending destructive tool call is recoverable from DB, not from JavaScript memory" — this is the wiring.
- **D-30:** **No auto-deny TTL in MVP.** The pending state persists indefinitely until the user approves, denies, or explicitly clears via a "Cancel pending action" button in the dialog. (Claude's discretion: add a 5-min nudge toast if planner flags UX concern, but do not auto-deny.)

### Speech input (Claude's Discretion, with constraints)
- **D-31:** **Feature-detect** via `window.SpeechRecognition || window.webkitSpeechRecognition`. If absent (Firefox), render only the text input — no microphone button, no JS error. Explicit: **no server-side fallback transcription** (REQUIREMENTS Out of Scope — server-side Whisper).
- **D-32:** **Language** — Use `navigator.language` as the speech recognition language, fallback to `en-US`. No per-org locale override in MVP (Claude's discretion if planner surfaces a real need).
- **D-33:** **EU data-residency flag** — STATE.md blockers note: "Web Speech API EU data residency — confirm whether org users have constraints". Treat as planning prerequisite: research must confirm EU residency is acceptable for the target users before Phase 32 ships. If EU residency IS required for any org, the microphone button must be hideable per-org. Captured as Claude's discretion pending research.
- **D-34:** Interaction pattern (tap-to-start vs hold-to-talk vs toggle) is **Claude's discretion** during planning; recommended default is tap-to-start / tap-to-stop for simplicity.

### Claude's Discretion
- Whether AgentService dispatches MCP tools via local in-process handler invocation or HTTP `POST /mcp` to the dashboard's own MCP endpoint (planner decides — local call is faster, HTTP call is more consistent with cross-service tools in Phase 33).
- Exact SSE frame names (`token` vs `delta`, etc.) — pick whatever is readable in browser devtools.
- Chat drawer width / motion / theme specifics — follow `feedback_design_system_consistency.md` (use existing style.css classes).
- Whether confirmation dialog renders the friendly template server-side (HTMX fragment) or client-side from JSON — choose based on i18n needs in planning.
- Whether the `agent-system` prompt-management entry uses the same `<!-- LOCKED -->` UI as existing capabilities or a thinner variant.
- Handling of the synthetic "Hi, I'm {agent}" first-open message — purely UI state vs DB placeholder.
- How cancellation mid-stream is surfaced (Stop button in UI during streaming, abort SSE connection, AgentService traps abort and persists partial text).
- Whether the chat panel shows typing indicators while streaming or just a blinking cursor.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 32 requirements + roadmap
- `.planning/ROADMAP.md` §"Phase 32: Agent Service + Chat UI" — phase goal, success criteria (lines 101-113), cross-cutting MCPAUTH note
- `.planning/REQUIREMENTS.md` — AGENT-01/02/03, APER-02, MCPAUTH-01/02/03 definitions; Out of Scope section (prompt injection, TTS, Whisper, per-org prompts)
- `.planning/PROJECT.md` §"Current Milestone: v3.0.0" and Key Decisions table — v3.0.0 architecture posture, native `<dialog>` decisions, locked prompt sections pattern
- `.planning/STATE.md` §"Architecture Notes" — locks MCP embedded plugin model, SQLite persistence, rolling window, plain EventSource streaming, resolveEffectivePermissions-based RBAC; §"Blockers/Concerns" — Web Speech API EU residency, `agent-conversation` capability registration, `fastify-mcp` maintenance status

### Phase 31 (consumed, not modified) — persistence foundation
- `.planning/phases/31-conversation-persistence/31-CONTEXT.md` — D-locked table shapes, rolling-window write-time policy, repository surface contract
- `.planning/phases/31-conversation-persistence/31-01-PLAN.md` + `31-02-PLAN.md` — migration + repo implementation plans
- `.planning/phases/31-conversation-persistence/31-SUMMARY.md` + `31-VERIFICATION.md` — confirms what's shipped vs pending
- `packages/dashboard/src/db/interfaces/conversation-repository.ts` — `Conversation`, `Message`, `MessageStatus` types + repo interface
- `packages/dashboard/src/db/interfaces/agent-audit-repository.ts` — `AuditEntry`, `ToolOutcome` types + repo interface
- `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` — `getWindow`, `appendMessage`, `updateMessageStatus`, rolling-window maintenance
- `packages/dashboard/src/db/sqlite/repositories/agent-audit-repository.ts` — append-only `append` + filtered `listForOrg` + `countForOrg`
- `packages/dashboard/src/db/sqlite/migrations.ts` — migrations 047 (conversations+messages) and 048 (audit log)

### Phase 30.1 (consumed) — scope-filter invariant
- `.planning/phases/30.1-mcp-oauth-scope-gate/30.1-CONTEXT.md` — empty-set on unknown sub, per-permission-suffix scope rules
- `packages/core/src/mcp/tool-filter.ts` — `filterToolsByScope` / `filterResourcesByScope` used by AgentService pre-manifest-pass
- `packages/dashboard/src/db/sqlite/repositories/role-repository.ts` — `getUserPermissions` returns empty Set for unknown subs (never fall back to user roles for service callers)
- `packages/dashboard/src/permissions.ts` — `resolveEffectivePermissions(userId, orgId)` is the single source of truth for per-user RBAC

### Phase 28/29/30 (consumed) — MCP transport + tools
- `.planning/phases/28-mcp-foundation/28-CONTEXT.md` — `createMcpHttpPlugin()` factory, `AsyncLocalStorage<ToolContext>`, `tools/list` filter via `setRequestHandler(ListToolsRequestSchema)`
- `.planning/phases/29-service-mcp-tools/29-CONTEXT.md` — LLM + branding MCP tool contracts, `D-13` invariant (no `orgId` in inputSchema — source from ToolContext)
- `.planning/phases/30-dashboard-mcp-external-clients/30-CONTEXT.md` — dashboard tools, resources, prompts shape (includes `D-12` prompt-shape as chat-message templates)
- `packages/dashboard/src/mcp/server.ts` — dashboard MCP server composition (tools + resources + prompts)
- `packages/dashboard/src/mcp/tools/admin.ts` + `packages/dashboard/src/mcp/tools/data.ts` — destructiveHint annotation sites
- `packages/dashboard/src/mcp/metadata.ts` — `ToolMetadata` shape (add `confirmationTemplate` field here per D-28)

### LLM module — streaming + Anthropic additions
- `packages/llm/src/providers/ollama.ts` — line 43 `stream: false` — add streaming code path
- `packages/llm/src/providers/openai.ts` — add streaming code path
- `packages/llm/src/providers/types.ts` — `LlmProvider` interface; streaming addition must update this contract
- `packages/llm/src/providers/registry.ts` — provider registration; add Anthropic entry
- `packages/llm/src/capabilities/extract-requirements.ts` / `generate-fix.ts` / `analyse-report.ts` / `discover-branding.ts` — reference shape for new `agent-conversation` capability
- `packages/llm/src/capabilities/types.ts` — capability interface; streaming capability may require new return type variant

### Project conventions + gotchas (carry forward)
- `CLAUDE.md` — project GSD workflow, TDD enforcement, service-auth pattern
- `.planning/PROJECT.md` Key Decisions — native `<dialog>` pattern for rescore + drilldown (v2.12.0), locked sections prompt pattern (v2.10.0), LLM per-org OAuth client parity (v2.9.0), inter-service OAuth2 client-credentials (service_auth_pattern)
- Memory references downstream agents should respect:
  - HTMX 2.0 `hx-select` inheritance → plain JS `EventSource` always (feedback_htmx_inheritance)
  - `@fastify/rate-limit` 429 bypass → onSend hook for JSON response (feedback_rate_limiter)
  - HTMX forms in table cells → never (feedback_htmx_forms_in_tables) — not directly relevant but general HTMX discipline
  - Design system consistency → reuse style.css classes (feedback_design_system_consistency)
  - Service auth → always OAuth2 client-credentials between services (feedback_service_auth_pattern)

### External (web) canonical references the planner will lean on
- Ollama chat API streaming: `https://github.com/ollama/ollama/blob/main/docs/api.md#chat-request-streaming`
- Ollama tool-use (0.3.0+): `https://ollama.com/blog/tool-support`
- OpenAI Chat Completions streaming + tool calls: `https://platform.openai.com/docs/guides/streaming-responses` and `https://platform.openai.com/docs/guides/function-calling`
- Anthropic Messages API streaming + tool use: `https://docs.anthropic.com/en/api/messages-streaming` and `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview`
- MCP `destructiveHint` annotation: `https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations`
- Web Speech API: `https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API` — Firefox support status

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- **Rolling-window reads**: `storage.conversations.getWindow(conversationId)` returns `Message[]` with `in_window=1` already ordered by `created_at ASC` — feed directly to LLM. No in-AgentService turn counting needed.
- **Append-write with window maintenance**: `storage.conversations.appendMessage({conversationId, role, content?, toolCallJson?, toolResultJson?, status?})` maintains the rolling window inside a transaction. AgentService calls this for user message, each tool message, and final assistant message.
- **Audit append**: `storage.agentAudit.append({userId, orgId, conversationId?, toolName, argsJson, outcome, outcomeDetail?, latencyMs})` — only mutation method; append-only by contract.
- **Scope-aware tool filtering**: `filterToolsByScope(tools, permissions)` in `packages/core/src/mcp/tool-filter.ts` — AgentService calls this each turn to build the per-user manifest.
- **MCP server composition**: `packages/dashboard/src/mcp/server.ts` `createDashboardMcpServer` — shows how tools + resources + prompts compose; AgentService needs a local MCP client or direct invocation path into this shape.
- **Native dialog pattern**: existing use in rescore + drilldown partials shows the shape — `<dialog id="agent-confirm"><form method="dialog">...` + `dialog.showModal()` in client JS.
- **Locked-section prompt editor**: `/admin/llm?tab=prompts` already handles `<!-- LOCKED:name -->` fences and diff-from-default UI; the new `agent-system` prompt slots in without new UI work.
- **LLM capability execution**: `packages/llm/src/capabilities/*.ts` → `executeXxx` pattern with `CapabilityContext` + `ExecutionOptions`; new `agent-conversation` follows the same shape but returns a stream.

### Established patterns
- **OAuth2 client-credentials between services** — `packages/dashboard/src/llm-client.ts` is the template. AgentService's LLM calls use this path. However, the internal user JWT for MCP dispatch is a *new* short-lived token minted from the session (D-03/D-04) — not the service-to-service client-credentials token.
- **SSE streaming**: `packages/dashboard/dist/static/htmx-sse.js` exists but **must not be used** per STATE.md gotcha — use plain `EventSource` in new client JS.
- **HTMX partial rendering**: chat input uses `hx-post`, assistant streaming uses `EventSource` side-channel (HTMX for form submit, plain JS for streaming).
- **`<details>` for collapsibles**: v2.10.0 Revoked-keys section pattern — no JS needed, accessible by default — reuse for raw-JSON args expander.
- **Error surface**: project convention is red inline card + Retry button in-flow (not toast), per existing report-error views.

### Integration points
- **Floating agent button**: add to `packages/dashboard/src/views/layouts/*` (the shared layout partial) so it appears on every authenticated page.
- **Chat drawer DOM**: render once in the shared layout, hide/show via `localStorage` + CSS class.
- **New routes**: `packages/dashboard/src/routes/agent.ts` (new file) — `POST /agent/message`, `GET /agent/stream/:conversationId`, `POST /agent/confirm/:messageId`, `POST /agent/deny/:messageId`, `GET /agent/panel` (drawer HTMX partial).
- **AgentService wiring**: `packages/dashboard/src/server.ts` — construct `AgentService` alongside `ScanService` + service connections; inject into routes.
- **Permissions**: read `resolveEffectivePermissions` per turn inside AgentService; do NOT cache across turns (user permissions may change within a long-lived conversation).
- **Prompt management extension**: `/admin/llm?tab=prompts` — add `agent-system` entry. Existing UI handles it via the prompt-registry JSON catalog.
- **Model registry**: Anthropic models appear in `/admin/llm?tab=models` via the registry — capability assignment to `agent-conversation` via existing `/admin/llm?tab=capabilities`.
- **Rate limiter**: `packages/dashboard/src/server.ts` — register `@fastify/rate-limit` on `/agent/*` with the `onSend` hook from `feedback_rate_limiter.md`.

</code_context>

<specifics>
## Specific Ideas

- "Companion" mental model: drawer always reachable via the floating button; panel state persists across nav so the user feels the agent is "there" rather than "visited."
- Native `<dialog>` everywhere — pattern is working well (rescore + drilldown) and is consistent with the "no new frameworks" constraint.
- Ollama 0.3.0+ streams tool_calls as a single block at the end of the turn (not incrementally). The loop should buffer the assistant stream until it sees either plain text end-of-stream OR a full tool_calls block — mirrors the agreed D-11 behavior and avoids brittle incremental tool-call parsing.
- Phase 32 absorbs the "add Anthropic adapter" work even though the requirements don't demand Claude specifically. Decision driver: Claude is the strongest tool-calling model at time of planning (2026-04-18) and the agent is a tool-calling product. Cost of adding it now vs later is roughly flat; value is meaningful for users who have Anthropic keys.

</specifics>

<deferred>
## Deferred Ideas

### Moved to Phase 31.1 (inserted, pre-Phase-32)
- **MCPAUTH-01**: `.well-known/oauth-protected-resource` + `.well-known/oauth-authorization-server` metadata discovery endpoints across all services.
- **MCPAUTH-02**: OAuth 2.1 Authorization Code + PKCE flow with refresh tokens, replacing bootstrap `client_credentials` + static Bearer for external MCP clients. Per-user token identity so `resolveEffectivePermissions` applies naturally.
- **MCPAUTH-03**: Dynamic Client Registration (RFC 7591) — decide Open vs Admin-gated DCR during 31.1 discuss-phase.

### Deferred to Phase 33 (AGENT-04 / AGENT-05 / APER-04 scope)
- Context-aware org data injection into agent responses (recent scans, active guidelines, applicable regulations).
- Token-budget management with sliding-window summary compaction.
- Admin audit log viewer at `/admin/agent-audit`.
- Whether agent exposes cross-service tools (compliance/branding/LLM) vs dashboard-only in MVP — tentative dashboard-only, revisit.

### Deferred to future milestone (v3.1+)
- **AGEN-01**: Manual "read aloud" button using browser SpeechSynthesis (opt-in TTS).
- **AGEN-02**: Agent proactively suggests actions based on org activity patterns.
- Multi-thread sidebar UI (`ConversationRepository.listForUser` already supports it; UI not built).
- Thread rename, archive, delete UX.
- Per-user daily token budget cap (distinct from AGENT-05 compaction — cap enforces cost control per user).
- Per-tool confirmation timeout / auto-deny TTL.
- Per-org locale for speech recognition beyond `navigator.language`.
- Per-org agent-system prompt override (permanently out of scope per REQUIREMENTS — prompt injection surface).
- Server-side Whisper transcription fallback (permanently out of scope per REQUIREMENTS).

### Roadmap hygiene (completed 2026-04-19)
- ✅ **ROADMAP.md**: Phase 31.1 "MCP Authorization Spec Upgrade (INSERTED)" added between Phase 31 and Phase 32 with full Goal / Depends on / Requirements / Success Criteria. Phase 32 section updated — MCPAUTH requirements removed, cross-cutting note replaced with Phase 31.1 dependency note, Depends-on extended to include Phase 31.1. Progress table updated.
- ✅ **REQUIREMENTS.md**: MCPAUTH-01/02/03 formalized as requirements under new "MCP Authorization Spec Compliance" heading. Traceability table rows added mapping all three to Phase 31.1. Coverage count updated 20 → 23.
- ✅ **STATE.md**: Roadmap Evolution section updated with the 2026-04-19 Phase 31.1 insertion entry explaining the scope relocation.

</deferred>

---

*Phase: 32-agent-service-chat-ui*
*Context gathered: 2026-04-18*

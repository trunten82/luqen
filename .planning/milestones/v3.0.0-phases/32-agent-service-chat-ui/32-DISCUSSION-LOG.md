# Phase 32: Agent Service + Chat UI — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 32-agent-service-chat-ui
**Areas discussed:** MCPAUTH scope, Chat UI placement & threading, Agent tool-calling loop, Confirmation dialog flow, Streaming + error surface

**Post-discussion note (2026-04-19):** The "Phase 32.0" label used throughout this log was the informal shorthand presented during the discussion. When the phase was formally inserted via `/gsd-insert-phase 31 "MCP Authorization Spec Upgrade"`, the CLI assigned it **Phase 31.1** per the `{after-phase}.{M}` decimal convention (same scheme as Phase 30.1). Every "Phase 32.0" reference below should be read as "Phase 31.1". The canonical phase number is **31.1**, recorded in ROADMAP.md, REQUIREMENTS.md, STATE.md, and 32-CONTEXT.md.

---

## Gray area selection

**Presented options (4 of the 6 initially identified — Speech UX + Streaming details deferred to Other):**
- MCPAUTH scope
- Chat UI placement & threading
- Agent tool-calling loop
- Confirmation dialog flow

**User selected:** all four. Streaming + error surface later re-opened via the Done-gate.

---

## MCPAUTH scope

### Q: Where should the MCPAUTH-01/02/03 upgrade (OAuth 2.1 + PKCE, refresh tokens, DCR, .well-known metadata) land?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 32.0 (insert) | Insert a new urgent phase before 32, land auth spec-compliance first, then Phase 32 builds agent on top. (Recommended) | ✓ |
| Bundle into Phase 32 | Ship auth + agent together as one phase. Risk: phase balloons. |  |
| Minimal subset in 32 | Ship only `.well-known` metadata + Authorization Code endpoint in 32; defer PKCE + DCR to Phase 33/34. |  |
| Defer entirely to v3.1 | Keep Phase 32 as scoped; agent uses existing bootstrap client-credentials for dashboard-side only. |  |

**User's choice:** Phase 32.0 (insert)

### Q: Internally, how does the dashboard chat UI authenticate to the MCP layer when the user sends a message?

| Option | Description | Selected |
|--------|-------------|----------|
| Cookie-session + server-side JWT mint | User hits `/agent/message` with dashboard session cookie; server mints a short-lived per-user RS256 JWT. (Recommended) | ✓ |
| Real per-user OAuth2 token | User goes through OAuth Authorization Code; token stored in session. Only makes sense if MCPAUTH lands in 32. |  |
| Reuse existing bootstrap client_credentials | Agent uses admin-registered OAuth client; breaks per-user RBAC. |  |

**User's choice:** Cookie-session + server-side JWT mint

**Notes:** Internal agent auth is now independent of Phase 32.0 outcome. Phase 32.0 affects only external MCP clients.

---

## Chat UI placement & threading

### Q: What's the UI anchor for the chat?

| Option | Description | Selected |
|--------|-------------|----------|
| Right-side drawer | Sticky right-side panel, collapsible. Backdrop on mobile. (Recommended) | ✓ |
| Floating bubble → expanded overlay | Bubble in bottom-right, clicks open to 400×600 overlay. |  |
| Dedicated /agent page | Full-page chat at /agent route; loses 'companion' feel. |  |
| Top-nav dropdown | Constrained width; bad for longer conversations. |  |

**User's choice:** Right-side drawer

### Q: How does the user open the agent?

| Option | Description | Selected |
|--------|-------------|----------|
| Floating button on every page | Bottom-right fixed button visible from every authenticated page. (Recommended) | ✓ |
| Top-nav icon only | Single icon in top nav. More discoverable, less ambient. |  |
| Opt-in per page | Available only on specific pages; loses most of the 'always available' promise. |  |

**User's choice:** Floating button on every page

### Q: Thread model for conversation history?

| Option | Description | Selected |
|--------|-------------|----------|
| Single rolling thread per user | One continuous conversation; rolling 20-turn window (Phase 31 already built this). (Recommended) | ✓ |
| Multi-thread with sidebar list | User starts new threads; sidebar sorted by last_message_at. |  |
| Single thread + 'New Conversation' button | One active thread, button resets it (archives old, starts fresh). |  |

**User's choice:** Single rolling thread per user

### Q: How does the panel state behave across navigation?

| Option | Description | Selected |
|--------|-------------|----------|
| Persist open/closed in localStorage | Drawer stays open as user navigates (HTMX partial swaps keep panel mounted). (Recommended) | ✓ |
| Reset on every navigation | Drawer starts closed on each page; feels disposable. |  |
| HTMX boosted persistence | Use hx-boost for app-shell refactor; scope creep for this phase. |  |

**User's choice:** Persist open/closed in localStorage

---

## Agent tool-calling loop

### Q: How does the agent decide which tool to call?

| Option | Description | Selected |
|--------|-------------|----------|
| Model-native function calling | Provider's tool-calling API directly (OpenAI `tools`, Ollama `tools` since 0.3.0). (Recommended) | ✓ |
| JSON-schema-forced output | Force LLM output to strict JSON schema; parse server-side. More brittle. |  |
| System-prompt + regex parse | Tell LLM to emit `<tool>name(args)</tool>`; weakest guarantees. |  |

**User's choice:** Model-native function calling

### Q: Where does the tool-loop run inside the LLM stack — dashboard or @luqen/llm service?

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard AgentService owns the loop | AgentService runs the while-loop, dispatches tools via local MCP. (Recommended) | ✓ |
| New 'agent-conversation' capability in @luqen/llm | LLM service runs the loop internally, calls back into dashboard MCP. Adds cross-service round-trips. |  |
| Hybrid: capability for completion, dashboard for loop | Dashboard orchestrates loop; llm service exposes thin `/chat-completion` capability. (Recommended fallback) |  |

**User's choice:** Dashboard AgentService owns the loop

**Notes:** Final resolution in CONTEXT.md is effectively the hybrid — AgentService (dashboard) runs the loop; each completion call routes through a NEW `agent-conversation` capability in `@luqen/llm` to satisfy AGENT-02 (capability engine handles provider fallback + per-org overrides).

### Q: Iteration cap per user turn?

| Option | Description | Selected |
|--------|-------------|----------|
| Max 5 tool calls | Covers chained patterns without runaway loops. (Recommended) | ✓ |
| Max 3 tool calls | Tighter; may force multi-turn flows. |  |
| Unbounded with 30s wall-clock timeout | No iteration cap, only time budget. |  |

**User's choice:** Max 5 tool calls

### Q: Agent system prompt — where does it live and how is it configured?

| Option | Description | Selected |
|--------|-------------|----------|
| Stored in dashboard DB as new 'agent-system' prompt | Editable via /admin/llm?tab=prompts; global only (REQUIREMENTS Out of Scope). (Recommended) | ✓ |
| Hardcoded in AgentService source | Simplest; any change needs code deploy. |  |
| Hardcoded prompt + configurable agent name only | System prompt source-level, agent display name is per-org setting. |  |

**User's choice:** Stored in dashboard DB as new 'agent-system' prompt

**Notes:** CONTEXT.md refinement: the prompt lives in the *LLM service's* prompt-management system (same table as existing capability prompts), accessible via the dashboard's `/admin/llm?tab=prompts` UI. Not literally in the dashboard DB. This preserves AGENT-02's "capability engine handles per-org overrides" behavior.

---

## Confirmation dialog flow

### Q: Which tools trigger the confirmation dialog?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-tool destructiveHint metadata | Honor MCP `destructiveHint: true` annotation (matches MCP spec + Phase 30.1 verification). (Recommended) | ✓ |
| All tools that mutate (HTTP verb heuristic) | Auto-derive from tool name prefix. Less controllable per-tool. |  |
| Explicit allowlist in AgentService | Maintain list of tool names that need confirmation. Drifts from MCP metadata. |  |

**User's choice:** Per-tool destructiveHint metadata

### Q: Dialog implementation pattern?

| Option | Description | Selected |
|--------|-------------|----------|
| Native <dialog> + showModal() | Matches rescore-confirm + drilldown-modal. Accessible by default. (Recommended) | ✓ |
| HTMX hx-get to modal partial | Server renders the args summary; benefit only if args need i18n. |  |
| Full-page confirmation step | Inline 'Approve / Deny' card in the thread; loses 'stop and think' effect. |  |

**User's choice:** Native <dialog> + showModal()

### Q: pending_confirmation behavior on page refresh or reopen?

| Option | Description | Selected |
|--------|-------------|----------|
| Re-open dialog automatically | On panel mount, if latest message has status='pending_confirmation', showModal() immediately. Satisfies SC#4. (Recommended) | ✓ |
| Show inline card with Approve/Deny buttons | Don't pop modal on reload; show pending tool call as interactive card. |  |
| Auto-deny after 5 minute TTL | If pending > 5 min, mark denied and show inactivity message. |  |

**User's choice:** Re-open dialog automatically

### Q: How are tool args shown in the confirmation dialog?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-tool friendly template + raw JSON expander | Per-tool template + collapsible <details> with raw JSON. (Recommended) | ✓ |
| Raw JSON only | Pretty-print args JSON; least approachable for non-technical users. |  |
| Tool description + action verb only | Dialog shows tool description only, no args detail. |  |

**User's choice:** Per-tool friendly template + raw JSON expander

---

## Done-gate (first pass)

### Q: We've locked the four areas. Anything remaining before I write CONTEXT.md?

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Write 32-CONTEXT.md with captured decisions; defer speech + streaming edge-cases to Claude's discretion. (Recommended) |  |
| Discuss speech UX | Web Speech API placement, language handling, EU data residency. |  |
| Discuss streaming + error surface | How SSE flows end-to-end, how UI recovers from LLM unavailable / tool timeout / rate-limit mid-stream. | ✓ |
| Revisit an earlier area | Go back and refine one of the four locked areas. |  |

**User's choice:** Discuss streaming + error surface

---

## Streaming + error surface

### Q: End-to-end streaming path for the assistant response?

| Option | Description | Selected |
|--------|-------------|----------|
| Token-level SSE end-to-end | LLM capability returns ReadableStream; AgentService forwards tokens over SSE. (Recommended) | (reframed) |
| Sentence/chunk buffering | AgentService emits completed response in chunks to simulate streaming. |  |
| No streaming — single POST | Full response, HTMX swap. |  |

**User's first response:** Freeform — "Token level is supported also by anthropic?"

**Claude's answer:** Yes — Anthropic Messages API supports token-level streaming via SSE (`content_block_delta` events). Current code gap flagged: `packages/llm/src/providers/ollama.ts:43` hardcodes `stream: false`, and no Anthropic adapter exists at `packages/llm/src/providers/`.

**Question re-framed:**

| Option | Description | Selected |
|--------|-------------|----------|
| Token-level SSE end-to-end (add streaming to adapters) | Add `stream: true` code path to ollama.ts and openai.ts; extra work but satisfies SC#1 cleanly. (Recommended) | ✓ |
| Sentence/chunk buffering (no adapter change) | Keep adapters at stream=false; fake streaming at AgentService. |  |
| Token streaming now, tool_calls at end | Text streams token-level; tool_calls buffered until complete. |  |

**User's choice:** Token-level SSE end-to-end (add streaming to adapters)

### Q: Should we add an Anthropic provider adapter as part of Phase 32?

| Option | Description | Selected |
|--------|-------------|----------|
| No — defer, out of scope | Keep Phase 32 focused; Anthropic adapter is a separate phase. (Recommended) |  |
| Yes — add during Phase 32 | Claude is arguably the best tool-calling model; valuable to have as a provider. | ✓ |
| Add a backlog entry only | Capture as deferred idea, decide in future milestone. |  |

**User's choice:** Yes — add during Phase 32

**Notes:** This adds real scope: new Anthropic adapter + model registry entries + capability assignment UI work on top of the streaming changes already agreed.

### Q: Mid-stream error behavior (LLM goes unavailable during a response)?

| Option | Description | Selected |
|--------|-------------|----------|
| Capability engine retries, then stream error message | Engine fallback chain first; if all fail, final SSE `error` frame + red inline card with Retry. (Recommended) | ✓ |
| Silent fallback only, no user-visible error | Generic 'Something went wrong' toast. |  |
| Abort + mark message failed in DB | Mark `status='failed'`, close SSE with error frame. |  |

**User's choice:** Capability engine retries, then stream error message

**Notes:** Chosen option + status='failed' DB write together form the final behavior in CONTEXT.md D-23 — they're complementary, not mutually exclusive.

### Q: Tool-call timeout and the audit trail?

| Option | Description | Selected |
|--------|-------------|----------|
| 30s default per tool + mark audit outcome='timeout' | Wall-clock timeout; AuditRepository.append with outcome='timeout'. (Recommended) | ✓ |
| Per-tool timeout via MCP metadata | Each tool metadata declares its own timeout; defer unless a specific slow tool forces it. |  |
| No tool timeout | Let MCP transport handle it. Risk of hung pending_confirmation. |  |

**User's choice:** 30s default per tool + mark audit outcome='timeout'

### Q: Rate-limit / 429 handling on the agent endpoint?

| Option | Description | Selected |
|--------|-------------|----------|
| Capability engine 429 → fallback + @fastify/rate-limit onSend hook on /agent/* | Provider-level 429 via capability engine; add @fastify/rate-limit on /agent/* with onSend JSON response. (Recommended) | ✓ |
| Provider fallback only, no endpoint limit | Rely purely on capability engine; no defense against client loops. |  |
| Per-user daily token budget cap | Likely Phase 33 concern; defer. |  |

**User's choice:** Capability engine 429 → fallback + @fastify/rate-limit onSend hook on /agent/*

---

## Sequencing (scope-risk check)

### Q: Phase 32 is now: agent loop + chat UI + confirmation + speech + streaming-in-adapters + Anthropic adapter. That's a large phase. How should we sequence?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as one phase, multiple plans | Ships as 4-5 parallelizable plans under one phase. (Recommended) | ✓ |
| Split Anthropic into 32.1 | Ship streaming-in-existing-adapters + agent in Phase 32; Phase 32.1 adds Anthropic. |  |
| Defer Anthropic to v3.1 backlog | Reverse the earlier answer; Anthropic becomes deferred. |  |
| Split streaming adapters into 32.0 prerequisites | 32.0 absorbs streaming + Anthropic alongside MCPAUTH work. |  |

**User's choice:** Keep as one phase, multiple plans

---

## Claude's Discretion

- Exact microphone UI (tap-to-start vs hold-to-talk) — pick a sensible default during planning
- Speech language selection beyond navigator.language default
- SSE frame naming conventions
- In-process MCP handler invocation vs HTTP `POST /mcp` for AgentService tool dispatch
- Chat drawer theming details (use existing style.css classes)
- Whether `agent-system` prompt uses the full locked-section editor or a thinner variant
- Typing indicators vs blinking cursor during streaming
- Stop-button / abort mid-stream behavior details
- Confirmation dialog server-side vs client-side rendering path

## Deferred Ideas

(See CONTEXT.md `<deferred>` for full list grouped by target phase/milestone.)

Key deferrals:
- MCPAUTH-01/02/03 → Phase 32.0 (to be inserted before Phase 32 ships)
- AGENT-04, AGENT-05, APER-04, cross-service tool exposure → Phase 33
- Multi-thread UI, TTS, per-user token caps, auto-deny TTL → v3.1+
- ROADMAP.md needs `/gsd-insert-phase 32.0` before planning Phase 32

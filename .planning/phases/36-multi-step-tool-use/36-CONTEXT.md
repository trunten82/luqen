# Phase 36: Multi-Step Tool Use - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 36 (interactive)

<domain>
## Phase Boundary

The agent plans across multiple tool calls per user turn — in parallel where possible, with automatic recovery from tool errors and a transparent audit trail. Builds on the existing `MAX_TOOL_ITERATIONS=5` loop in `agent-service.ts` and the in-process `tool-dispatch.ts` from Phase 32. Persistence model from Phase 35 (conversation/message rows + audit log) is the system of record for tool calls and rationale.

Requirements: **ATOOL-01..ATOOL-04**.

In-scope:
- Parallel dispatch of multiple `tool_use` blocks within one iteration
- Automatic error recovery with a per-turn retry budget
- Multi-step chaining across iterations within a single user turn (existing 5-iter cap)
- Tool selection rationale logged to the audit log and surfaced in `/admin/audit`
- Streaming UX showing per-tool progress

Out of scope (deferred):
- Cross-turn memory of tool outcomes (that's planning-level state)
- Tool prioritization heuristics
- Admin-configurable iteration cap (kept hardcoded at 5)
</domain>

<decisions>
## Implementation Decisions

### Parallel dispatch
- **Concurrency model:** Unbounded `Promise.all` — all `tool_use` blocks in a batch dispatch simultaneously. Existing per-tool timeout in `tool-dispatch.ts` (TIMEOUT_SENTINEL) already bounds runtime per call.
- **Result aggregation:** Results return to the model in original `tool_use` order, not completion order — preserves model's expected input shape.

### Destructive-tool gating in parallel batches
- **Block the entire batch** when any tool in the batch carries `destructiveHint: true`. No tools dispatch until user confirms. Preserves predictable UX and audit trail (no partial-result states).
- Re-uses existing destructive-hint pause flow; extended to recognize batches.

### Error retry budget
- **Shared budget of 3 retries per turn**, pooled across all tools (not per-tool). Counts within `MAX_TOOL_ITERATIONS=5`.
- On failure, surface the error + retry guidance string to the model as the tool result, then let the next iteration decide whether to retry, swap tools, or give up.
- When the shared budget is exhausted, subsequent tool failures are surfaced to the model without retry guidance.

### Rationale capture
- **Source:** Adjacent assistant text + thinking blocks emitted alongside the `tool_use` call.
  - Anthropic: capture `thinking` blocks + any `text` block preceding the `tool_use` in the same assistant message.
  - OpenAI: capture `content` text on the assistant message that also carries `tool_calls`.
  - Ollama: capture pre-tool `content` text (provider may emit empty string — store as null).
- **Storage:** New `rationale TEXT` column on the agent audit log row for each tool dispatch (or extend existing audit row schema). Normalized across providers.
- **No double-call:** Do NOT make a separate "summarize the rationale" model call.

### MAX_TOOL_ITERATIONS cap
- **Keep at 5** — existing constant in `agent-service.ts:59` unchanged. A single iteration can dispatch many tools in parallel, so the practical tool budget is 20+ per turn.
- Cap is hardcoded; not exposed as admin/env config in this phase.

### Cap-hit UX
- Existing forced-final-answer flow continues (audit row with `toolName='__loop__'`, `outcome='error'`, `outcomeDetail='iteration_cap'` already emitted).
- **Add a small chip** above the final assistant message: "Reached tool limit — producing answer with what we have" (i18n key, drawer-styled). Plain text, no action.

### Streaming UX during parallel dispatch
- **Per-tool status chips** rendered above the streaming assistant turn:
  - One chip per dispatched tool: tool name + spinner.
  - On completion, chip transitions to checkmark + tool name (success) or error icon + tool name (failure).
  - Chips remain visible after the turn settles (collapsed or summarized).
- SSE frames extended to emit per-tool `tool_started` / `tool_completed` events; client wires them into the chip strip.

### Audit UX (`/admin/audit`)
- **Inline truncated + expandable rationale.** Row shows first line of rationale (truncated at ~80 chars); click row → expands full rationale + outcome detail in-place.
- Existing tool filter (already present per Phase 32) extended to filter by tool **and** by outcome (success / error / iteration_cap).
- No new dedicated rationale column — keeps the table scannable.

### Claude's Discretion
The following are not pinned by user decisions; downstream agents (researcher, planner) choose the best approach:
- Exact SSE frame names/payloads for `tool_started`/`tool_completed`
- Retry guidance string wording (e.g., "The {tool} call failed with {error}. You may retry with different arguments or proceed.")
- Whether to thread retry-budget remaining count into the model's tool result, or only state "retry available"
- Audit migration ID (use the next-available migration number after 056)
- Test layout: per-feature integration tests vs end-to-end agent-loop tests
- Whether per-tool chip strip is its own partial or inlined into existing agent message rendering
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing agent loop + tool dispatch
- `packages/dashboard/src/agent/agent-service.ts` — Main agent loop, `MAX_TOOL_ITERATIONS`, destructive-hint pause, audit emission, SSE frame emission.
- `packages/dashboard/src/agent/tool-dispatch.ts` — In-process tool dispatcher, manifest lookup, zod validation, timeout sentinel.
- `packages/dashboard/src/agent/sse-frames.ts` — SSE frame definitions for streaming.

### Persistence (Phase 35)
- `packages/dashboard/src/db/sqlite/migrations.ts` — Migration 056 baseline; new audit columns will append after.
- `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` — Conversation/message persistence (no schema changes expected for ATOOL).

### Audit log
- `packages/dashboard/src/routes/admin/audit.ts` (or equivalent existing audit list route) — `/admin/audit` table with tool filter.
- Existing `agent_audit` table (added pre-Phase 35) — extend with `rationale` column.

### Test patterns
- `packages/dashboard/tests/agent/agent-service.test.ts` — Existing agent-loop test patterns; mirror for parallel dispatch + retry tests.
- `packages/dashboard/tests/agent/agent-service-title-hook.test.ts` (Phase 35-03) — Pattern for fire-and-forget hook tests.

### CSP + frontend rules
- `CLAUDE.md` (project root) — CSP-strict, no inline scripts, BEM, i18n via `{{t}}` keys.
- `packages/dashboard/src/static/agent.js` — Where chip strip wiring lands.
- `packages/dashboard/src/static/style.css` — Where chip BEM block lands.
</canonical_refs>

<specifics>
## Specific Ideas

- Anthropic SDK already exposes `thinking` blocks and tool_use inline within a single assistant message — capture in same array iteration.
- OpenAI: `assistant.content` (string) coexists with `assistant.tool_calls`; the content IS the rationale.
- Ollama: provider behavior varies by model; some emit pre-tool text, others go directly to tool_call. Treat empty rationale as null, not error.
- Anthropic Desktop and Cursor both render per-tool chips during parallel dispatch — that's the visual reference for our chip strip.
</specifics>

<deferred>
## Deferred Ideas

- Admin-configurable `MAX_TOOL_ITERATIONS` (env var or admin setting) — would require operational tooling + UI; revisit if real users hit the 5-iter cap repeatedly.
- Per-tool prioritization or scheduling (e.g., always run "read" tools before "write") — out of scope for ATOOL.
- Cross-turn rationale aggregation / "what did the agent decide last time" panel — surfaced in admin audit but not in user-facing drawer this phase.
- Rationale summarization (post-hoc model call to compress rationale) — quality vs cost tradeoff; revisit only if rationale text becomes unwieldy in audit UX.
- Retry-with-modified-args automation (system rewrites tool args before retry) — too magical; let the model decide.
</deferred>

---

*Phase: 36-multi-step-tool-use*
*Context gathered: 2026-04-25 via /gsd-discuss-phase*

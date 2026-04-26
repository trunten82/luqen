# Phase 33: Agent Intelligence + Audit Viewer - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning
**Source:** Direct authoring (no discuss-phase — autonomous execution)

<domain>
## Phase Boundary

This phase delivers three independent capabilities on top of the live agent stack from Phase 32 + 32.1:

1. **Context-aware agent (AGENT-04)** — Agent responses reference the user's recent scans, active brand guidelines, and applicable regulations without requiring the user to paste URLs or IDs. Data is injected into the system prompt at runTurn time, scoped per user+org (or cross-org for admin.system).

2. **Token-budget + compaction (AGENT-05)** — AgentService tracks cumulative tokens across a conversation. When the estimated token count exceeds 85% of the model's limit, the oldest turns are summarised into a single assistant "system-summary" message, preserving the tail of the window verbatim.

3. **Audit log viewer (APER-04)** — Admins can navigate to `/admin/audit` and browse all `agent_audit_log` rows with filters (date range, actor user, tool name, outcome). Org-scoped for org admins, global for dashboard admins.

</domain>

<decisions>
## Implementation Decisions

### AGENT-04 — Context-aware agent
- Inject a `ContextHints` block into the SYSTEM prompt on each `runTurn`, appended AFTER the locked fences and free tone paragraph.
- Fields sourced per turn from storage:
  - `recentScans`: last 5 scans (scanId, siteUrl, status, totalIssues, detectedAt).
  - `activeBrands`: brand guidelines with `status === 'active'` for the user's org (id, name, lastScored).
  - `applicableRegulations`: regulations tagged for the user's org's jurisdiction(s) (id, shortName).
- For global admins (synthetic `__admin__:{userId}` orgId) the context read is cross-org — use the same "admin.system → unwrap" pattern mcp-bridge established in Plan 32.1-02.
- Trim each list to a fixed cap (5 / 10 / 10) to keep the prompt under 2 KB — each entry formatted one-per-line as `- [id] siteUrl — {detail}`.
- If any fetch fails, degrade gracefully (empty list, no error to the model).

### AGENT-05 — Token budget + compaction
- Estimate tokens via a simple char/4 heuristic (accurate enough for the 85% threshold). No tokenizer dependency.
- Compaction triggers when `estimatedPromptTokens > 0.85 × modelMaxTokens`. `modelMaxTokens` defaults to 8192 (Ollama), override per-provider in adapter config if available — otherwise fall back to 8192.
- When triggered:
  1. Keep the last N turns verbatim where N = `MIN_KEEP_TURNS` (default 6, where a "turn" = one user message + any following assistant/tool rows).
  2. Summarise the older prefix via a synthetic LLM call with a `summariseConversation` prompt — returns one assistant message `[summary] …`.
  3. Persist the summary as a new `role='assistant'` row with `status='sent'` AND flip the older rows' `in_window = 0` so the rolling-window math already in Phase 31 handles the window shape correctly.
- Summarisation runs as a capability invocation against the same `agent-conversation` assignment (no new capability registration required — reuse the model configured for the conversation).
- Feature-gated via config `workflow.agent_compaction` (default `true`) for safety rollback.

### APER-04 — Audit viewer
- New route: `GET /admin/audit` rendering `admin/agent-audit.hbs`.
- Permission gate: `admin.system` (dashboard admin) OR `admin.org` (org admin, scoped to the admin's currentOrgId).
- Filters (query-string):
  - `from=YYYY-MM-DD` — lowerbound on `createdAt`.
  - `to=YYYY-MM-DD` — upperbound (exclusive next day).
  - `userId=…` — filter by actor user id.
  - `toolName=…` — filter by tool name.
  - `outcome=success|error|timeout|denied` — filter by outcome.
- Pagination: 50 rows per page, `offset` query param. Keyset pagination by `createdAt DESC, id DESC`.
- View columns: timestamp, user (username), tool name, outcome badge, latency (ms), args preview (first 120 chars of argsJson), outcomeDetail.
- CSV export: `GET /admin/audit.csv` returns the same filtered set as a downloadable CSV.
- Org admin cross-org attempt → 403 (re-use the 403 pattern from `/admin/organizations/:id/settings`).

### Cross-cutting
- All three plans follow the TDD pattern (test file first, implementation second, verification last).
- No new DB migrations — all three plans read from existing tables (`scan_records`, `brand_guidelines`, `regulations`, `agent_audit_log`).
- No breaking changes to existing Phase 32 tests — the ContextHints block is additive; token-budget is a no-op when under threshold; audit viewer is a new route.

### Claude's Discretion
- Exact wording of the ContextHints prompt section.
- Exact CSS for the audit viewer page (reuse existing `.data-table` conventions).
- Whether to memo-cache recent-scans per (userId, orgId) for the duration of a runTurn (can add if a profiler shows the fetch is hot, out of scope otherwise).
- Exact summarisation prompt — use a short `Summarise the key facts, open questions, and pending tool outputs from this conversation so a new assistant can continue without loss.` directive.

</decisions>

<canonical_refs>
## Canonical References

Downstream agents MUST read these before planning or implementing.

### Phase 32 integration points
- `packages/dashboard/src/agent/agent-service.ts` — `runTurn` is where ContextHints injection happens; `windowToChatMessages` is where compaction intersects.
- `packages/dashboard/src/agent/mcp-bridge.ts` — the admin.system unwrap pattern (orgId=`__admin__:…` → '' + admin permissions) is the reference for AGENT-04's global-admin branch.
- `packages/llm/src/prompts/agent-system.ts` — the locked-fences system prompt that the ContextHints block appends to.

### Phase 31 persistence
- `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` — `getWindow`, `appendMessage`, `in_window` flag.
- `packages/dashboard/src/db/sqlite/repositories/agent-audit-repository.ts` — `listForOrg`, `append` — extend with filter support.

### Existing admin route patterns to mirror
- `packages/dashboard/src/routes/admin/change-history.ts` — similar filter/pagination admin page over an append-only log.
- `packages/dashboard/src/routes/admin/organizations.ts` — the cross-org 403 pattern.

</canonical_refs>

<specifics>
## Specific Ideas

- Test a turn against a seeded conversation where the oldest turn is 90%+ of the budget — confirm the summary row lands, `in_window=0` flips, and the next LLM call sees summary + recent tail only.
- Audit viewer must show at least 500 rows without pagination blocking the UI (smooth scroll, ~2 s render).
- For AGENT-04, hardcode the ContextHints block into `buildAgentSystemPrompt(hints?)` so the Phase 32 tests that don't pass hints continue to pass.

</specifics>

<deferred>
## Deferred Ideas

- Full audit log export to S3 / external SIEM (future phase, driven by APER-05 if added).
- Token-accurate tokenizer (tiktoken) instead of char/4 estimate — only if the 85% threshold proves too loose or too tight in practice.
- Admin ability to replay a past conversation from the audit viewer.
- User-facing "conversation history" page that lists prior conversations.

</deferred>

---

*Phase: 33-agent-intelligence-audit-viewer*
*Context gathered: 2026-04-24 via direct authoring (autonomous execution)*

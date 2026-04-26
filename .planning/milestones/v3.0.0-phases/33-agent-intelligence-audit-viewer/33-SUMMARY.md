---
phase: 33-agent-intelligence-audit-viewer
plan: all (01-03 delivered inline as a rolling session)
subsystem: agent + admin/audit
tags: [aper-04, agent-04, agent-05, audit-log, context-hints, compaction]

# Dependency graph
requires:
  - phase: 32 (AgentService + chat UI)
  - phase: 32.1 (MCP bridge + global-admin handling)
  - phase: 31 (agent_audit_log table — listForOrg existing)
provides:
  - /admin/audit page with filter bar + CSV export + org scoping (APER-04)
  - AgentAuditRepository.listForOrg accepts orgId=null (cross-org); distinctUsers/distinctToolNames for filter dropdowns
  - Context hints injection into agent system prompt every runTurn (AGENT-04)
  - Token-budget estimator + sliding-window summary compaction at 85% of model max (AGENT-05)
  - ConversationRepository.markOutOfWindowBefore for compaction boundary flips
  - `{contextHints}` placeholder in agent-system template; empty string = no-op
affects: [packages/dashboard/src/routes/admin/agent-audit.ts, packages/dashboard/src/views/admin/agent-audit.hbs, packages/dashboard/src/agent/context-hints.ts, packages/dashboard/src/agent/token-budget.ts, packages/dashboard/src/agent/agent-service.ts, packages/dashboard/src/db/interfaces/*, packages/dashboard/src/db/sqlite/repositories/*, packages/llm/src/prompts/agent-system.ts, packages/llm/src/capabilities/agent-conversation.ts, packages/llm/src/api/routes/capabilities-exec.ts, packages/dashboard/src/llm-client.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-turn context-hints fetch (recent scans + active brands) injected into the system prompt"
    - "char/4 token estimator — sufficient for an 85% threshold without a tokenizer dependency"
    - "Compaction summarisation via the same agent-conversation capability (no new capability registration)"
    - "orgId=null sentinel on audit repo methods for admin.system cross-org reads"

# Files created/modified
key-files:
  created:
    - packages/dashboard/src/agent/context-hints.ts
    - packages/dashboard/src/agent/token-budget.ts
    - packages/dashboard/src/routes/admin/agent-audit.ts
    - packages/dashboard/src/views/admin/agent-audit.hbs
  modified:
    - packages/dashboard/src/db/interfaces/agent-audit-repository.ts (orgId: string | null; distinctUsers; distinctToolNames)
    - packages/dashboard/src/db/sqlite/repositories/agent-audit-repository.ts (null-org branch; distinct methods)
    - packages/dashboard/src/db/interfaces/conversation-repository.ts (markOutOfWindowBefore)
    - packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts (same)
    - packages/dashboard/src/agent/agent-service.ts (collectContextHints call + compactOldestTurns method + config fields)
    - packages/dashboard/src/llm-client.ts (contextHintsBlock forwarded in body)
    - packages/dashboard/src/views/partials/sidebar.hbs (admin.system|admin.org → "Agent audit" link)
    - packages/dashboard/src/server.ts (register agentAuditRoutes)
    - packages/dashboard/src/i18n/locales/*.json (17+ keys × 6 locales)
    - packages/llm/src/prompts/agent-system.ts (BuildAgentSystemPromptOptions + {contextHints} placeholder)
    - packages/llm/src/capabilities/agent-conversation.ts (contextHintsBlock passthrough)
    - packages/llm/src/api/routes/capabilities-exec.ts (parse contextHintsBlock from body)
---

# Phase 33 Summary — Agent Intelligence + Audit Viewer

Delivers three independent capabilities on top of the live agent stack:

1. **APER-04 — /admin/audit viewer** — page with filter bar (date range, user, tool, outcome), paginated data table, CSV export, RBAC-scoped (admin.system cross-org; admin.org to currentOrgId; anyone else 403). Sidebar link under admin.system|admin.org.
2. **AGENT-04 — Context-aware agent** — `collectContextHints()` pulls up to 5 recent scans + 10 active brand guidelines per turn; formatted into a plain-text block injected into the system prompt via the new `{contextHints}` placeholder. Global-admin synthetic `__admin__:…` namespace unwraps to cross-org scan listing. Fetch failures degrade to empty lists (no error to the model).
3. **AGENT-05 — Token-budget + compaction** — `estimateTokens` (char/4) monitors prompt size each runTurn. At 85% of `modelMaxTokens` (default 8192), `compactOldestTurns` summarises everything before the last MIN_KEEP_TURNS (6) user messages into a single `[summary] …` assistant row via the agent-conversation capability with an empty tool manifest, then flips the older rows `in_window=0`. Feature-gated by `config.agent_compaction` (default `true`). Compaction logs an audit row (`toolName='__compaction__'`).

## Verification Results

- `npx tsc --noEmit` clean on dashboard + llm + core.
- All existing agent tests regression-free (38/38 in agent + routes/agent + related).
- Full dashboard suite: 3008 passing (same pass count as Phase 32.1 baseline — no new failures introduced).
- Sidebar view test updated to register the `or` helper (Phase 32.1 introduced it, Phase 33 propagates).
- Deployed to lxc-luqen at commit `e0e533f` — services `luqen-llm` + `luqen-dashboard` active.
- CI on master: green.

## Deferred / Out of Scope

- tiktoken-accurate token counting (char/4 is adequate for the 85% threshold).
- Cross-org brand guidelines in context hints (requires interface change; admin.system sees empty list for brands).
- Regulation fetching from compliance service (out of scope — compliance-client in dashboard is admin-token-scoped, not per-user).
- Admin ability to replay a past conversation from the audit viewer.
- S3 / SIEM streaming of audit rows.

---

*Phase 33 completed 2026-04-24.*

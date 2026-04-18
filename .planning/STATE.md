---
gsd_state_version: 1.0
milestone: v3.0.0
milestone_name: MCP Servers & Agent Companion
status: executing
stopped_at: Phase 30 walkthrough complete — scope-filter gap discovered, Phase 30.1 inserted
last_updated: "2026-04-18T16:00:00.000Z"
last_activity: 2026-04-18 -- Phase 30 external-client walkthrough: Checks 1,2,3,4,6 ✓; 5a/5b deferred to Phase 30.1 (INSERTED)
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 13
  completed_plans: 6
  percent: 46
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Phase 30 — dashboard-mcp-external-clients

## Current Position

```
[Phase 28] [Phase 29] [Phase 30] [Phase 31] [Phase 32] [Phase 33]
    ^
    |
  Next
```

Phase: 30 (dashboard-mcp-external-clients) — WALKTHROUGH DONE (SC#4 deferred to 30.1)
Plan: Phase 30.1 planned (1 plan, 5 tasks, verified 0 blockers / 3 warnings) — ready for `/gsd-execute-phase 30.1`
Status: Phase 30.1 plan ready; quick task 260418-mqc (locked-prompt CSS fix) completed
Last activity: 2026-04-18 -- Completed quick task 260418-mqc: white-on-white text on locked prompt segments; earlier this session planned Phase 30.1 (scope-filter gap fix) and completed Phase 30 walkthrough Checks 1-4 and 6.

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 6 |
| Requirements mapped | 20/20 |
| Coverage | 100% |
| Plans complete | 0/? |
| Phase 28-mcp-foundation P01 | 7min | 2 tasks | 11 files |
| Phase 29 P03 | 3min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Carried from v2.12.0:

- Scoring lives in dashboard, not `@luqen/branding` — single pure calculator
- Composite weights locked at `{color: 0.50, typography: 0.30, components: 0.20}`
- Dual-mode fallback policy: service outage → degraded scan, NEVER silent cross-route
- `BrandingOrchestrator` reads `orgs.branding_mode` per-request, no caching
- Zero branded contrast violations = 100% color score (post-deploy hotfix)

v3.0.0 architecture decisions (from research):

- MCP embedded as Fastify plugin in each service (`fastify-mcp@^2.1.0`) — not a standalone port
- Streamable HTTP transport only — SSE-only deprecated June 2025
- AgentService always calls service `/mcp` endpoints over HTTP — never direct module imports
- All LLM calls route through existing capability engine at `llm:4200` — no separate provider client
- Conversation history: SQLite in `dashboard.db` — no Redis, no new infrastructure
- Rolling window: last 20 turns in LLM context; full history stored in DB
- `pending_confirmation` status in DB — confirmation state survives page refresh
- Agent UI: HTMX POST for message submission + plain JS `EventSource` for streaming — never `hx-sse`
- Speech input: Web Speech API with feature detection; text fallback for Firefox
- RBAC tool list built from `resolveEffectivePermissions(userId, orgId)` before LLM sees any tools
- [Phase 28-mcp-foundation]: Inline scope hierarchy in http-plugin.ts rather than importing from @luqen/compliance — keeps @luqen/core leaf-of-graph and dep-free
- [Phase 28-mcp-foundation]: AsyncLocalStorage<ToolContext> — module-scope ALS lets setRequestHandler (registered once) read per-request context without SDK argument plumbing
- [Phase 28-mcp-foundation]: tools/list filter via mcpServer.server.setRequestHandler(ListToolsRequestSchema, ...) — single committed mechanism registered ONCE at plugin construction; overwrites SDK default in protocol's _requestHandlers map
- [Phase 28-mcp-foundation]: McpServer._registeredTools private-field read preserves per-tool description/inputSchema in filtered tools/list response; fallback registeredTools option documented but not needed at SDK 1.27.1
- [Phase 29]: Phase 29 rescope (D-14/D-15): MCPT-01, MCPT-02 brand-score half, MCPI-05, MCPI-06 reassigned to Phase 30; MCPT-02 split-annotated; Phase 30 Depends-on upgraded to Phase 28+29; D-12 chat-message-template prompt shape locked into Phase 30 success criterion

### Architecture Notes

New packages required:

- `@modelcontextprotocol/sdk@^1.29.0` — MCP server + client runtime
- `fastify-mcp@^2.1.0` — Streamable HTTP transport + session management

New DB tables (dashboard.db):

- Migration 046: `agent_conversations` + `agent_messages` (rolling window, `pending_confirmation` status)
- Migration 047: `agent_audit_log` (user, org, tool, args, outcome, latency)

Existing MCP servers to upgrade (HTTP transport):

- `packages/compliance/src/mcp/server.ts` — stdio → add Streamable HTTP
- `packages/core/src/mcp.ts` — stdio → add Streamable HTTP
- `packages/monitor/src/mcp/server.ts` — stdio → add Streamable HTTP

New MCP servers:

- Branding service — `POST /api/v1/mcp`
- LLM service — `POST /api/v1/mcp`
- Dashboard — `POST /mcp` (external client access)

### Roadmap Evolution

- Phase 30.1 inserted after Phase 30 on 2026-04-18: Fix scope-filter bypass for OAuth client-credentials tokens — permission fallback on unknown sub currently overrides scope path, letting read-scope clients invoke destructive tools (URGENT — blocks Phase 30 SC#4 sign-off)

### Pending Todos

None.

### Blockers/Concerns

- `fastify-mcp` maintenance status flagged MEDIUM confidence — validate plugin is actively maintained during Phase 28 planning; fallback is `NodeStreamableHTTPServerTransport` from SDK directly
- `agent-conversation` capability registration in LLM engine — inspect `packages/llm/src/capabilities/` during Phase 32 planning
- Token counting approach — confirm character-count approximation vs `tiktoken` during Phase 33 planning
- Web Speech API EU data residency — confirm whether org users have constraints before Phase 32; if so, defer speech to post-MVP

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260418-lg8 | Strip jsonReport from dashboard_list_reports MCP tool response | 2026-04-18 | 910a3de | [260418-lg8-strip-jsonreport-from-dashboard-list-rep](./quick/260418-lg8-strip-jsonreport-from-dashboard-list-rep/) |
| 260418-mqc | Fix white-on-white text in locked prompt segments on /admin/llm?tab=prompts | 2026-04-18 | _pending_ | [260418-mqc-fix-white-on-white-text-in-locked-prompt](./quick/260418-mqc-fix-white-on-white-text-in-locked-prompt/) |

### Known Gotchas (carried from v2.12.0)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **HTMX 2.0 `hx-select` inheritance**: use plain JS `EventSource` for streaming, never `hx-sse`
- **`@fastify/rate-limit` 429 bypass**: add `onSend` hook on agent SSE path
- **Small scans score lower**: maxPages=3 may score 0 when full-site scores 2+
- **Branding service port**: lxc-luqen runs on port 4100 (not 4300)
- **`issue.context` can be null**: all scorers must null-guard

## Session Continuity

Last session: 2026-04-17T12:55:22.054Z
Stopped at: Phase 30 context gathered
Resume file: .planning/phases/30-dashboard-mcp-external-clients/30-CONTEXT.md
Next action: `/gsd:plan-phase 28`

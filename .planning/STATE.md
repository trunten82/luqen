---
gsd_state_version: 1.0
milestone: v3.0.0
milestone_name: MCP Servers & Agent Companion
status: executing
stopped_at: Completed 28-01-PLAN.md
last_updated: "2026-04-17T08:09:47.465Z"
last_activity: 2026-04-17
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 3
  completed_plans: 1
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Phase 28 — mcp-foundation

## Current Position

```
[Phase 28] [Phase 29] [Phase 30] [Phase 31] [Phase 32] [Phase 33]
    ^
    |
  Next
```

Phase: 28 (mcp-foundation) — EXECUTING
Plan: 2 of 3
Status: Ready to execute
Last activity: 2026-04-17

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 6 |
| Requirements mapped | 20/20 |
| Coverage | 100% |
| Plans complete | 0/? |
| Phase 28-mcp-foundation P01 | 7min | 2 tasks | 11 files |

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

### Pending Todos

None.

### Blockers/Concerns

- `fastify-mcp` maintenance status flagged MEDIUM confidence — validate plugin is actively maintained during Phase 28 planning; fallback is `NodeStreamableHTTPServerTransport` from SDK directly
- `agent-conversation` capability registration in LLM engine — inspect `packages/llm/src/capabilities/` during Phase 32 planning
- Token counting approach — confirm character-count approximation vs `tiktoken` during Phase 33 planning
- Web Speech API EU data residency — confirm whether org users have constraints before Phase 32; if so, defer speech to post-MVP

### Known Gotchas (carried from v2.12.0)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **HTMX 2.0 `hx-select` inheritance**: use plain JS `EventSource` for streaming, never `hx-sse`
- **`@fastify/rate-limit` 429 bypass**: add `onSend` hook on agent SSE path
- **Small scans score lower**: maxPages=3 may score 0 when full-site scores 2+
- **Branding service port**: lxc-luqen runs on port 4100 (not 4300)
- **`issue.context` can be null**: all scorers must null-guard

## Session Continuity

Last session: 2026-04-17T08:09:47.461Z
Stopped at: Completed 28-01-PLAN.md
Resume file: None
Next action: `/gsd:plan-phase 28`

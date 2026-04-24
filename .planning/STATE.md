---
gsd_state_version: 1.0
milestone: v3.0.0
milestone_name: MCP Servers & Agent Companion
status: shipped
stopped_at: v3.0.0 milestone archived 2026-04-24
last_updated: "2026-04-24T07:30:00.000Z"
last_activity: 2026-04-24
progress:
  total_phases: 10
  completed_phases: 10
  total_plans: 36
  completed_plans: 36
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24 after v3.0.0 milestone)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Planning next milestone — run `/gsd-new-milestone`

## Current Position

v3.0.0 shipped 2026-04-24. All 10 phases (28-33 including inserted 30.1, 31.1, 31.2, 32.1) complete; 36/36 plans; 22/22 requirements satisfied.

## Accumulated Context

### Decisions

Full decision log archived in `.planning/milestones/v3.0.0-ROADMAP.md` (Milestone Summary section). Carried forward highlights:

- MCP embedded as Fastify plugin per service, never standalone port
- Streamable HTTP transport only (SSE-only deprecated June 2025)
- AgentService calls service `/mcp` endpoints over HTTP — never direct module imports
- All LLM calls route through existing capability engine at `llm:4200`
- Rolling 20-turn window maintained at write time (not read time)
- char/4 token estimator sufficient for 85% compaction threshold

### Blockers/Concerns

None carried forward. Review `v3.0.0-MILESTONE-AUDIT.md` tech_debt section if spinning up a cleanup phase.

### Known Gotchas (carried forward)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **HTMX 2.0 `hx-select` inheritance**: use plain JS `EventSource` for streaming, never `hx-sse`
- **`@fastify/rate-limit` 429 bypass**: add `onSend` hook
- **Small scans score lower**: maxPages=3 may score 0 when full-site scores 2+
- **Branding service port**: lxc-luqen runs on port 4100 (not 4300)
- **`issue.context` can be null**: all scorers must null-guard
- **MCP tool schemas must never include orgId** — sourced from ToolContext populated by JWT preHandler (D-05/D-13 invariant; enforced by runtime iteration test per service)
- **MCP prompts use chat-message templates, not tool-call pre-fills** (D-12 / MCPI-06)

## Session Continuity

Last session: 2026-04-24T07:30:00.000Z
Stopped at: v3.0.0 milestone archived
Resume file: None
Next action: `/gsd-new-milestone`

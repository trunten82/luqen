---
gsd_state_version: 1.0
milestone: v3.1.0
milestone_name: Agent Companion v2 + Tech Debt & Docs
status: verifying
stopped_at: Phase 41 verification gaps_found (OAPI-04 partial)
last_updated: "2026-04-26T07:30:00Z"
last_activity: 2026-04-26 -- Phase 41 verified: 4/5 OAPI requirements pass, OAPI-04 partial
progress:
  total_phases: 10
  completed_phases: 8
  total_plans: 41
  completed_plans: 41
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24 — v3.1.0 milestone started)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Phase 41 — openapi-schema-backfill

## Current Position

Phase: 41 (openapi-schema-backfill) — VERIFIED (gaps_found)
Plan: 5 of 5 complete
Status: 4/5 OAPI requirements pass; OAPI-04 PARTIAL (dashboard per-route TypeBox blocks deferred for ~245 non-MCP routes — recommend Phase 41.1)
Last activity: 2026-04-26 -- Phase 41 verified: 4/5 OAPI requirements pass, OAPI-04 partial

## Phase Map (v3.1.0)

| # | Phase | Requirements | Depends on |
|---|-------|--------------|------------|
| 34 | Tokenizer Precision | TOK-01..05 | — |
| 35 | Agent Conversation History | AHIST-01..05 | 34 |
| 36 | Multi-Step Tool Use | ATOOL-01..04 | 35 |
| 37 | Streaming UX Polish | AUX-01..05 | 35 |
| 38 | Multi-Org Context Switching | AORG-01..04 | 35, 36 |
| 39 | Verification Backfill & Deferred-Items Triage | VER-01..03 | — |
| 40 | Documentation Sweep | DOC-01..07 | 34-39 |

## Accumulated Context

### Roadmap Evolution

- 2026-04-25: Phase 41 (OpenAPI Schema Backfill) added to v3.1.0 — closes Plan 40-01 deferred Task 2 and DOC-02 PARTIAL. Backfills Fastify route schemas across compliance/branding/llm/dashboard/MCP so `/docs` snapshots are substantive and `route-vs-spec` + `openapi-drift` gates pass.
- 2026-04-25: Phase 42 (Installer Wizard Redesign) added to v3.1.0 — Plan 40-07 dry-run on a clean LXC surfaced that all 3 installers were wired for the v2-era codebase. Phase 42 introduces 4 deployment profiles (Scanner CLI / API services / Self-hosted dashboard / Docker Compose), first-class registration of `@luqen/monitor`, plugin axis (auth/notify/storage/git-host) gated by profile, and `install.ps1` parity with `install.sh`. CONTEXT.md captured at scope time.

### Decisions (carried forward from v3.0.0)

- MCP embedded as Fastify plugin per service, never standalone port
- Streamable HTTP transport only (SSE-only deprecated June 2025)
- AgentService calls service `/mcp` endpoints over HTTP — never direct module imports
- All LLM calls route through existing capability engine at `llm:4200`
- Rolling 20-turn window maintained at write time (not read time)
- char/4 token estimator — being replaced in Phase 34 with precise tokenizer

### Constraints (v3.1.0)

- No new heavy dependencies (tokenizer must stay light, no native binaries, <5 MB bundle impact)
- External MCP clients must keep working unchanged
- Existing conversation rows use legacy token counts; only new conversations get precise counts (per Out of Scope)

### Known Gotchas (carried forward)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **HTMX 2.0 `hx-select` inheritance**: use plain JS `EventSource` for streaming, never `hx-sse`
- **`@fastify/rate-limit` 429 bypass**: add `onSend` hook
- **Branding service port**: lxc-luqen runs on port 4100 (not 4300)
- **`issue.context` can be null**: all scorers must null-guard
- **MCP tool schemas must never include orgId** — sourced from ToolContext populated by JWT preHandler
- **MCP prompts use chat-message templates, not tool-call pre-fills**

## Session Continuity

Last session: --stopped-at
Stopped at: Phase 40 context gathered
Resume file: --resume-file
Next action: `/gsd-plan-phase 34` (Tokenizer Precision)

**Planned Phase:** 40 (Documentation Sweep) — 7 plans — 2026-04-25T20:39:26.007Z

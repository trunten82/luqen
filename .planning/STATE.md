---
gsd_state_version: 1.0
milestone: v3.5.0
milestone_name: Commercial positioning & agency monetization
status: planning
last_updated: "2026-05-29T09:16:49.272Z"
last_activity: 2026-05-29
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-29 — v3.5.0 milestone)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Phase 78 — Anti-overlay positioning (first phase of v3.5.0; roadmap drafted)

## Current Position

Phase: Not started (roadmap drafted, awaiting plan-phase)
Plan: —
Status: Roadmap created
Last activity: 2026-06-01 — Completed quick task 260601-njq: per-org legal/company identity on VPAT/ACR

> Numbering note: `.planning` artifacts lagged a direct-to-master run (phases 43–77). Git reality is v3.4.0 with phases 71–77 shipped. v3.5.0 resumes at **Phase 78**.

## Phase Map (v3.5.0)

| # | Phase | Track | Requirements | Depends on |
|---|-------|-------|--------------|------------|
| 78 | Anti-overlay positioning | Cross-repo (WP readme + platform) | POS-01..03 | — (lightly gated on jurisdiction research) |
| 79 | Pro feature-gate bundle (WP plugin) | `luqen-wordpress` | GATE-01..06 | 80 (entitlement foundation, for GATE-06) |
| 80 | Credit-metered AI fixes | Platform (llm + dashboard) + WP surface | CREDIT-01..05 | 78 (cadence); establishes entitlement foundation |
| 81 | Agency tier | Platform (dashboard) | AGENCY-01..05 | 80 (partner entitlement extends foundation) |
| 82 | Pricing & packaging | Platform (cross-cutting) | PRICE-01..03 | 79, 80, 81; HARD-GATED on enterprise-pricing research |

**Two parallelizable tracks:** WordPress (`luqen-wordpress` — 78 readme, 79) and platform (`luqen` — 78 dashboard, 80, 81, 82), separate CI. They synchronize where 79's enterprise path consumes the Phase 80 entitlement foundation.

## Accumulated Context

### Roadmap Evolution

- 2026-05-29: v3.5.0 roadmap created (phases 78-82, coarse granularity). 22/22 requirements mapped (POS/GATE/CREDIT/AGENCY/PRICE), no orphans. Key sequencing decision: the per-org plan/entitlement model (PRICE-03) is the foundational abstraction consumed by GATE-06, CREDIT-02/03, and AGENCY-04 — a thin entitlement foundation is established inside Phase 80 (first platform phase needing allocation persistence), then Phase 82 formalizes the full plan model on top. Phase 82 sequences last because it is hard-gated on in-flight enterprise-pricing research.

### Decisions (v3.5.0)

- Monetization stays admin-controlled (per-org plan + credits set in dashboard) — Stripe/Freemius billing explicitly out of scope this milestone
- Excel-only exports (no CSV) — GATE-03 must use buildXlsx()
- WP entitlement: enterprise mode derives from connected Luqen org plan; standalone license-key path stubbed for future
- Credits layer on the existing `llm_usage` ledger + pricing registry shipped in phases 72–77 — do not rebuild telemetry
- `luqen` and `luqen-wordpress` are SEPARATE repos with SEPARATE CI → two parallelizable execution tracks

### Constraints (v3.5.0)

- Tech stack: TypeScript, Fastify, existing patterns — no new frameworks
- Auth: OAuth2 client credentials (RS256 JWT) — same across all services
- All capabilities degrade gracefully when LLM unavailable (CREDIT-03 must hit deterministic fallback)
- Must integrate with compliance/branding without breaking changes
- No external billing / payment processing / PCI handling

### Known Gotchas (carried forward)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **HTMX 2.0 `hx-select` inheritance**: use plain JS `EventSource` for streaming
- **`@fastify/rate-limit` 429 bypass**: add `onSend` hook
- **All Luqen services use `/api/v1/*` prefix** — bare `/oauth/token` or `/health` returns misleading 401
- **Fastify rejects empty JSON body** — always send `{}` on bodyless POSTs
- **New services/surfaces must appear in ALL shared admin sections** (health, clients, sidebar)
- **Cross-service auth**: OAuth2 client credentials only, never raw API keys
- **Live tracks master, not develop** — push to master before deploy; no CI on lxc-luqen, deploy via explicit ssh

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260601-fte | Manual-test evidence artifacts (screenshots/documents) in the VPAT/ACR report (web + PDF) | 2026-06-01 | 1304877 | [260601-fte-vpat-evidence-artifacts](./quick/260601-fte-vpat-evidence-artifacts/) |
| 260601-njq | Per-org legal/company identity on VPAT/ACR reports (web + PDF + share); migration 082, optional StorageAdapter field | 2026-06-01 | c3cc788 | [260601-njq-vpat-org-legal-identity](./quick/260601-njq-vpat-org-legal-identity/) |

## Session Continuity

Last session: 2026-05-29 — v3.5.0 roadmap created
Stopped at: ROADMAP.md + STATE.md + REQUIREMENTS.md traceability written
Resume file: None
Next action: `/gsd:plan-phase 78` (Anti-overlay positioning)

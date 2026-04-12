---
gsd_state_version: 1.0
milestone: v2.12.0
milestone_name: Brand Intelligence Polish
status: planned
stopped_at: Roadmap and requirements written — ready for Phase 22 planning
last_updated: "2026-04-12T12:00:00Z"
last_activity: 2026-04-12 -- v2.12.0 roadmap created (6 phases, 25 requirements)
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-12)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** v2.12.0 Brand Intelligence Polish — permissions audit, brand overview page, per-dimension trends + target, drilldown modal, typography x-height spike, historical rescore

## Current Position

Phase: 22 of 27 (Permissions Audit) — ready to plan
Plan: —
Status: Ready to plan
Progress: 0/6 phases
Last activity: 2026-04-12 -- v2.12.0 roadmap created

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Carried from v2.11.0:
- Scoring lives in dashboard, not `@luqen/branding` — single pure calculator
- Composite weights locked at `{color: 0.50, typography: 0.30, components: 0.20}`
- Dual-mode fallback policy: service outage → degraded scan, NEVER silent cross-route
- `BrandingOrchestrator` reads `orgs.branding_mode` per-request, no caching
- Zero branded contrast violations = 100% color score (post-deploy hotfix)

v2.12.0 planning decisions:
- `admin.org` already exists — no new permission needed, just route audit
- Brand overview at `/brand-overview` (not `/admin/`) — org-scoped content visible to all authenticated users with `branding.view`
- Score target: single org-level integer on `organizations` table, not per-site or per-dimension
- Typography spike: opentype.js (pure JS, ~180 KB) over fontkit; server-side only; "not viable" is acceptable outcome
- Historical rescore: always embedded mode, never remote; idempotent by (scan_id, guideline_id)

### Pending Todos

None.

### Blockers/Concerns

- **Typography x-height**: opentype.js OS/2 table version >= 2 required for sxHeight — coverage across Google Fonts catalog unknown until spike
- **Historical rescore**: large orgs (1,000+ scans) may take ~50s synchronous — progress feedback needed
- **Migration numbering**: score target (organizations.brand_score_target) and font metrics (branding_fonts.x_height etc.) need separate or combined migration 044/045

### Known Gotchas (carried from v2.11.0)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **Small scans score lower**: maxPages=3 may score 0 when full-site scores 2+
- **Branding service port**: lxc-luqen runs on port 4100 (not 4300)
- **`issue.context` can be null**: all scorers must null-guard

## Session Continuity

Last session: 2026-04-12
Stopped at: v2.12.0 roadmap and requirements written — ready for `/gsd-plan-phase 22`
Resume file: None

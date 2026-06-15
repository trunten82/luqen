---
phase: 82-scheduled-executive-digest
plan: "04"
subsystem: dashboard
tags: [admin-ux, digest, hbs, htmx, i18n, css, digest-01]
dependency_graph:
  requires: ["82-03"]
  provides: ["82-05"]
  affects:
    - packages/dashboard/src/routes/admin/digest-schedules.ts
    - packages/dashboard/src/views/admin/digest-schedules.hbs
    - packages/dashboard/src/views/admin/digest-view.hbs
tech_stack:
  added: []
  patterns:
    - "Admin page mirrors routes/admin/email-reports.ts (list/create/edit/delete + toggle + send-now)"
    - "rpt-digest-* partials reuse Phase 81 rpt-badge--{band} band visuals verbatim"
    - "HTMX hx-post on buttons (no <form> inside <tr>); CSRF via hx-include [name='_csrf']"
    - "6-locale i18n via {{t}} double-brace keys (digest.*)"
key_files:
  created:
    - packages/dashboard/src/views/admin/digest-schedules.hbs
    - packages/dashboard/src/views/admin/digest-view.hbs
    - packages/dashboard/src/views/partials/rpt-digest-changed.hbs
    - packages/dashboard/src/views/partials/rpt-digest-risk.hbs
    - packages/dashboard/tests/routes/admin/digest-schedules.test.ts
  modified:
    - packages/dashboard/src/routes/admin/digest-schedules.ts
    - packages/dashboard/src/views/partials/sidebar.hbs
    - packages/dashboard/src/static/style.css
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/i18n/locales/de.json
    - packages/dashboard/src/i18n/locales/es.json
    - packages/dashboard/src/i18n/locales/fr.json
    - packages/dashboard/src/i18n/locales/it.json
    - packages/dashboard/src/i18n/locales/pt.json
requirements-completed: [DIGEST-01]
metrics:
  duration_minutes: 35
  completed: "2026-06-11"
  tasks_total: 2
  tasks_completed: 2
  note: "Reconstructed 2026-06-15 — the original SUMMARY.md was written in the executor worktree but lost when the worktree was removed before its docs commit (#2070). Content reconstructed from the 82-04 plan + commits c5a01321 (RED) and 84e64c9e (GREEN); phase already passed goal verification (82-VERIFICATION.md, 14/14) and code review (82-REVIEW.md)."
---

# Phase 82 Plan 04: Dashboard Digest Admin UX Summary

**One-liner:** A `/admin/digest-schedules` admin page (list/create/edit/delete + enable-pause + send-now, per-channel toggles, weekly/monthly, org-or-site scope) plus the dashboard digest view + `rpt-digest-*` partials and 6-locale i18n — surfacing the Phase 82 digest in the dashboard (DIGEST-01).

## What Was Built

### Task 1 (TDD RED, commit `c5a01321`)
Failing tests for the digest-schedule admin routes: `tests/routes/admin/digest-schedules.test.ts`.

### Task 2 (GREEN, commit `84e64c9e`)
- **`routes/admin/digest-schedules.ts`** — `digestScheduleRoutes` mirroring `email-reports.ts`: list, create, toggle (enable/pause), send-now, delete, `:id/view`, and `:id/pdf/:period`. All routes gated by `requirePermission('admin.system')`; HTMX `hx-post` on buttons (no `<form>` inside table cells); CSRF via `hx-include="[name='_csrf']"`; toast responses; HTMX-partial row swaps.
- **`views/admin/digest-schedules.hbs`** — list table + create form (name, scope org/site, frequency weekly/monthly, recipients, per-channel email/Slack/Teams toggles).
- **`views/admin/digest-view.hbs`** — preview/archive of the rendered digest with a board-PDF download.
- **`views/partials/rpt-digest-changed.hbs`** — "What changed" card (errors/warnings/notices + per-criterion deltas).
- **`views/partials/rpt-digest-risk.hbs`** — "What's at risk" card; reuses the Phase 81 `rpt-badge--{band}` exposure visuals verbatim (band label + icon + colour, never a number).
- **`views/partials/sidebar.hbs`** — "Digest schedules" link added in the Integrations cluster (cross-service consistency).
- **`static/style.css`** — `rpt-digest-*` namespace styles.
- **i18n** — `digest.*` keys added to all 6 locales (en/de/es/fr/it/pt).

26 tests pass (TDD RED→GREEN). TypeScript clean. D-12 forbidden-words grep clean on every new user-facing file.

## Deviations from Plan
Plan 82-04 was split out of the original oversized plan during planning (admin UX here; server wiring + `GET /api/v1/digest` + openapi/rbac regen moved to 82-05). No execution-time deviations recorded.

## Threat Flags
None beyond the plan's `<threat_model>` (T-82-14 admin-route authz, T-82-16 CSRF, T-82-17 TR XSS, T-82-19 conservative copy) — all verified CLOSED in `82-SECURITY.md`.

## Self-Check: PASSED (verified retroactively via 82-VERIFICATION.md + 82-REVIEW.md + 82-SECURITY.md)

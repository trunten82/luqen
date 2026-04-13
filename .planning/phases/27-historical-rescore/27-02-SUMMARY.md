---
phase: 27-historical-rescore
plan: 02
subsystem: dashboard/rescore-ui
tags: [rescore, htmx, handlebars, polling, brand-overview, accessibility]
dependency_graph:
  requires:
    - rescore-service
    - rescore-progress-repository
    - brand-score-calculator
  provides:
    - rescore-ui-routes
    - rescore-htmx-partials
    - rescore-i18n-strings
  affects: [brand-overview]
tech_stack:
  added: []
  patterns: [htmx-polling, native-dialog, aria-live-region, async-background-loop]
key_files:
  created:
    - packages/dashboard/src/views/partials/rescore-button.hbs
    - packages/dashboard/src/views/partials/rescore-progress.hbs
    - packages/dashboard/src/views/partials/rescore-complete.hbs
    - packages/dashboard/src/views/partials/rescore-error.hbs
    - packages/dashboard/tests/routes/brand-overview-rescore.test.ts
  modified:
    - packages/dashboard/src/routes/brand-overview.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/views/brand-overview.hbs
decisions:
  - "RescoreService passed as optional param to brandOverviewRoutes (not added to StorageAdapter interface)"
  - "Background batch loop uses async processLoop with catch — does not block HTTP response"
  - "Global admin org resolution reuses existing listOrgs pattern from POST /target"
metrics:
  duration: 334s
  completed: "2026-04-13T06:54:40Z"
  tasks_completed: 2
  tasks_total: 3
  tests_added: 9
  files_created: 5
  files_modified: 4
requirements_completed: [BRESCORE-01, BRESCORE-02, BRESCORE-03, BRESCORE-04, BRESCORE-05]
---

# Phase 27 Plan 02: Rescore UI Summary

Rescore UI layer with HTMX polling progress bar, native dialog confirmation, 4 state partials, 2 route endpoints, and 9 route tests wired to the RescoreService from Plan 01.

## Task Completion

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | i18n strings + Handlebars partials for all rescore UI states | 41f3937 | Done |
| 2 | Rescore routes + server wiring + RescoreService instantiation + route tests | cb2acab | Done |
| 3 | UAT -- full rescore flow on brand overview page | -- | Checkpoint (awaiting human verify) |

## Implementation Details

### Task 1: i18n + Partials

- Added 11 `rescore.*` i18n keys to `en.json` covering all UI states
- `rescore-button.hbs`: native `<dialog>` with `showModal()`, HTMX `hx-post` to `/rescore/start`, 44px min-height button, `autofocus` on confirm, disabled when `candidateCount=0`
- `rescore-progress.hbs`: HTMX `hx-get` polling every 2s, `role="status"` + `aria-live="polite"`, `<progress>` element with full ARIA attributes
- `rescore-complete.hbs`: success banner with scored/skipped/warning counts, auto-refresh sparklines via `hx-trigger="load delay:3s"`
- `rescore-error.hbs`: error banner with try-again link back to `/brand-overview`
- `brand-overview.hbs` updated with `canManageBranding` gated rescore section

### Task 2: Routes + Wiring

- `POST /brand-overview/rescore/start` -- calls `startRescore()`, kicks off async batch processing loop, returns progress partial
- `GET /brand-overview/rescore/progress` -- returns state-dependent partial (running/completed/failed)
- Both routes gated by `requirePermission('branding.manage')` (T-27-06, T-27-11)
- `GET /brand-overview` viewData extended with `candidateCount` and `rescoreInProgress` fields
- `server.ts` wires `SqliteRescoreProgressRepository` + `RescoreService` and passes to routes
- 4 rescore partials registered in Handlebars config
- 9 route tests covering: start success, already-running (D-09), no-candidates, permission gate, progress running/complete/failed, viewData with/without manage permission

## Threat Mitigations

| Threat ID | Mitigation | Verified |
|-----------|-----------|----------|
| T-27-06 | requirePermission('branding.manage') on POST /start | Test 3 (403) |
| T-27-07 | CSRF token via hx-vals in button partial | Template inspection |
| T-27-09 | Progress scoped to org via getOrgId(request) | Tests 4-6 (org-1) |
| T-27-10 | Polling interval 2s server-controlled via hx-trigger | Template inspection |
| T-27-11 | canManageBranding gate in template + preHandler in routes | Tests 7-8 |

## Deviations from Plan

### Auto-added (Rule 2)

**1. [Rule 2] No-candidates returns button partial instead of inline HTML**
- The plan suggested returning button partial with `candidateCount=0` -- implemented exactly as specified with disabled confirm button in dialog.

**2. [Rule 2] Additional test for no-candidates scenario**
- Added test 4 (returns button partial with candidateCount=0) beyond the 8 planned tests for completeness (9 total).

## Self-Check: PASSED

---
phase: 01-generate-fix
plan: 02
subsystem: dashboard
tags: [llm, fix-suggestions, htmx, i18n, css]
dependency_graph:
  requires: [01-01]
  provides: [dashboard-fix-suggestion-ui]
  affects: [report-detail-page, admin-llm-page]
tech_stack:
  added: []
  patterns: [htmx-lazy-load, llm-with-fallback, handlebars-helper-upgrade]
key_files:
  created: []
  modified:
    - packages/dashboard/src/llm-client.ts
    - packages/dashboard/src/routes/reports.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/src/views/report-detail.hbs
    - packages/dashboard/src/static/style.css
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/views/admin/llm.hbs
decisions:
  - "HTMX attributes placed on <details> element with hx-target=find for cross-version compat (1.x and 2.x)"
  - "llmClient creation moved before reportRoutes in server.ts to avoid ordering dependency"
  - "scanId passed as third arg using @root.scan.id Handlebars accessor for nesting-depth safety"
metrics:
  duration: "~12 minutes"
  completed: "2026-04-04T14:44:01Z"
  tasks_completed: 2
  files_modified: 7
requirements:
  - FIX-05
  - FIX-06
---

# Phase 01 Plan 02: Dashboard Fix Suggestion Integration Summary

HTMX lazy-load AI fix panels on report detail page with LLM-first / hardcoded-fallback strategy.

## Objective

Wire the `generate-fix` LLM capability into the dashboard: users see AI-powered fix suggestions directly on the report detail page, with graceful fallback to hardcoded patterns when LLM is unavailable.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add generateFix to LLMClient and fix-suggestion route | 55f510c | llm-client.ts, reports.ts, server.ts |
| 2 | Upgrade fixSuggestion helper, CSS, i18n, admin hint | 9c778a4 | server.ts, report-detail.hbs, style.css, en.json, llm.hbs |

## What Was Built

**Task 1 — Backend wiring:**
- `LLMClient.generateFix()` method added after `deletePrompt` — calls `POST /api/v1/generate-fix` on the LLM service via `apiFetch`
- `GET /reports/:id/fix-suggestion` route added to `reportRoutes` — returns HTML partial; tries LLM first, falls back to `getFixSuggestion(criterion, message)` from hardcoded patterns, returns empty string if no match
- `reportRoutes` function signature updated to accept `llmClient: LLMClient | null = null`
- `llmClient` creation moved before `reportRoutes` call in server.ts to eliminate ordering dependency

**Task 2 — Frontend wiring:**
- `fixSuggestion` Handlebars helper upgraded from synchronous inline render to HTMX lazy-load `<details>` panel
- Helper now accepts `scanId` (third arg) and emits `hx-get`, `hx-trigger="toggle once"`, `hx-target="find .rpt-fix-hint__loading-wrap"` on the `<details>` element
- All 4 call sites in `report-detail.hbs` updated to pass `@root.scan.id` as third argument
- Loading skeleton rendered inside `rpt-fix-hint__loading-wrap` div (3 animated skeleton bars)
- 7 new CSS classes added after `.rpt-fix-effort--high`: `rpt-fix-hint__source`, `--ai`, `--pattern`, `rpt-fix-hint__loading`, `rpt-fix-hint__loading-wrap`, `rpt-fix-hint__actions`
- 8 new `reportDetail` i18n keys added: `fixHintToggleAi`, `fixHintTogglePattern`, `fixSourceAi`, `fixSourcePattern`, `fixLlmUnavailable`, `fixLoading`, `fixCopyBtn`, `fixCopiedBtn`
- 3 new `common` i18n keys added: `effortLow`, `effortMedium`, `effortHigh`
- Admin `llm.hbs` Prompts tab hint updated with conditional block: shows `wcagCriterion`, `issueMessage`, `htmlContext`, `cssContext` variables when `capability === 'generate-fix'`, otherwise shows existing `content` hint

## Verification

- TypeScript: `npx tsc --noEmit` — 0 errors
- Tests: 2092 passed, 0 failed (111 test files, 40 skipped)

## Deviations from Plan

**1. [Rule 3 - Blocking] Moved llmClient creation before reportRoutes**
- **Found during:** Task 1
- **Issue:** `reportRoutes` was called on line 621 of server.ts, but `llmClient` was created on line 631. Passing `llmClient` as a parameter would have failed because it wasn't in scope yet.
- **Fix:** Moved the `llmClient` creation block (lines 631-634) to before the `reportRoutes` call. The comment was updated from "used in admin routes below" to "used in report routes and admin routes below".
- **Files modified:** `packages/dashboard/src/server.ts`
- **Commit:** 55f510c

## Known Stubs

None — all data flows are wired. The `htmlContext` parameter is passed as an empty string from the Handlebars helper (no HTML context available at template render time), which is accepted by the LLM service. The route handler passes whatever `htmlContext` it receives from query params.

## Self-Check: PASSED

Files verified:
- `packages/dashboard/src/llm-client.ts` — generateFix method present
- `packages/dashboard/src/routes/reports.ts` — fix-suggestion route present
- `packages/dashboard/src/server.ts` — HTMX helper and llmClient ordering fixed
- `packages/dashboard/src/views/report-detail.hbs` — 4 occurrences of @root.scan.id
- `packages/dashboard/src/static/style.css` — rpt-fix-hint__source classes present
- `packages/dashboard/src/i18n/locales/en.json` — fixSourceAi and all new keys present
- `packages/dashboard/src/views/admin/llm.hbs` — generate-fix conditional hint present

Commits verified:
- 55f510c — Task 1
- 9c778a4 — Task 2

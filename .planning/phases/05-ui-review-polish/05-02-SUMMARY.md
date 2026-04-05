---
phase: 05-ui-review-polish
plan: "02"
subsystem: dashboard-ui
tags: [htmx, handlebars, css, design-system, ai-ux]
dependency_graph:
  requires:
    - phase: 05-01
      provides: design-system-tokens, llm-admin-i18n, mobile-css
  provides:
    - ai-summary-unavailable-state
    - brand-discover-intro-copy
    - rpt-ai-summary--unavailable CSS
    - brd-discover__heading/desc CSS
  affects:
    - packages/dashboard/src/views/report-detail.hbs
    - packages/dashboard/src/views/admin/branding-guideline-detail.hbs
    - packages/dashboard/src/static/style.css
tech-stack:
  added: []
  patterns:
    - "Handlebars conditional HTMX attributes inside div — {{#if}} inside element attrs for optional hx-get/hx-trigger"
    - "AI feature unavailable states use .rpt-*--unavailable BEM modifier pattern"
key-files:
  created: []
  modified:
    - packages/dashboard/src/views/report-detail.hbs
    - packages/dashboard/src/views/admin/branding-guideline-detail.hbs
    - packages/dashboard/src/static/style.css
key-decisions:
  - "panel-ai-summary div always rendered — HTMX attrs conditional inside div (not outer {{#if}}) so tab never leads to blank panel"
  - "brd-discover__desc replaces text-muted mb-md on description paragraph for BEM consistency"
requirements-completed:
  - UIR-04
  - UIR-05
duration: ~5min
completed: "2026-04-05"
---

# Phase 05 Plan 02: AI Feature UX Polish Summary

**AI Summary panel always renders with graceful LLM-unavailable notice; brand discover section styled with BEM classes; fix hint loading state uses design system tokens.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-05
- **Completed:** 2026-04-05 (Task 1 only — Task 2 awaiting human verify checkpoint)
- **Tasks:** 1 of 2 executed
- **Files modified:** 3

## Accomplishments

- `report-detail.hbs`: AI Summary tab panel (`#panel-ai-summary`) always renders — HTMX attributes are conditional via inner `{{#if llmEnabled}}` on the div attributes. When LLM disabled: shows `rpt-ai-summary--unavailable` styled notice using existing `reportDetail.aiSummaryUnavailable` i18n key. No blank panel state.
- `branding-guideline-detail.hbs`: Added `brd-discover__heading` class to the h3 and replaced `text-muted mb-md` with `brd-discover__desc` on the description paragraph for BEM-consistent design system styling.
- `style.css`: Added `.rpt-ai-summary--unavailable` (muted italic text), `.brd-discover__heading` (600-weight, base size, primary color), `.brd-discover__desc` (sm size, muted color, sm bottom margin) — all using Emerald tokens. `.rpt-fix-hint__loading` token padding was already applied by 05-01.

## Task Commits

1. **Task 1: Polish AI feature UX flows** - `c0759ff` (feat)
2. **Task 2: Stitch MCP validation** - PENDING — awaiting human-verify checkpoint

## Files Created/Modified

- `packages/dashboard/src/views/report-detail.hbs` — AI summary panel restructured: always-present div, conditional HTMX attrs, unavailable state branch
- `packages/dashboard/src/views/admin/branding-guideline-detail.hbs` — brd-discover heading/desc BEM classes
- `packages/dashboard/src/static/style.css` — 3 new rules: `.rpt-ai-summary--unavailable`, `.brd-discover__heading`, `.brd-discover__desc`

## Decisions Made

- Panel-ai-summary div always rendered with HTMX attrs inside `{{#if}}` block within the div rather than wrapping the whole element — this ensures the tab panel container always exists in the DOM so the tab button has a valid target
- `brd-discover__desc` class added to description paragraph instead of `text-muted mb-md` for BEM consistency; `brd-discover__heading` added alongside existing `card__title` to add discover-specific size/weight overrides

## Deviations from Plan

### Pre-existing state (not deviations)

1. `reportDetail.aiSummaryUnavailable` i18n key was already present in `en.json` from a prior session — no new key needed.
2. `branding-guideline-detail.hbs` already had the `discoverDescription` paragraph — plan instruction to "add" it was already done; only CSS class change needed.
3. `.rpt-fix-hint__loading { padding: var(--space-sm) var(--space-md) }` was already applied in 05-01 Task 2 — Change 3 from this plan was already complete.

None of these are plan failures — plan execution was correct and idempotent.

## Known Stubs

None — UI polish pass; no data stubs introduced.

## Self-Check: PASSED

- `c0759ff` commit verified: `git log --oneline | grep c0759ff`
- `packages/dashboard/src/views/report-detail.hbs` — `rpt-ai-summary--unavailable` present
- `packages/dashboard/src/views/admin/branding-guideline-detail.hbs` — `brd-discover__desc` present
- `packages/dashboard/src/static/style.css` — `.rpt-ai-summary--unavailable`, `.brd-discover__heading`, `.brd-discover__desc` present
- Dashboard build: PASSED (no errors)
- JSON valid: PASSED

---
*Phase: 05-ui-review-polish*
*Task 1 completed: 2026-04-05*
*Task 2: awaiting human-verify checkpoint*

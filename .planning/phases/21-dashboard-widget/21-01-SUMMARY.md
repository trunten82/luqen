---
phase: 21-dashboard-widget
plan: 01
subsystem: ui
tags: [handlebars, svg, sparkline, brand-score, dashboard, accessibility]

requires:
  - phase: 20-brand-score-panel
    provides: brandScoreClass/brandScoreBadge helpers, brand-score-panel partial, BrandScoreRepository

provides:
  - Brand score widget partial (brand-score-widget.hbs) with 3 empty-state variants
  - SVG polyline sparkline rendered server-side (zero client-side JS)
  - Brand score data plumbing in GET /home route handler
  - i18n keys for home.brandScore.* namespace

affects: [21-dashboard-widget, branding-pipeline]

tech-stack:
  added: []
  patterns: [server-computed SVG sparkline via polyline points string, 3-variant empty-state widget pattern]

key-files:
  created:
    - packages/dashboard/src/views/partials/brand-score-widget.hbs
  modified:
    - packages/dashboard/src/routes/home.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/src/views/home.hbs
    - packages/dashboard/src/static/style.css
    - packages/dashboard/src/i18n/locales/en.json

key-decisions:
  - "Sparkline points computed in route handler rather than Handlebars helper — keeps template logic minimal"
  - "Widget placed as separate section between exec-summary and overview — avoids breaking 4-column grid layout"

patterns-established:
  - "Server-computed SVG sparkline: compute polyline points string in route, pass to template as pre-built attribute value"
  - "3-variant widget pattern: null/empty, single-value, multi-value with trend"

requirements-completed: [BUI-02]

duration: 5min
completed: 2026-04-10
---

# Phase 21 Plan 01: Brand Score Widget Summary

**Brand score dashboard widget with inline SVG polyline sparkline, 3 empty-state variants, trend delta arrow, and sr-only accessible description — zero client-side JS**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-10T09:16:23Z
- **Completed:** 2026-04-10T09:21:52Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Brand score widget renders on home dashboard with big number, color band, trend arrow, delta, and SVG sparkline
- Three empty-state variants: no data (dash + hint), first score (number only), 2+ scores (full sparkline + delta)
- Server-computed SVG polyline points with sr-only accessible description for screen readers
- All strings use i18n {{t}} helpers — no hardcoded English
- Mobile responsive with max-width constraints

## Task Commits

Each task was committed atomically:

1. **Task 1: Route data plumbing + partial registration + i18n keys** - `5d09ab9` (feat)
2. **Task 2: Create brand-score-widget.hbs + include in home.hbs + CSS** - `9c00ed4` (feat)

## Files Created/Modified
- `packages/dashboard/src/views/partials/brand-score-widget.hbs` - Brand score widget partial with 3 variants, SVG sparkline
- `packages/dashboard/src/routes/home.ts` - Brand score history fetch, sparkline point computation, brandWidget context
- `packages/dashboard/src/server.ts` - Registered brand-score-widget partial
- `packages/dashboard/src/views/home.hbs` - Included widget section between exec-summary and overview
- `packages/dashboard/src/static/style.css` - Widget layout CSS + mobile responsive rules
- `packages/dashboard/src/i18n/locales/en.json` - Added home.brandScore.* i18n keys

## Decisions Made
- Sparkline points computed in route handler (not Handlebars helper) — keeps template simple, avoids complex helper logic
- Widget placed as new section between exec-summary and overview sections — preserves existing 4-column grid layout
- Used viewBox "0 0 100 40" with preserveAspectRatio="xMidYMid meet" for responsive SVG sizing
- Max-width 120px on sparkline container prevents mobile overflow

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Widget partial ready for testing in browser (Plan 21-02 or manual UAT)
- i18n keys added for English only — Plan 21-03 handles other locales

---
*Phase: 21-dashboard-widget*
*Completed: 2026-04-10*

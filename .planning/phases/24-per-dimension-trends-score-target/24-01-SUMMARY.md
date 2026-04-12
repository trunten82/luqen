---
phase: 24-per-dimension-trends-score-target
plan: 01
subsystem: dashboard/brand-overview
tags: [sparkline, brand-scoring, svg, dimensions, trends]
dependency_graph:
  requires: []
  provides: [gap-aware-sparkline, per-dimension-trend-polylines, computeTargetY]
  affects: [brand-overview-route, brand-overview-template]
tech_stack:
  added: []
  patterns: [gap-aware-sparkline, dimension-extraction, svg-polyline-layering]
key_files:
  created: []
  modified:
    - packages/dashboard/src/services/sparkline.ts
    - packages/dashboard/src/routes/brand-overview.ts
    - packages/dashboard/src/views/brand-overview.hbs
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/tests/services/sparkline.test.ts
    - packages/dashboard/tests/routes/brand-overview.test.ts
decisions:
  - "Gap indices use original x-positions so visual breaks represent temporal gaps in the timeline"
  - "Dimension polylines rendered behind composite (lower z-order) with 0.6 opacity and thinner stroke"
  - "computeTargetY exported for Plan 24-02 target line feature"
metrics:
  duration: "~42 min"
  completed: "2026-04-12"
  tasks_completed: 2
  tasks_total: 2
  test_count: 31
  files_changed: 6
---

# Phase 24 Plan 01: Per-Dimension Trend Polylines Summary

Gap-aware sparkline utility with 3 colored dimension polylines (color/typography/components) on the brand overview SVG, plus computeTargetY helper for Plan 24-02.

## What Was Done

### Task 1: Extend sparkline utility + per-dimension data extraction (TDD)

- Extended `computeSparklinePoints` with optional `gaps` parameter (ReadonlySet<number>) that skips specified indices while preserving x-positioning for visual gap breaks
- Added `computeTargetY` helper that computes y-coordinate for a horizontal target line using same padding/min/max logic as sparkline points
- Route extracts `dimensionSparklines` object with `{ color, typography, components }` each having `{ points, hasData }` fields
- Dimensions with fewer than 2 scored entries get `hasData=false` and empty points string
- Full backward compatibility: existing callers without gaps parameter behave identically
- 17 new tests (11 sparkline gap-aware + computeTargetY, 2 route dimension tests)

### Task 2: Render per-dimension polylines on SVG + i18n

- 3 dimension polylines rendered behind composite line: color=green (`--status-success`), typography=blue (`--status-info`), components=orange (`--status-warning`)
- Dimension lines use stroke-width 0.8 and opacity 0.6 so composite dominates visually
- Color legend below sparkline identifies each line
- Insufficient-data text messages for dimensions without trend data
- SVG upgraded from `aria-hidden` to `role="img"` with aria-label and desc for accessibility
- 7 new i18n keys added to en.json

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | c06d3f3 | Gap-aware sparkline utility + per-dimension data extraction |
| 2 | a706b51 | Render per-dimension polylines on SVG with legend and i18n |

## Self-Check: PASSED

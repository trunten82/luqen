---
phase: 24-per-dimension-trends-score-target
plan: 02
subsystem: dashboard/brand-overview
tags: [brand-score-target, svg-target-line, gap-display, migration, org-settings]
dependency_graph:
  requires:
    - phase: 24-01
      provides: computeTargetY helper, sparkline SVG structure, brand-overview route
  provides:
    - migration 044 (brand_score_target column)
    - OrgRepository getBrandScoreTarget/setBrandScoreTarget methods
    - POST /brand-overview/target route
    - SVG dashed target line
    - summary card gap display with color banding
  affects: [brand-overview, org-settings]
tech_stack:
  added: []
  patterns: [org-level-setting-crud, svg-target-line, gap-color-banding]
key_files:
  created: []
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/interfaces/org-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/org-repository.ts
    - packages/dashboard/src/routes/brand-overview.ts
    - packages/dashboard/src/views/brand-overview.hbs
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/tests/db/orgs.test.ts
    - packages/dashboard/tests/routes/brand-overview.test.ts
key_decisions:
  - "Target stored as nullable INTEGER on organizations table (migration 044) rather than separate table"
  - "Gap color banding: green (met/exceeded), amber (within 10), red (>10 below target)"
  - "Target form uses standard form POST with CSRF, not HTMX, for simplicity"
patterns_established:
  - "Org-level setting pattern: nullable column + get/set repository methods + validation in both repo and route"
requirements_completed: [BTREND-04, BTREND-05, BTREND-06]
metrics:
  duration: 7min
  completed: 2026-04-12
  tasks_completed: 2
  tasks_total: 2
  test_count: 14
  files_changed: 8
---

# Phase 24 Plan 02: Brand Score Target Summary

**Org-level brand score target with dashed SVG line, target input form, and color-coded gap display on summary card**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-12T16:31:19Z
- **Completed:** 2026-04-12T16:38:09Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Migration 044 adds nullable brand_score_target INTEGER column to organizations table
- OrgRepository getBrandScoreTarget/setBrandScoreTarget with 0-100 validation and null clearing
- POST /brand-overview/target route gated by branding.manage permission with CSRF protection
- Dashed horizontal SVG line at target y-coordinate using computeTargetY from Plan 24-01
- Summary card shows "Target: N (+/-gap)" with green/amber/red color banding
- Target input form with set/clear buttons visible only to branding.manage users
- NULL target produces no target line and no gap display

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 044 + OrgRepository target get/set methods** - `9629371` (feat)
2. **Task 2: Target POST route + SVG dashed line + summary card gap display** - `6977daf` (feat)

## Files Created/Modified
- `packages/dashboard/src/db/sqlite/migrations.ts` - Migration 044: brand_score_target column
- `packages/dashboard/src/db/interfaces/org-repository.ts` - getBrandScoreTarget/setBrandScoreTarget interface
- `packages/dashboard/src/db/sqlite/repositories/org-repository.ts` - SQLite implementation with validation
- `packages/dashboard/src/routes/brand-overview.ts` - POST target route + GET view data extension
- `packages/dashboard/src/views/brand-overview.hbs` - Target form, dashed SVG line, gap display
- `packages/dashboard/src/i18n/locales/en.json` - 4 new brandOverview target i18n keys
- `packages/dashboard/tests/db/orgs.test.ts` - 6 new target method tests
- `packages/dashboard/tests/routes/brand-overview.test.ts` - 8 new route tests (POST + gap computation)

## Decisions Made
- Target stored as nullable INTEGER on organizations table rather than separate table (simple, single-value setting)
- Gap color banding thresholds: >= 0 = green (success), >= -10 = amber (warning), < -10 = red (error)
- Target form uses standard form POST with CSRF rather than HTMX for simplicity and reliability

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed form-urlencoded test payload format**
- **Found during:** Task 2 (POST route tests)
- **Issue:** Test payloads sent as JS objects with content-type form-urlencoded; Fastify inject needs string payload for proper form encoding
- **Fix:** Changed test payloads from `{ target: '85' }` to string format `'target=85'`
- **Files modified:** packages/dashboard/tests/routes/brand-overview.test.ts
- **Verification:** All POST tests pass with correct mock assertions
- **Committed in:** 6977daf (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test payload format fix was necessary for correct Fastify inject behavior. No scope creep.

## Issues Encountered
None beyond the test payload format issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Brand score target feature complete and tested
- Target data flows through existing sparkline infrastructure (computeTargetY from 24-01)
- Ready for any follow-up phases that extend brand overview features

## Self-Check: PASSED

---
*Phase: 24-per-dimension-trends-score-target*
*Completed: 2026-04-12*

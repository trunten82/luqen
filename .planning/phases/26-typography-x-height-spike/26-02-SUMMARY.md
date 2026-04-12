---
phase: 26-typography-x-height-spike
plan: 02
subsystem: branding
tags: [opentype.js, google-fonts-api, typography, x-height, font-metrics, scoring]

# Dependency graph
requires:
  - phase: 26-typography-x-height-spike
    plan: 01
    provides: "opentype.js installed, googleFontsApiKey config field, POC viability confirmed"
  - phase: 21-brand-score-persistence
    provides: "Brand scoring pipeline and typography sub-score"
provides:
  - "Migration 045 adding x_height, cap_height, units_per_em columns to branding_fonts"
  - "FontMetricsService for Google Fonts API resolution + opentype.js metric extraction"
  - "Typography scorer 4th heuristic (xHeightOk) with 25% equal weight"
  - "3-way mean fallback when no guideline font has x-height metrics"
affects: [branding-overview, typography-scoring, font-management]

# Tech tracking
tech-stack:
  added: []
  patterns: ["4-way scorer with graceful fallback to 3-way mean", "Font metric extraction via FontMetricsService with Zod-validated API responses"]

key-files:
  created:
    - packages/dashboard/src/services/font-metrics.ts
    - packages/dashboard/tests/services/font-metrics.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/types.ts
    - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts
    - packages/branding/src/types.ts
    - packages/dashboard/src/services/scoring/types.ts
    - packages/dashboard/src/services/scoring/typography-score.ts
    - packages/dashboard/tests/services/scoring/typography-score.test.ts

key-decisions:
  - "xHeightOk checks if observed font family matches a guideline font with x-height data -- leverages existing fontOk match logic"
  - "4-way mean (25% each) when metrics present; 3-way mean fallback preserves backwards compatibility"
  - "Zod v4 z.record(key, value) with .passthrough() for Google Fonts API validation"

patterns-established:
  - "Font metric scorer: optional 4th heuristic activated by data availability, not configuration"
  - "FontMetricsService: constructor injection of repo + logger, graceful no-op when API key absent"

requirements-completed: [BTYPO-02, BTYPO-03]

# Metrics
duration: 7min
completed: 2026-04-12
---

# Phase 26 Plan 02: Font Metric Scorer Integration Summary

**Migration 045 + FontMetricsService + 4-way typography scorer with x-height heuristic (25% equal weight, 3-way fallback when no metrics)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-12T19:51:46Z
- **Completed:** 2026-04-12T19:58:27Z
- **Tasks:** 2/2
- **Files modified:** 9

## Accomplishments
- Added migration 045 with x_height, cap_height, units_per_em nullable INTEGER columns on branding_fonts
- Created FontMetricsService with Google Fonts API resolution, opentype.js TTF parsing, and branding repository persistence
- Extended typography scorer with xHeightOk 4th heuristic using 4-way equal-weight mean (25% each)
- Preserved 3-way mean fallback for non-Google-Fonts organizations (zero regression)
- 27 tests pass (19 scorer including 6 new x-height tests + 8 font-metrics tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 045 + type extensions + repository updates** - `0e55739` (feat)
2. **Task 2: FontMetricsService + typography scorer 4th heuristic + tests** - `474eb49` (feat)

## Files Created/Modified
- `packages/dashboard/src/db/sqlite/migrations.ts` - Migration 045: x_height, cap_height, units_per_em columns
- `packages/dashboard/src/db/types.ts` - BrandingFontRecord extended with optional metric fields
- `packages/dashboard/src/db/sqlite/repositories/branding-repository.ts` - FontRow, fontRowToRecord, addFont, updateFont updated
- `packages/branding/src/types.ts` - BrandFont extended with optional xHeight/capHeight/unitsPerEm
- `packages/dashboard/src/services/scoring/types.ts` - TypographySubScoreDetail with optional xHeightOk
- `packages/dashboard/src/services/font-metrics.ts` - FontMetricsService class (97 lines)
- `packages/dashboard/src/services/scoring/typography-score.ts` - 4-way scorer with 3-way fallback
- `packages/dashboard/tests/services/font-metrics.test.ts` - 8 tests for FontMetricsService
- `packages/dashboard/tests/services/scoring/typography-score.test.ts` - 19 tests (6 new x-height cases)

## Decisions Made
- xHeightOk checks whether observed font family matches a guideline font that has x-height data, leveraging the existing fontOk substring match logic rather than comparing raw x-height ratios
- 4-way mean activated by data availability (any guideline font having metrics), not by configuration toggle
- Zod validates Google Fonts API response shape before use (T-26-05 mitigation)
- opentype.parse() failures return null, treated as "no metrics" by scorer (T-26-06 mitigation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Built branding package to generate dist types for dashboard consumption**
- **Found during:** Task 2 (TypeScript compilation)
- **Issue:** Dashboard tsconfig resolves @luqen/branding via dist/index.d.ts -- new xHeight/unitsPerEm fields invisible until branding package rebuilt
- **Fix:** Ran `npx tsc` in packages/branding to regenerate dist types
- **Files modified:** packages/branding/dist/ (gitignored build artifacts)
- **Verification:** `npx tsc --noEmit -p packages/dashboard/tsconfig.json` compiles clean
- **Committed in:** N/A (dist files are gitignored)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Standard monorepo build dependency. No scope creep.

## Issues Encountered
None beyond the branding dist rebuild documented above.

## User Setup Required
None - Google Fonts API key is optional (configured via GOOGLE_FONTS_API_KEY env var from Plan 01). FontMetricsService gracefully no-ops when key is absent.

## Next Phase Readiness
- Typography scorer now supports 4-way scoring when font metrics are populated
- FontMetricsService ready to be wired into font creation/update workflows
- Future work: call enrichFontMetrics when fonts are added to guidelines (not in this plan's scope)

## Self-Check: PASSED

All created files exist. All commit hashes verified in git log.

---
*Phase: 26-typography-x-height-spike*
*Completed: 2026-04-12*

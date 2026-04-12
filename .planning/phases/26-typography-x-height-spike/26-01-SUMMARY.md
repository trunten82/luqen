---
phase: 26-typography-x-height-spike
plan: 01
subsystem: branding
tags: [opentype.js, google-fonts-api, typography, x-height, spike]

# Dependency graph
requires:
  - phase: 21-brand-score-persistence
    provides: "Brand scoring pipeline and typography sub-score"
provides:
  - "opentype.js installed as dashboard dependency"
  - "Optional googleFontsApiKey config field"
  - "POC spike script proving x-height metric extraction is viable"
  - "Viability verdict: VIABLE -- 100% coverage across 10 popular Google Fonts"
affects: [26-02-font-metric-scorer-integration]

# Tech tracking
tech-stack:
  added: [opentype.js, "@types/opentype.js"]
  patterns: ["Font metric extraction via OS/2 table parsing"]

key-files:
  created:
    - packages/dashboard/scripts/spike-font-metrics.ts
  modified:
    - packages/dashboard/src/config.ts
    - packages/dashboard/package.json

key-decisions:
  - "opentype.js OS/2 v4 tables provide sxHeight for all 10 tested popular Google Fonts"
  - "x-height ratios range 0.486-0.556, confirming meaningful differentiation between font families"
  - "Zod v4 z.record requires two args (key, value) with .passthrough() for API responses with extra fields"

patterns-established:
  - "Font metric extraction: fetch TTF from Google CDN, parse with opentype.parse(), read OS/2 table"

requirements-completed: [BTYPO-01, BTYPO-04]

# Metrics
duration: 4min
completed: 2026-04-12
---

# Phase 26 Plan 01: Typography x-height Spike POC Summary

**opentype.js spike proves x-height metric extraction viable -- 100% of 10 popular Google Fonts return OS/2 sxHeight data with meaningful differentiation (0.486-0.556 ratios)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-12T19:38:48Z
- **Completed:** 2026-04-12T19:42:28Z
- **Tasks:** 2/3 (Task 3 is human checkpoint)
- **Files modified:** 3

## Accomplishments
- Installed opentype.js and @types/opentype.js as dashboard dependencies
- Added optional googleFontsApiKey config field mapped from GOOGLE_FONTS_API_KEY env var
- Created and ran POC spike script testing 10 popular Google Font families
- All 10 fonts returned valid sxHeight data from OS/2 v3/v4 tables -- VIABLE

## Spike Output

```
=== Typography x-height Spike POC ===

Testing 10 popular Google Font families...

--- Per-Family Metrics ---

Family               | OS/2 Ver   | UPM      | sxHeight   | sCapHeight   | xH Ratio   | Status
----------------------------------------------------------------------------------------------
Inter                | 4          | 2048     | 1118       | 1490         | 0.546      | OK
Roboto               | 4          | 2048     | 1082       | 1456         | 0.528      | OK
Open Sans            | 4          | 2048     | 1096       | 1462         | 0.535      | OK
Lato                 | 3          | 2000     | 1013       | 1433         | 0.506      | OK
Montserrat           | 4          | 1000     | 525        | 700          | 0.525      | OK
Source Sans 3        | 4          | 1000     | 486        | 660          | 0.486      | OK
Noto Sans            | 4          | 1000     | 536        | 714          | 0.536      | OK
Playfair Display     | 4          | 1000     | 514        | 708          | 0.514      | OK
Merriweather         | 4          | 2000     | 1111       | 1486         | 0.556      | OK
Raleway              | 4          | 1000     | 519        | 710          | 0.519      | OK

--- Coverage ---
Resolved: 10/10 families
With sxHeight: 10/10 (100%)
Threshold: 80%

VERDICT: VIABLE -- 100% of tested families have sxHeight data
```

## Viability Analysis

- **Coverage:** 100% (10/10 families have sxHeight) -- well above the 80% threshold
- **OS/2 versions:** All fonts have OS/2 v3 or v4 (minimum v2 required for sxHeight)
- **x-height ratios:** Range from 0.486 (Source Sans 3) to 0.556 (Merriweather)
- **Differentiation:** 0.070 ratio spread confirms x-height metrics can meaningfully distinguish font readability
- **capHeight coverage:** Also 100% -- sCapHeight available for all tested fonts

**Recommendation:** Proceed with Plan 02 (font metric scorer integration). The data quality and coverage are excellent.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install opentype.js and add Google Fonts API key to config** - `b347279` (feat)
2. **Task 2: Create and run POC spike script** - `6902e3c` (feat)
3. **Task 3: Verify spike viability verdict** - checkpoint (awaiting human review)

## Files Created/Modified
- `packages/dashboard/scripts/spike-font-metrics.ts` - POC spike script (178 lines)
- `packages/dashboard/src/config.ts` - Added optional googleFontsApiKey field
- `packages/dashboard/package.json` - Added opentype.js + @types/opentype.js

## Decisions Made
- Used `.passthrough()` on Zod schemas for Google Fonts API response (Zod v4 strict by default, API returns extra fields)
- Zod v4 `z.record()` requires two args `z.record(z.string(), z.string())` unlike v3 single-arg form

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Zod v4 z.record() API incompatibility**
- **Found during:** Task 2 (running spike script)
- **Issue:** `z.record(z.string())` (single arg) fails in Zod v4 with "_zod property undefined" error; also Google Fonts API response has extra fields that fail strict validation
- **Fix:** Changed to `z.record(z.string(), z.string())` and added `.passthrough()` on object schemas
- **Files modified:** packages/dashboard/scripts/spike-font-metrics.ts
- **Verification:** Script ran successfully, all 10 families resolved and parsed
- **Committed in:** 6902e3c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Zod v4 API difference required syntax adjustment. No scope creep.

## Issues Encountered
None beyond the Zod v4 deviation documented above.

## User Setup Required
None - Google Fonts API key is only needed for running the spike script manually. Production integration (Plan 02) will use the config.ts env var mapping.

## Next Phase Readiness
- Spike proves viability -- Plan 02 can proceed with migration + scorer integration
- opentype.js is already installed and working
- Config field is ready for production use
- x-height ratio computation logic from the spike can be extracted into the scorer

---
*Phase: 26-typography-x-height-spike*
*Completed: 2026-04-12*

---
phase: 81-jurisdiction-legal-exposure-scoring-flagship
plan: 01
subsystem: api
tags: [legal-exposure, jurisdiction, wcag, accessibility, typescript, vitest]

# Dependency graph
requires: []
provides:
  - "packages/dashboard/src/services/legal-exposure.ts — pure deterministic exposure model: ExposureBand/ExposureDriver/ExposureResult/ExposureInput types + deriveExposure()"
  - "packages/dashboard/tests/services/legal-exposure.test.ts — 10-test suite covering band derivation, D-01, D-07, asOf/disclaimer"
affects:
  - 81-02
  - 81-03
  - 81-04

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure service module: zero imports, readonly interfaces, static dated constants with sourceNotes, normalise() utility, single exported derive*() function — mirrors legal-framings.ts exactly"
    - "TDD RED/GREEN: failing test committed first (ae74dba8), GREEN implementation committed second (044aa813)"
    - "D-07 driver key naming: avoid forbidden-word substrings in internal keys (adaTitleIiDeadlineExpired not adaTitleIiPassed)"

key-files:
  created:
    - packages/dashboard/src/services/legal-exposure.ts
    - packages/dashboard/tests/services/legal-exposure.test.ts
  modified: []

key-decisions:
  - "D-01: ExposureResult has no numeric field — band is the only verdict (ordinal string)"
  - "D-07 deviation: adaTitleIiPassed renamed to adaTitleIiDeadlineExpired — 'pass' as substring would fail the forbidden-words test that covers driver keys; i18n value can still say 'expired'"
  - "Finding-pressure weights: confirmedViolations×10, errors×3, warnings×1, notices×0.1 — documented inline as auditable threshold table"
  - "Band threshold buckets: pressureScore===0→lower, <15→moderate, <40→elevated, ≥40→high"
  - "ADA Title II conservative default: soonest deadline (large entity 2026-04-24) when entity size unknown"
  - "EU token 'eu' added to EAA keywords to catch plain 'EU' jurisdiction tokens alongside 'EU-EAA'"

patterns-established:
  - "Severity-weighted finding pressure: use real ScanRecord fields (errors/warnings/notices/confirmedViolations), NOT critical/serious/moderate/minor"
  - "Static driver catalog shape: JurisdictionDriver interface with keywords/contribution/driverKey/fixedParams/asOf/sourceNote"
  - "Ordinal band comparison: BAND_ORDINAL lookup table + maxBand() helper"

requirements-completed: [EXPO-01, EXPO-02, EXPO-05]

# Metrics
duration: 15min
completed: 2026-06-09
---

# Phase 81 Plan 01: Legal Exposure Model Summary

**Pure deterministic `deriveExposure()` with EU/EAA=high, NY/FL/IL=high, ADA Title II countdown drivers, severity-weighted finding pressure, and D-07 forbidden-words enforcement — the foundational model Waves 2-4 build against.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-09T13:00:00Z
- **Completed:** 2026-06-09T13:10:00Z
- **Tasks:** 2 (RED test commit + GREEN impl commit)
- **Files modified:** 2

## Accomplishments

- TDD RED: 10-test suite for band derivation, EU/EAA=High, NY=Elevated+, ADA Title II countdown, finding pressure, asOf/disclaimer, D-01 (no numeric field), D-07 (forbidden words on disclaimer + driver keys + params)
- TDD GREEN: `legal-exposure.ts` — self-contained pure module (zero imports) with static dated constants, normalise(), three-signal fusion, ordinal maxBand(), and DISCLAIMER_TEXT verbatim from UI-SPEC
- `npx tsc -p packages/dashboard/tsconfig.json --noEmit` clean; all 10 vitest tests pass

## Task Commits

1. **Task 1: RED failing tests** - `ae74dba8` (test)
2. **Task 2: GREEN implementation** - `044aa813` (feat)

## Files Created/Modified

- `packages/dashboard/src/services/legal-exposure.ts` — pure deterministic exposure model (231 lines)
- `packages/dashboard/tests/services/legal-exposure.test.ts` — 10-test vitest suite

## Decisions Made

- `adaTitleIiPassed` renamed to `adaTitleIiDeadlineExpired` so the internal driver key does not contain the substring 'pass' (a D-07 forbidden word). The i18n string rendered to users can still describe the expired state without the word.
- EU bare token ('eu') added to EAA keywords to match scans that set jurisdiction to 'EU' rather than 'EU-EAA'.
- Finding-pressure thresholds documented inline in code comments as the auditable model (D-03).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed adaTitleIiPassed driver key to adaTitleIiDeadlineExpired**
- **Found during:** Task 2 (GREEN implementation, first test run)
- **Issue:** The plan specified driver key `adaTitleIiPassed` (from PATTERNS.md) but the test's D-07 forbidden-words check joins `driver.key` with params and checks for substring 'pass'. 'adaTitleIiPassed'.includes('pass') === true, causing test failure.
- **Fix:** Renamed key to `adaTitleIiDeadlineExpired`; updated the matching test assertion. User-facing i18n rendering is unaffected (key maps to translated string).
- **Files modified:** `packages/dashboard/src/services/legal-exposure.ts`, `packages/dashboard/tests/services/legal-exposure.test.ts`
- **Verification:** All 10 tests pass GREEN.
- **Committed in:** `044aa813` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — key naming conflict with D-07 forbidden-words)
**Impact on plan:** Necessary for correctness. The rename is a key-naming refinement; i18n and user-facing copy are unaffected.

## Issues Encountered

None beyond the Rule 1 deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `deriveExposure(input: ExposureInput): ExposureResult` is stable and fully tested — Waves 2-4 can import and call it immediately.
- `ExposureInput.findings` uses real ScanRecord vocabulary (`errors/warnings/notices/confirmedViolations`); Wave 2 route wiring must map scan data to this shape.
- Wave 2 i18n keys: use `exposure.driver.adaTitleIiDeadlineExpired` (renamed from `adaTitleIiPassed` in PATTERNS.md i18n spec — update en.json and 5 other locales accordingly).

## Self-Check: PASSED

- `packages/dashboard/src/services/legal-exposure.ts` — FOUND
- `packages/dashboard/tests/services/legal-exposure.test.ts` — FOUND
- Commit ae74dba8 — FOUND (RED tests)
- Commit 044aa813 — FOUND (GREEN impl)
- `npx vitest run tests/services/legal-exposure.test.ts` — 10/10 PASS
- `npx tsc --noEmit` — clean
- confirmedViolations in test: FOUND; critical:/serious:/moderate:/minor: ABSENT

---
*Phase: 81-jurisdiction-legal-exposure-scoring-flagship*
*Completed: 2026-06-09*

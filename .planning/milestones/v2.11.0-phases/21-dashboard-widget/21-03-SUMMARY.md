---
phase: 21-dashboard-widget
plan: 03
subsystem: ui
tags: [i18n, handlebars, locales, brand-score, accessibility]

requires:
  - phase: 21-dashboard-widget
    plan: 01
    provides: home.brandScore.* keys in en.json

provides:
  - All Phase 19/20/21 .hbs partials use {{t}} helpers for user-visible strings
  - en.json has 18 new reportDetail.brandScore* keys
  - 5 non-English locale files have placeholder entries for all new keys (home + reportDetail)

affects: [21-dashboard-widget, branding-pipeline, i18n]

tech-stack:
  added: []
  patterns: [cross-phase i18n sweep with locale placeholder format]

key-files:
  created: []
  modified:
    - packages/dashboard/src/views/partials/brand-score-panel.hbs
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/i18n/locales/fr.json
    - packages/dashboard/src/i18n/locales/it.json
    - packages/dashboard/src/i18n/locales/pt.json
    - packages/dashboard/src/i18n/locales/de.json
    - packages/dashboard/src/i18n/locales/es.json

key-decisions:
  - "unscorable-reason-label helper left as hardcoded English — runs server-side without request locale context; flagged for future i18n work"
  - "Placeholder format [XX] English text chosen for consistency — easy grep to find untranslated strings before deploy"
  - "reportDetail.brandScoreIssueCounterOf/Suffix split into two keys instead of interpolation — avoids complex Handlebars parameter passing"

requirements-completed: [BUI-03]

duration: 7min
completed: 2026-04-12
---

# Phase 21 Plan 03: Cross-Phase i18n Sweep Summary

**18 hardcoded English strings in brand-score-panel.hbs replaced with {{t}} helpers; 18 en.json keys added; 27 placeholder entries added per non-English locale (8 home + 19 reportDetail)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-12T09:30:28Z
- **Completed:** 2026-04-12T09:37:20Z
- **Tasks:** 2/2
- **Files modified:** 7

## Accomplishments

- Audited all Phase 19/20/21 .hbs partials for hardcoded English strings
- Phase 19 (branding-mode-toggle.hbs): already clean — all strings use {{t}} helpers
- Phase 21 (brand-score-widget.hbs): already clean — Plan 21-01 used {{t}} throughout
- Phase 20 (brand-score-panel.hbs): replaced 18 hardcoded strings including badge text, delta labels, sub-score names, coverage dimensions, empty-state messages, and aria-labels
- Added 18 new reportDetail.brandScore* keys to en.json
- Added placeholder entries for all new keys (8 home + 19 reportDetail = 27 per locale) to fr/it/pt/de/es.json
- Full regression suite: 2528 tests pass, 0 regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Audit and replace hardcoded English in brand-score-panel.hbs** - `c8611bc` (refactor)
2. **Task 2: Add i18n placeholder entries to 5 non-English locale files** - `ebaa1f7` (chore)

## Files Modified

- `packages/dashboard/src/views/partials/brand-score-panel.hbs` - All 18 hardcoded English strings replaced with {{t "reportDetail.brandScore*"}} calls
- `packages/dashboard/src/i18n/locales/en.json` - Added 18 new reportDetail.brandScore* keys
- `packages/dashboard/src/i18n/locales/fr.json` - Added 27 placeholder entries ([FR] prefix)
- `packages/dashboard/src/i18n/locales/it.json` - Added 27 placeholder entries ([IT] prefix)
- `packages/dashboard/src/i18n/locales/pt.json` - Added 27 placeholder entries ([PT] prefix)
- `packages/dashboard/src/i18n/locales/de.json` - Added 27 placeholder entries ([DE] prefix)
- `packages/dashboard/src/i18n/locales/es.json` - Added 27 placeholder entries ([ES] prefix)

## Decisions Made

- unscorable-reason-label helper in server.ts left as hardcoded English — it runs server-side without request locale context; flagged for future i18n work
- Split issue counter into two keys (brandScoreIssueCounterOf + brandScoreIssueCounterSuffix) instead of complex interpolation
- Placeholder format `[XX] English text` chosen for easy grep-based audit of untranslated strings

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

| File | Line | Stub | Reason |
|------|------|------|--------|
| packages/dashboard/src/server.ts | 452-461 | unscorable-reason-label helper has 6 hardcoded English labels | Server-side helper without request locale context; documented for future i18n work |

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All Phase 19/20/21 partials are now i18n-ready
- Placeholder translations need real translations before production deploy
- unscorable-reason-label helper flagged for future i18n when server-side locale context is available

---
*Phase: 21-dashboard-widget*
*Completed: 2026-04-12*

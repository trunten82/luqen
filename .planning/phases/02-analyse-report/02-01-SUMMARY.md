---
phase: 02-analyse-report
plan: 01
subsystem: api
tags: [typescript, fastify, llm, capability-engine, vitest, wcag]

requires:
  - phase: 01-generate-fix
    provides: capability executor pattern (generate-fix.ts), retry/fallback engine, prompt builder pattern, SqliteAdapter test setup

provides:
  - executeAnalyseReport function — capability executor with retry/fallback chain
  - parseAnalyseReportResponse — safe JSON parser with defaults
  - buildAnalyseReportPrompt — prompt builder with MAX_ISSUES_COUNT=30 truncation
  - POST /api/v1/analyse-report route — validates, resolves orgId, maps errors to HTTP codes

affects:
  - 02-analyse-report plan 02 (dashboard AI summary tab — calls this endpoint)

tech-stack:
  added: []
  patterns:
    - "capability-executor: mirror generate-fix.ts structure exactly for each new capability"
    - "prompt-truncation: MAX_ISSUES_COUNT guard sorts by count desc, slices top N, appends omission notice"
    - "route-registration: append new routes after existing blocks in capabilities-exec.ts, never touch prior routes"

key-files:
  created:
    - packages/llm/src/capabilities/analyse-report.ts
    - packages/llm/src/prompts/analyse-report.ts
    - packages/llm/tests/capabilities/analyse-report.test.ts
  modified:
    - packages/llm/src/api/routes/capabilities-exec.ts

key-decisions:
  - "Truncation sorts by count desc so highest-frequency issues are never dropped — critical for executive summary quality"
  - "temperature: 0.3 for analyse-report (vs 0.2 for generate-fix) — summaries benefit from slightly more variation"

patterns-established:
  - "Prompt truncation: sort by count desc, slice MAX_ISSUES_COUNT, append omission notice"

requirements-completed: [RPT-01, RPT-02, RPT-03, RPT-04]

duration: 4min
completed: 2026-04-04
---

# Phase 2 Plan 1: Analyse-Report Capability Summary

**analyse-report capability with retry/fallback executor, token-limit-safe prompt builder (MAX_ISSUES_COUNT=30), and POST /api/v1/analyse-report endpoint registered on the LLM microservice**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-04T17:07:42Z
- **Completed:** 2026-04-04T17:11:16Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Implemented executeAnalyseReport mirroring generate-fix.ts retry/fallback chain exactly
- Implemented buildAnalyseReportPrompt with MAX_ISSUES_COUNT=30 truncation (sorts by count desc, appends omission notice)
- Registered POST /api/v1/analyse-report with validation, orgId resolution, and correct HTTP error codes
- 8 new tests covering all specified behaviors; full LLM suite 93 tests passing (up from 78 baseline)

## Task Commits

1. **Task 1: analyse-report capability executor and prompt builder** - `e5b7aac` (feat)
2. **Task 2: Register POST /api/v1/analyse-report route** - `a5a49c1` (feat)

## Files Created/Modified
- `packages/llm/src/capabilities/analyse-report.ts` - executeAnalyseReport, parseAnalyseReportResponse, AnalyseReportInput, AnalyseReportResult
- `packages/llm/src/prompts/analyse-report.ts` - buildAnalyseReportPrompt with MAX_ISSUES_COUNT=30 truncation guard
- `packages/llm/tests/capabilities/analyse-report.test.ts` - 8 tests covering not-configured, success, retry/exhaustion, prompt override, malformed JSON, prompt content, truncation
- `packages/llm/src/api/routes/capabilities-exec.ts` - POST /api/v1/analyse-report route appended after generate-fix

## Decisions Made
- Truncation sorts by count descending so the highest-frequency issues (most impactful) are never omitted
- temperature set to 0.3 (vs 0.2 for generate-fix) since executive summaries benefit from slightly more variation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- POST /api/v1/analyse-report is live and tested — dashboard Plan 02 can now wire the AI summary tab UI
- All 93 LLM package tests passing, zero TypeScript errors

---
*Phase: 02-analyse-report*
*Completed: 2026-04-04*

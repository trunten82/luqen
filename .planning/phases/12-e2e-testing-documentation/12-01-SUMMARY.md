---
phase: 12-e2e-testing-documentation
plan: 01
subsystem: dashboard/testing
tags: [e2e, branding, retag, integration-test, sqlite]
dependency_graph:
  requires: [packages/dashboard/src/services/branding-retag.ts, packages/dashboard/src/db/sqlite/repositories/branding-repository.ts]
  provides: [e2e-branding-retag-pipeline.test.ts]
  affects: [test suite coverage]
tech_stack:
  added: []
  patterns: [vitest integration test harness, tmpdir + randomUUID db isolation, real SQLite + real migrations]
key_files:
  created:
    - packages/dashboard/tests/integration/e2e-branding-retag-pipeline.test.ts
  modified: []
decisions:
  - Tests go directly to GREEN — implementation from phases 09+ already satisfies all pipeline assertions
  - Inline makeReportWithColorIssue helper used instead of disk fixtures — fully self-contained
metrics:
  duration: 1m
  completed_date: "2026-04-06"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
---

# Phase 12 Plan 01: E2E Branding Retag Pipeline Tests Summary

E2E integration tests for the branding retag pipeline using real SQLite, real migrations, and inline fixtures — 3 scenarios covering full pipeline, guideline update, and idempotency.

## What Was Built

A self-contained integration test file at `packages/dashboard/tests/integration/e2e-branding-retag-pipeline.test.ts` with three independent test scenarios:

1. **E2E-01 full pipeline** — Create guideline with `#FF5F15` (Aperol Orange), assign site, insert completed scan with matching issue context, call `retagAllSitesForGuideline`, verify `brandRelatedCount > 0` and `jsonReport.branding.guidelineId` matches.
2. **Guideline update retag** — After first retag with Orange only, add `#FF8C00` (Aperol Amber), insert second scan with Amber issue, retag again, verify second scan's `brandRelatedCount >= count after first`.
3. **Idempotency** — Run retag twice on same scan, assert `brandRelatedCount` unchanged and JSON report branding summary identical.

## Requirement Coverage

- **E2E-01**: Fully covered — create → assign → scan → retag → verify round-trip demonstrated on live data.

## Test Results

```
Test Files  1 passed (1)
Tests       3 passed (3)
Duration    1.08s
```

Integration suite: 12 passed, 2 skipped (external services) — no regressions.

## Deviations from Plan

None — plan executed exactly as written. Tests went directly to GREEN as implementation from Phase 09 already satisfies all pipeline assertions.

## Known Stubs

None.

## Self-Check: PASSED

- File exists: `packages/dashboard/tests/integration/e2e-branding-retag-pipeline.test.ts` — FOUND
- Commit exists: `2a4fd96` — FOUND
- 3 describe blocks: confirmed
- E2E-01 referenced: confirmed
- `retagAllSitesForGuideline` used: confirmed
- `brandRelatedCount` matches: 12 references
- All 3 tests pass: confirmed (vitest exits 0)

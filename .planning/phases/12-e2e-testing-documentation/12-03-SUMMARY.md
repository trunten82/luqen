---
phase: 12-e2e-testing-documentation
plan: "03"
subsystem: dashboard/tests/integration
tags:
  - e2e
  - branding
  - system-guideline
  - clone
  - retag
dependency_graph:
  requires:
    - Phase 08 system brand guideline infrastructure (SYS-02, SYS-03, SYS-05)
  provides:
    - E2E-03 requirement coverage
  affects:
    - packages/dashboard/tests/integration
tech_stack:
  added: []
  patterns:
    - real SQLite + real migrations (no mocks)
    - seedSystemGuideline helper pattern (copy from Phase 08 pipeline test)
    - retagScansForSite direct import for service-layer testing
key_files:
  created:
    - packages/dashboard/tests/integration/e2e-system-brand-guideline-org-flow.test.ts
  modified: []
decisions:
  - "5 scenarios structured as separate describe blocks for clarity and independent reporting"
  - "seedSystemGuideline helper adds font+selector so retagScansForSite can resolve a full guideline"
metrics:
  duration: 3m
  completed: "2026-04-06"
  tasks_completed: 1
  files_changed: 1
---

# Phase 12 Plan 03: E2E System Brand Guideline Org Flow Summary

**One-liner:** E2E integration tests validating system brand guideline link+retag+clone+independence flow using real SQLite, no mocks.

## What Was Built

Created `packages/dashboard/tests/integration/e2e-system-brand-guideline-org-flow.test.ts` — a 5-scenario integration test file that proves the system brand guideline org-perspective flow end-to-end.

### Scenarios Implemented

1. **Scenario 1** — Org links system guideline; `getGuidelineForSite` returns the live system record (`orgId === 'system'`, correct id, 2 colors).
2. **Scenario 2** — `retagScansForSite` on a system-linked site with zero completed scans returns `{ retagged: 0 }` without throwing.
3. **Scenario 3** — `retagScansForSite` with a real completed scan containing a matching color enriches the scan: `brandRelatedCount > 0` and `report.branding.guidelineId === sysId`.
4. **Scenario 4** — `cloneSystemGuideline` produces an org-owned copy: `orgId === 'org-e2e-clone'`, `clonedFromSystemGuidelineId === sysId`, `id !== sysId`, 2 colors.
5. **Scenario 5** — Clone independence: mutating the system source after cloning (name change + color add) does NOT affect the clone — `getGuidelineForSite` still resolves the clone with original name and color count.

## Test Results

```
Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  685ms
```

Integration regression: 15 test files passed, 0 failures.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- File exists: packages/dashboard/tests/integration/e2e-system-brand-guideline-org-flow.test.ts — FOUND
- Commit 237edec exists — FOUND
- 5 describe blocks — CONFIRMED
- E2E-03 requirement tag — CONFIRMED
- cloneSystemGuideline referenced in 3 locations — CONFIRMED
- clonedFromSystemGuidelineId assertion — CONFIRMED (2 assertions)
- All 5 scenarios pass — CONFIRMED
- No integration regressions — CONFIRMED (138 passed, 36 skipped)
